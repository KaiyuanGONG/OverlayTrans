//! HTTP download utility with progress callbacks, cancellation and SHA-256 verification.
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::io::AsyncWriteExt;

struct TempFileCleanup {
    path: std::path::PathBuf,
    armed: bool,
}

impl TempFileCleanup {
    fn new(path: std::path::PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempFileCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("download cancelled")]
    Cancelled,
    #[error("network error: {0}")]
    Network(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("verification failed: {0}")]
    Verification(String),
}

pub type DownloadResult<T> = std::result::Result<T, DownloadError>;

pub struct DownloadOptions<'a> {
    pub url: &'a str,
    pub dest: &'a Path,
    /// Optional expected SHA-256 hex string for integrity check
    pub expected_sha256: Option<&'a str>,
    /// Optional cancellation flag. When set to true, download stops and temp file is removed.
    pub cancel_flag: Option<Arc<AtomicBool>>,
    /// Callback receiving (downloaded_bytes, total_bytes_or_0)
    pub on_progress: Option<Box<dyn Fn(u64, u64) + Send + Sync + 'a>>,
}

fn is_cancelled(flag: &Option<Arc<AtomicBool>>) -> bool {
    flag.as_ref()
        .is_some_and(|cancel| cancel.load(Ordering::Relaxed))
}

async fn atomic_replace(source: &Path, destination: &Path) -> DownloadResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
        };

        let source_wide: Vec<u16> = source
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let destination_wide: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let flags = MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0);

        // SAFETY: both buffers are NUL-terminated and remain alive for the
        // duration of the synchronous Win32 call.
        unsafe {
            MoveFileExW(
                PCWSTR(source_wide.as_ptr()),
                PCWSTR(destination_wide.as_ptr()),
                flags,
            )
        }
        .map_err(|e| {
            DownloadError::Io(format!(
                "Failed to replace downloaded file at {}: {e}",
                destination.display()
            ))
        })?;
    }

    #[cfg(not(windows))]
    tokio::fs::rename(source, destination).await.map_err(|e| {
        DownloadError::Io(format!(
            "Failed to replace downloaded file at {}: {e}",
            destination.display()
        ))
    })?;

    Ok(())
}

