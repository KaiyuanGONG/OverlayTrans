//! GGUF model manifest and download management for local mode (§7.2).
//!
//! Fixed manifests for Qwen3 GGUF models with pinned revisions, SHA-256, and licenses.
//! Downloads to temp file → verify → atomic rename. No `main`/`latest`/floating URLs.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

const HASH_BUFFER_BYTES: usize = 8 * 1024 * 1024;
pub const DOWNLOAD_SPACE_RESERVE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct VerificationStamp {
    sha256: String,
    bytes: u64,
    modified_unix_nanos: u64,
}

// ══════════════════════════════════════════════════════════════════════════════
// §7.2 Fixed GGUF Manifest — TIME-SENSITIVE, checked 2026-07-18
// ══════════════════════════════════════════════════════════════════════════════

/// A pinned GGUF model manifest with fixed revision and SHA-256.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GgufManifest {
    /// HuggingFace repo (e.g. "Qwen/Qwen3-4B-GGUF")
    pub repo: &'static str,
    /// Fixed git revision (full SHA)
    pub revision: &'static str,
    /// Filename within the repo
    pub file: &'static str,
    /// Expected file size in bytes
    pub bytes: u64,
    /// Expected SHA-256 hex (lowercase)
    pub sha256: &'static str,
    /// License identifier
    pub license: &'static str,
}

/// Default model: Qwen3-4B Q4_K_M
pub const QWEN3_4B: GgufManifest = GgufManifest {
    repo: "Qwen/Qwen3-4B-GGUF",
    revision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
    file: "Qwen3-4B-Q4_K_M.gguf",
    bytes: 2_497_280_256,
    sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
    license: "Apache-2.0",
};

/// High-quality model: Qwen3-8B Q4_K_M
pub const QWEN3_8B: GgufManifest = GgufManifest {
    repo: "Qwen/Qwen3-8B-GGUF",
    revision: "7c41481f57cb95916b40956ab2f0b139b296d974",
    file: "Qwen3-8B-Q4_K_M.gguf",
    bytes: 5_027_783_488,
    sha256: "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
    license: "Apache-2.0",
};

/// All built-in manifests keyed by LocalModel wire ID.
pub fn builtin_manifests() -> &'static [(&'static str, GgufManifest)] {
    &[("qwen3_4b", QWEN3_4B), ("qwen3_8b", QWEN3_8B)]
}

/// Look up a manifest by LocalModel wire ID.
pub fn manifest_for_model(model_id: &str) -> Option<&'static GgufManifest> {
    builtin_manifests()
        .iter()
        .find(|(id, _)| *id == model_id)
        .map(|(_, m)| m)
}

impl GgufManifest {
    /// Build the download URL for this manifest.
    /// Uses the pinned revision — never `main`/`latest`/tag.
    pub fn download_url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repo, self.revision, self.file
        )
    }

    /// Local filename for storage (e.g. "Qwen3-4B-Q4_K_M.gguf")
    pub fn local_filename(&self) -> &str {
        self.file
    }
}

/// Compute models directory under AppData.
pub fn models_dir() -> anyhow::Result<PathBuf> {
    let base = dirs_next::data_dir()
        .or_else(dirs_next::config_dir)
        .ok_or_else(|| anyhow::anyhow!("Cannot find app data directory"))?;
    Ok(base.join("OverlayTrans").join("models"))
}

/// Path to a specific GGUF model file.
pub fn model_path(model_id: &str) -> anyhow::Result<PathBuf> {
    let manifest =
        manifest_for_model(model_id).ok_or_else(|| anyhow::anyhow!("Unknown model: {model_id}"))?;
    Ok(models_dir()?.join("gguf").join(manifest.local_filename()))
}

fn verification_stamp_path(path: &Path) -> anyhow::Result<PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("Invalid model filename: {}", path.display()))?;
    Ok(path.with_file_name(format!("{file_name}.verified.json")))
}

async fn modified_unix_nanos(path: &Path) -> anyhow::Result<u64> {
    let modified = tokio::fs::metadata(path).await?.modified()?;
    let nanos = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| anyhow::anyhow!("Model modification time is invalid: {e}"))?
        .as_nanos();
    Ok(nanos.min(u64::MAX as u128) as u64)
}

async fn stamp_matches(
    path: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
) -> anyhow::Result<bool> {
    let stamp_path = verification_stamp_path(path)?;
    let stamp_bytes = match tokio::fs::read(&stamp_path).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    let stamp: VerificationStamp = match serde_json::from_slice(&stamp_bytes) {
        Ok(stamp) => stamp,
        Err(_) => return Ok(false),
    };

    Ok(stamp.bytes == expected_bytes
        && stamp.sha256.eq_ignore_ascii_case(expected_sha256)
        && stamp.modified_unix_nanos == modified_unix_nanos(path).await?)
}