pub async fn download_file(opts: DownloadOptions<'_>) -> DownloadResult<()> {
    if is_cancelled(&opts.cancel_flag) {
        return Err(DownloadError::Cancelled);
    }

    let client = reqwest::Client::builder()
        // Multi-GB models may legitimately take much longer than five
        // minutes. Limit connection and stalled-read time, not total time.
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| DownloadError::Network(e.to_string()))?;

    let response = client
        .get(opts.url)
        .send()
        .await
        .map_err(|e| DownloadError::Network(format!("Failed to start download: {e}")))?;

    if !response.status().is_success() {
        return Err(DownloadError::Network(format!(
            "Server returned HTTP {}",
            response.status()
        )));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Create parent dirs
    if let Some(parent) = opts.dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            DownloadError::Io(format!(
                "Failed to create download directory {}: {e}",
                parent.display()
            ))
        })?;
    }

    // Open temp file alongside dest
    let tmp_path = opts.dest.with_extension("tmp");
    let mut temp_cleanup = TempFileCleanup::new(tmp_path.clone());
    let mut file = tokio::fs::File::create(&tmp_path).await.map_err(|e| {
        DownloadError::Io(format!(
            "Failed to create temp file {}: {e}",
            tmp_path.display()
        ))
    })?;

    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if is_cancelled(&opts.cancel_flag) {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(DownloadError::Cancelled);
        }

        let chunk = chunk
            .map_err(|e| DownloadError::Network(format!("Stream error during download: {e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| DownloadError::Io(format!("Failed to write temp file: {e}")))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        if let Some(cb) = &opts.on_progress {
            cb(downloaded, total);
        }
    }

    file.flush()
        .await
        .map_err(|e| DownloadError::Io(format!("Failed to flush temp file: {e}")))?;
    drop(file);

    if is_cancelled(&opts.cancel_flag) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(DownloadError::Cancelled);
    }

    // Verify hash if provided
    if let Some(expected) = opts.expected_sha256 {
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(DownloadError::Verification(format!(
                "SHA-256 mismatch: expected {expected}, got {actual}"
            )));
        }
    }

    // Atomic replace keeps retries working when a corrupt destination already
    // exists. On Windows, plain rename cannot replace an existing file.
    atomic_replace(&tmp_path, opts.dest).await?;
    temp_cleanup.disarm();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_static_http_server(body: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut req_buf = vec![0_u8; 2048];
                let _ = socket.read(&mut req_buf).await;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.write_all(body).await;
            }
        });
        format!("http://{addr}/file.bin")
    }

    #[tokio::test]
    async fn download_file_success_with_sha256_verification() {
        let payload = b"overlaytrans-download-test-payload";
        let url = spawn_static_http_server(payload).await;
        let expected_sha256 = {
            let mut hasher = Sha256::new();
            hasher.update(payload);
            hex::encode(hasher.finalize())
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("download.bin");

        download_file(DownloadOptions {
            url: &url,
            dest: &dest,
            expected_sha256: Some(&expected_sha256),
            cancel_flag: None,
            on_progress: None,
        })
        .await
        .expect("download should succeed");

        let actual = tokio::fs::read(&dest).await.expect("read downloaded file");
        assert_eq!(actual, payload);
    }

    #[tokio::test]
    async fn download_file_accepts_uppercase_sha256_verification() {
        let payload = b"overlaytrans-download-test-uppercase-sha-payload";
        let url = spawn_static_http_server(payload).await;
        let expected_sha256_upper = {
            let mut hasher = Sha256::new();
            hasher.update(payload);
            hex::encode(hasher.finalize()).to_ascii_uppercase()
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("download-uppercase.bin");

        download_file(DownloadOptions {
            url: &url,
            dest: &dest,
            expected_sha256: Some(&expected_sha256_upper),
            cancel_flag: None,
            on_progress: None,
        })
        .await
        .expect("download should accept uppercase SHA-256");

        let actual = tokio::fs::read(&dest).await.expect("read downloaded file");
        assert_eq!(actual, payload);
    }

    #[tokio::test]
    async fn download_file_atomically_replaces_existing_destination() {
        let payload = b"fresh-verified-model";
        let url = spawn_static_http_server(payload).await;
        let expected_sha256 = {
            let mut hasher = Sha256::new();
            hasher.update(payload);
            hex::encode(hasher.finalize())
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("model.gguf");
        tokio::fs::write(&dest, b"corrupt-existing-model")
            .await
            .expect("seed corrupt destination");

        download_file(DownloadOptions {
            url: &url,
            dest: &dest,
            expected_sha256: Some(&expected_sha256),
            cancel_flag: None,
            on_progress: None,
        })
        .await
        .expect("verified retry should replace destination");

        assert_eq!(tokio::fs::read(&dest).await.unwrap(), payload);
        assert!(!dest.with_extension("tmp").exists());
    }

    #[tokio::test]
    async fn download_file_rejects_sha256_mismatch_and_cleans_temp() {
        let payload = b"overlaytrans-download-test-payload";
        let url = spawn_static_http_server(payload).await;

        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("download.bin");
        let wrong_sha = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

        let err = download_file(DownloadOptions {
            url: &url,
            dest: &dest,
            expected_sha256: Some(wrong_sha),
            cancel_flag: None,
            on_progress: None,
        })
        .await
        .expect_err("sha mismatch should fail");

        assert!(matches!(err, DownloadError::Verification(_)));
        assert!(
            !dest.exists(),
            "destination file must not exist on mismatch"
        );
        assert!(
            !dest.with_extension("tmp").exists(),
            "temporary file must be cleaned up on mismatch"
        );
    }

    #[tokio::test]
    async fn download_file_honors_cancellation_before_start() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dest = tmp.path().join("download.bin");
        let cancel = Arc::new(AtomicBool::new(true));

        let err = download_file(DownloadOptions {
            url: "http://127.0.0.1:9/not-used",
            dest: &dest,
            expected_sha256: None,
            cancel_flag: Some(cancel),
            on_progress: None,
        })
        .await
        .expect_err("cancelled download should fail early");

        assert!(matches!(err, DownloadError::Cancelled));
        assert!(!dest.exists());
    }
}