async fn write_verification_stamp(
    path: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
) -> anyhow::Result<()> {
    let stamp_path = verification_stamp_path(path)?;
    let temp_path = stamp_path.with_extension("json.tmp");
    let stamp = VerificationStamp {
        sha256: expected_sha256.to_ascii_lowercase(),
        bytes: expected_bytes,
        modified_unix_nanos: modified_unix_nanos(path).await?,
    };
    let bytes = serde_json::to_vec(&stamp)?;
    tokio::fs::write(&temp_path, bytes).await?;
    if tokio::fs::try_exists(&stamp_path).await.unwrap_or(false) {
        tokio::fs::remove_file(&stamp_path).await?;
    }
    tokio::fs::rename(&temp_path, &stamp_path).await?;
    Ok(())
}

async fn sha256_file_streaming(path: &Path) -> anyhow::Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn verify_file_with_stamp(
    path: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
) -> anyhow::Result<bool> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    if metadata.len() != expected_bytes {
        return Ok(false);
    }
    if stamp_matches(path, expected_bytes, expected_sha256).await? {
        return Ok(true);
    }

    let actual = sha256_file_streaming(path).await?;
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = tokio::fs::remove_file(verification_stamp_path(path)?).await;
        return Ok(false);
    }
    write_verification_stamp(path, expected_bytes, expected_sha256).await?;
    Ok(true)
}

/// Check if a model is downloaded and verified. The expensive SHA pass is
/// streamed with an 8 MiB buffer and skipped while a file-bound stamp remains
/// valid, so UI status polling never loads or re-hashes a multi-GB GGUF.
pub async fn is_model_downloaded(model_id: &str) -> anyhow::Result<bool> {
    let path = model_path(model_id)?;
    is_model_downloaded_at(model_id, &path).await
}

/// Check a model at an explicit path. Keeping path resolution outside the
/// verifier lets runtime tests use an isolated temporary directory instead of
/// reading or mutating the user's real model library.
pub(crate) async fn is_model_downloaded_at(model_id: &str, path: &Path) -> anyhow::Result<bool> {
    let manifest =
        manifest_for_model(model_id).ok_or_else(|| anyhow::anyhow!("Unknown model: {model_id}"))?;
    verify_file_with_stamp(path, manifest.bytes, manifest.sha256).await
}

/// Record the SHA already verified by the streaming downloader without a
/// redundant second multi-GB read.
pub async fn mark_model_verified(model_id: &str) -> anyhow::Result<()> {
    let path = model_path(model_id)?;
    let manifest =
        manifest_for_model(model_id).ok_or_else(|| anyhow::anyhow!("Unknown model: {model_id}"))?;
    let metadata = tokio::fs::metadata(&path).await?;
    anyhow::ensure!(
        metadata.len() == manifest.bytes,
        "Downloaded model size mismatch: expected {}, got {}",
        manifest.bytes,
        metadata.len()
    );
    write_verification_stamp(&path, manifest.bytes, manifest.sha256).await
}

pub fn required_download_space(model_bytes: u64) -> u64 {
    model_bytes.saturating_add(DOWNLOAD_SPACE_RESERVE_BYTES)
}

fn validate_available_space(available: u64, model_bytes: u64) -> anyhow::Result<()> {
    let required = required_download_space(model_bytes);
    anyhow::ensure!(
        available >= required,
        "Insufficient disk space: need at least {:.1} GiB free, only {:.1} GiB available",
        required as f64 / 1_073_741_824.0,
        available as f64 / 1_073_741_824.0
    );
    Ok(())
}

/// Check free space before opening the network request. The reserve keeps the
/// application and OS usable while the temporary GGUF is being written.
pub fn ensure_download_space(directory: &Path, model_bytes: u64) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let wide: Vec<u16> = directory
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut available = 0_u64;
        unsafe {
            GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available), None, None)?;
        }
        validate_available_space(available, model_bytes)
    }

    #[cfg(not(windows))]
    {
        let _ = (directory, model_bytes);
        anyhow::bail!("Bundled GGUF download is supported only on Windows")
    }
}

/// Get the file size of a downloaded model, or 0 if not present.
pub async fn model_file_size(model_id: &str) -> u64 {
    let path = match model_path(model_id) {
        Ok(p) => p,
        Err(_) => return 0,
    };
    match tokio::fs::metadata(&path).await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

/// Delete a downloaded model file. Returns Ok(true) if deleted, Ok(false) if not present.
pub async fn delete_model(model_id: &str) -> anyhow::Result<bool> {
    let path = model_path(model_id)?;
    let stamp_path = verification_stamp_path(&path)?;
    if tokio::fs::try_exists(&stamp_path).await.unwrap_or(false) {
        tokio::fs::remove_file(stamp_path).await?;
    }
    if path.exists() {
        tokio::fs::remove_file(&path).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen3_4b_manifest_values() {
        assert_eq!(QWEN3_4B.repo, "Qwen/Qwen3-4B-GGUF");
        assert_eq!(
            QWEN3_4B.revision,
            "bc640142c66e1fdd12af0bd68f40445458f3869b"
        );
        assert_eq!(QWEN3_4B.file, "Qwen3-4B-Q4_K_M.gguf");
        assert_eq!(QWEN3_4B.bytes, 2_497_280_256);
        assert_eq!(
            QWEN3_4B.sha256,
            "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"
        );
        assert_eq!(QWEN3_4B.license, "Apache-2.0");
    }

    #[test]
    fn qwen3_8b_manifest_values() {
        assert_eq!(QWEN3_8B.repo, "Qwen/Qwen3-8B-GGUF");
        assert_eq!(
            QWEN3_8B.revision,
            "7c41481f57cb95916b40956ab2f0b139b296d974"
        );
        assert_eq!(QWEN3_8B.file, "Qwen3-8B-Q4_K_M.gguf");
        assert_eq!(QWEN3_8B.bytes, 5_027_783_488);
        assert_eq!(
            QWEN3_8B.sha256,
            "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785"
        );
        assert_eq!(QWEN3_8B.license, "Apache-2.0");
    }

    #[test]
    fn download_url_uses_fixed_revision() {
        let url = QWEN3_4B.download_url();
        assert!(url.contains("bc640142c66e1fdd12af0bd68f40445458f3869b"));
        assert!(!url.contains("main"));
        assert!(!url.contains("latest"));
        assert!(url.ends_with("Qwen3-4B-Q4_K_M.gguf"));
    }

    #[test]
    fn download_url_8b_uses_fixed_revision() {
        let url = QWEN3_8B.download_url();
        assert!(url.contains("7c41481f57cb95916b40956ab2f0b139b296d974"));
        assert!(!url.contains("main"));
    }

    #[test]
    fn manifest_for_model_returns_correct_entry() {
        let m4 = manifest_for_model("qwen3_4b").unwrap();
        assert_eq!(m4.bytes, 2_497_280_256);
        let m8 = manifest_for_model("qwen3_8b").unwrap();
        assert_eq!(m8.bytes, 5_027_783_488);
        assert!(manifest_for_model("unknown").is_none());
    }

    #[test]
    fn builtin_manifests_count() {
        assert_eq!(builtin_manifests().len(), 2);
    }

    #[test]
    fn local_filename_matches_file() {
        assert_eq!(QWEN3_4B.local_filename(), "Qwen3-4B-Q4_K_M.gguf");
        assert_eq!(QWEN3_8B.local_filename(), "Qwen3-8B-Q4_K_M.gguf");
    }

    #[test]
    fn sha256_is_lowercase_hex_64() {
        for m in [QWEN3_4B, QWEN3_8B] {
            assert_eq!(m.sha256.len(), 64);
            assert!(m
                .sha256
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
        }
    }

    #[test]
    fn disk_space_preflight_keeps_half_gib_reserve() {
        assert_eq!(
            required_download_space(2_497_280_256),
            2_497_280_256 + 512 * 1024 * 1024
        );
        assert!(validate_available_space(3_100_000_000, 2_497_280_256).is_ok());
        assert!(validate_available_space(2_500_000_000, 2_497_280_256).is_err());
    }

    #[tokio::test]
    async fn verification_streams_then_reuses_file_bound_stamp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiny.gguf");
        let payload = b"small fixture standing in for a multi-gigabyte GGUF";
        tokio::fs::write(&path, payload).await.unwrap();
        let expected = hex::encode(Sha256::digest(payload));

        assert!(
            verify_file_with_stamp(&path, payload.len() as u64, &expected)
                .await
                .unwrap()
        );
        assert!(verification_stamp_path(&path).unwrap().exists());
        assert!(stamp_matches(&path, payload.len() as u64, &expected)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn changed_model_invalidates_stamp_and_fails_sha() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiny.gguf");
        let original = b"original";
        tokio::fs::write(&path, original).await.unwrap();
        let expected = hex::encode(Sha256::digest(original));
        assert!(
            verify_file_with_stamp(&path, original.len() as u64, &expected)
                .await
                .unwrap()
        );

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        tokio::fs::write(&path, b"modified").await.unwrap();
        assert!(
            !verify_file_with_stamp(&path, original.len() as u64, &expected)
                .await
                .unwrap()
        );
    }
}
