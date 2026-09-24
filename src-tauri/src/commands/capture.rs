/// Commands for triggering the screen capture + OCR + translation pipeline.
use tauri::{AppHandle, Emitter, Manager, State};

use crate::models::{
    config::{ApiConfig, CaptureRegion, TranslationMode},
    translation::{
        ChunkPayload, ContextEntry, ErrorPayload, StatusPayload, TranslationResult, WarningPayload,
    },
};
use crate::services::{
    change_detector, ocr_winrt, overlay_metrics, screen_capture,
    translate_online::{self, compute_image_digest, OnlineTranslator, StreamObserver},
    AppState, Generation,
};
use crate::utils::image_processing::LogicalRect;

async fn wait_for_auto_interval(
    config: &std::sync::Arc<tokio::sync::Mutex<crate::models::config::AppConfig>>,
    notify: &std::sync::Arc<tokio::sync::Notify>,
) {
    loop {
        let interval_ms = config.lock().await.trigger.auto_interval_ms.max(100);
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(interval_ms)) => return,
            _ = notify.notified() => {}
        }
    }
}

pub(crate) fn compute_ocr_region_for_scale(
    region: &CaptureRegion,
    scale: f64,
) -> Result<LogicalRect, String> {
    // Prefer measurement-based insets when available (eliminates DPI rounding).
    // Measured insets are physical pixels from the frontend's getBoundingClientRect().
    if let Some(insets) = &region.measured_insets {
        let [left, top, right, bottom] = *insets;
        let width = region.width as i32 - left - right;
        let height = region.height as i32 - top - bottom;
        if width > 0 && height > 0 {
            return Ok(LogicalRect {
                x: region.x.saturating_add(left),
                y: region.y.saturating_add(top),
                width: width as u32,
                height: height as u32,
            });
        }
        // If measured insets produce non-positive dimension, fall through to formula.
    }

    // Fallback: compute from logical constants + scale factor.
    if !scale.is_finite() || scale <= 0.0 {
        return Err("无效的屏幕缩放比例。".to_string());
    }

    let border_px = if region.show_border {
        (overlay_metrics::BORDER_PX * scale).round() as i32
    } else {
        0
    };
    let title_h = (overlay_metrics::TITLE_H * scale).round() as i32;

    let width = region.width as i32 - border_px * 2;
    let height = region.height as i32 - title_h - border_px;

    if width <= 0 || height <= 0 {
        return Err("采集框太小，请放大后重试。".to_string());
    }

    Ok(LogicalRect {
        // Preserve negative coordinates for monitors left/above the primary
        // display, while clamping integer overflow at the desktop boundary.
        x: region.x.saturating_add(border_px),
        y: region.y.saturating_add(title_h),
        width: width as u32,
        height: height as u32,
    })
}

pub(crate) fn compute_ocr_region(
    app: &AppHandle,
    region: &CaptureRegion,
) -> Result<LogicalRect, String> {
    let mut current = region.clone();
    let scale = if let Some(window) = app.get_webview_window("capture") {
        if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
            current = capture_region_with_window_geometry(
                region,
                position.x,
                position.y,
                size.width,
                size.height,
            );
        }
        window.scale_factor().unwrap_or(1.0)
    } else {
        1.0
    };

    compute_ocr_region_for_scale(&current, scale)
}

fn capture_region_with_window_geometry(
    region: &CaptureRegion,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> CaptureRegion {
    let mut current = region.clone();
    current.x = x;
    current.y = y;
    current.width = width;
    current.height = height;
    current
}

/// Manual translation trigger — called by the frontend or by hotkey handler.
#[tauri::command]
pub async fn trigger_translation_manual(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    run_pipeline(&app, &state).await
}

/// Start automatic mode: Tokio timer triggers the pipeline at the configured interval.
#[tauri::command]
pub async fn start_auto_mode(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    start_auto_mode_internal(&app, &state).await
}

pub async fn start_auto_mode_internal(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let mut handle_lock = state.auto_mode_handle.lock().await;

    // Abort any existing auto-mode task
    if let Some(h) = handle_lock.take() {
        h.abort();
    }

    let state_config = state.config.clone();
    let state_context = state.context.clone();
    let state_phash = state.last_phash.clone();
    let state_last_ocr_text = state.last_ocr_text.clone();
    let state_screenshot = state.last_screenshot_raw.clone();
    let state_pipeline_mutex = state.pipeline_mutex.clone();
    let state_auto_notify = state.auto_mode_notify.clone();
    let state_local_runtime = state.local_runtime.clone();
    let app_clone = app.clone();

    let state_gen = state.generation.clone();

    let task = tokio::spawn(async move {
        // First trigger fires immediately (explicit, not from interval artifact).
        let mut first = true;
        loop {
            if !first {
                wait_for_auto_interval(&state_config, &state_auto_notify).await;
            }
            first = false;

            // Pipeline mutex — skip if another pipeline is running.
            // Do NOT emit "idle" here — a manual pipeline may be streaming.
            let _guard = match state_pipeline_mutex.try_lock() {
                Ok(g) => g,
                Err(_) => continue,
            };

            // Every accepted auto pipeline gets a distinct generation.
            let gen = state_gen.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;

            let cfg = state_config.lock().await.clone();

            let region = match compute_ocr_region(&app_clone, &cfg.capture_region) {
                Ok(region) => region,
                Err(msg) => {
                    emit_status(&app_clone, "error", gen);
                    emit_error(&app_clone, &msg, gen);
                    continue;
                }
            };

            let img = match screen_capture::capture_region(region).await {
                Ok(img) => img,
                Err(e) => {
                    log::warn!("Capture failed: {e}");
                    continue;
                }
            };

            // Change detection
            let changed = {
                let mut last = state_phash.lock().await;
                if state_gen.load(std::sync::atomic::Ordering::SeqCst) != gen {
                    continue;
                }
                change_detector::has_changed(&img, &mut last, cfg.trigger.change_threshold)
            };

            if !changed {
                continue;
            }

            // Store raw pixels for screenshot preview.
            {
                let (w, h) = (img.width(), img.height());
                *state_screenshot.lock().await = Some((img.as_raw().clone(), w, h));
            }

            // Run OCR + translate with the cloned state handles; the spawned
            // auto task cannot hold a `State<AppState>`.
            if let Err(e) = emit_ocr_and_translate_auto(
                &app_clone,
                &img,
                &state_context,
                &state_last_ocr_text,
                true,
                &cfg,
                gen,
                &state_gen,
                &state_local_runtime,
            )
            .await
            {
                let msg = e.to_string();
                emit_status(&app_clone, "error", gen);
                emit_error(&app_clone, &msg, gen);
            }
        }
    });

    *handle_lock = Some(task);
    let _ = app.emit("auto-mode-changed", true);
    Ok(())
}

/// Stop automatic mode.
#[tauri::command]
pub async fn stop_auto_mode(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_auto_mode_internal(&app, &state).await
}

pub async fn stop_auto_mode_internal(app: &AppHandle, state: &AppState) -> Result<(), String> {
    if let Some(h) = state.auto_mode_handle.lock().await.take() {
        h.abort();
    }
    let _ = app.emit("auto-mode-changed", false);
    Ok(())
}

/// Helper: emit a status event with generation.
fn emit_status(app: &AppHandle, status: &str, gen: Generation) {
    let _ = app.emit(
        "translation-status",
        StatusPayload {
            status: status.to_string(),
            generation: gen,
        },
    );
}

/// Helper: emit a chunk event with generation.
fn emit_chunk(app: &AppHandle, text: &str, gen: Generation) {
    let _ = app.emit(
        "translation-chunk",
        ChunkPayload {
            text: text.to_string(),
            generation: gen,
        },
    );
}

/// Helper: emit an error event with generation.
fn emit_error(app: &AppHandle, error: &str, gen: Generation) {
    let _ = app.emit(
        "translation-error",
        ErrorPayload {
            error: error.to_string(),
            generation: gen,
        },
    );
}

/// Helper: emit a warning event with generation.
fn emit_warning(app: &AppHandle, message: &str, gen: Generation) {
    let _ = app.emit(
        "translation-warning",
        WarningPayload {
            message: message.to_string(),
            generation: gen,
        },
    );
}

#[derive(Debug, thiserror::Error)]
enum QualityPipelineError {
    #[error("{0}")]
    Configuration(String),
    #[error("{0}")]
    Stale(String),
    #[error("{0}")]
    Internal(anyhow::Error),
    #[error(transparent)]
    Runtime(#[from] anyhow::Error),
}

#[derive(Debug, PartialEq, Eq)]
enum QualityExecution {
    Quality,
    SpeedFallback,
}

/// Execute Quality once and, only for a runtime failure, Speed once.
/// Configuration and stale-generation failures are terminal and never fallback.
async fn run_quality_with_one_fallback<Q, QFuture, S, SFuture, W>(
    quality: Q,
    speed: S,
    on_fallback: W,
) -> anyhow::Result<QualityExecution>
where
    Q: FnOnce() -> QFuture,
    QFuture: std::future::Future<Output = Result<(), QualityPipelineError>>,
    S: FnOnce() -> SFuture,
    SFuture: std::future::Future<Output = anyhow::Result<()>>,
    W: FnOnce(&str),
{
    match quality().await {
        Ok(()) => Ok(QualityExecution::Quality),
        Err(QualityPipelineError::Configuration(message))
        | Err(QualityPipelineError::Stale(message)) => Err(anyhow::anyhow!(message)),
        Err(QualityPipelineError::Internal(error)) => Err(error),
        Err(QualityPipelineError::Runtime(quality_error)) => {
            let quality_message = quality_error.to_string();
            on_fallback(&quality_message);
            speed().await.map(|()| QualityExecution::SpeedFallback).map_err(
                |speed_error| {
                    anyhow::anyhow!(
                        "Quality translation failed: {quality_message}; Speed fallback failed: {speed_error}"
                    )
                },
            )
        }
    }
}

fn quality_provider_label(api: &ApiConfig) -> String {
    api.resolved_vision_profile().provider.to_string()
}

fn concise_quality_failure_reason(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("timeout") || lower.contains("timed out") {
        "请求超时"
    } else if lower.contains("429")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("504")
        || lower.contains("service unavailable")
    {
        "服务暂不可用"
    } else if lower.contains("json") || lower.contains("response") || lower.contains("stream ended")
    {
        "响应格式异常"
    } else {
        "服务请求失败"
    }
}

/// Local mode deliberately exposes no remote fallback callback. Keeping this
/// boundary explicit makes a future accidental Local → Speed fallback fail
/// code review and keeps the behavior directly testable.
async fn run_local_without_remote_fallback<L, LFuture>(local: L) -> anyhow::Result<()>
where
    L: FnOnce() -> LFuture,
    LFuture: std::future::Future<Output = anyhow::Result<()>>,
{
    local().await
}

/// The shared OCR → translate → emit pipeline.
async fn run_pipeline(app: &AppHandle, state: &AppState) -> Result<(), String> {
    // Pipeline mutex — prevent concurrent runs
    let _guard = match state.pipeline_mutex.try_lock() {
        Ok(guard) => guard,
        Err(_) => return Ok(()),
    };

    // Every accepted manual pipeline gets a distinct generation.
    let gen = state.next_generation();

    let cfg = state.config.lock().await.clone();

    let region = compute_ocr_region(app, &cfg.capture_region)?;

    emit_status(app, "capturing", gen);

    let img = match screen_capture::capture_region(region).await {
        Ok(img) => img,
        Err(e) => {
            let msg = e.to_string();
            emit_status(app, "error", gen);
            emit_error(app, &msg, gen);
            return Err(msg);
        }
    };

    // Store raw pixels for the screenshot preview feature.
    {
        let (w, h) = (img.width(), img.height());
        *state.last_screenshot_raw.lock().await = Some((img.as_raw().clone(), w, h));
    }

    // Manual trigger: always translate regardless of whether the image changed.
    {
        let mut last = state.last_phash.lock().await;
        if state.current_generation() != gen {
            return Err("Generation changed before change-detection update".to_string());
        }
        change_detector::has_changed(&img, &mut last, cfg.trigger.change_threshold);
    }

    match emit_ocr_and_translate(app, &img, state, false, &cfg, gen).await {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            emit_status(app, "error", gen);
            emit_error(app, &msg, gen);
            Err(msg)
        }
    }
}

async fn emit_ocr_and_translate(
    app: &AppHandle,
    img: &image::RgbaImage,
    state: &AppState,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
) -> anyhow::Result<()> {
    let mode = &cfg.translation.mode;

    match mode {
        TranslationMode::Quality => run_quality_with_one_fallback(
            || run_quality_pipeline(app, img, state, cfg, gen),
            || run_speed_pipeline(app, img, state, skip_if_same_source, cfg, gen),
            |reason| {
                log::warn!("Quality mode failed, attempting Speed fallback: {reason}");
                let concise = concise_quality_failure_reason(reason);
                emit_warning(
                    app,
                    &format!("图像翻译失败，已改用文本翻译：{concise}"),
                    gen,
                );
            },
        )
        .await
        .map(|_| ()),
        TranslationMode::Speed => {
            run_speed_pipeline(app, img, state, skip_if_same_source, cfg, gen).await
        }
        TranslationMode::Local => {
            // Local mode: WinRT OCR → local llama.cpp translate (NO remote fallback)
            run_local_without_remote_fallback(|| {
                run_local_pipeline(app, img, state, skip_if_same_source, cfg, gen)
            })
            .await
        }
    }
}

/// Run the Quality (VLM) pipeline: screenshot → VLM multimodal translate.
async fn run_quality_pipeline(
    app: &AppHandle,
    img: &image::RgbaImage,
    state: &AppState,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
) -> Result<(), QualityPipelineError> {
    use anyhow::Context;

    let vision_profile = cfg.api.resolved_vision_profile();

    // Validate the resolved image profile BEFORE any network request.
    if !vision_profile.supports_vision() {
        return Err(QualityPipelineError::Configuration(
            "当前图像服务不支持图像输入。请前往 API 设置。".to_string(),
        ));
    }

    if vision_profile.model.trim().is_empty() {
        return Err(QualityPipelineError::Configuration(
            "图像模型未配置。请前往 API 设置。".to_string(),
        ));
    }
    let vision_api = vision_profile.to_api_config();
    translate_online::validate_vlm_configuration(&vision_api)
        .map_err(|error| QualityPipelineError::Configuration(error.to_string()))?;

    // Check generation
    if state.current_generation() != gen {
        return Err(QualityPipelineError::Stale(
            "Generation changed, aborting stale pipeline".to_string(),
        ));
    }

    emit_status(app, "translating", gen);

    // Encode screenshot as PNG
    let png_bytes = encode_image_as_png(img).map_err(QualityPipelineError::Internal)?;

    // Compute image digest for cache key
    let image_digest = compute_image_digest(&png_bytes);

    // Run streaming VLM translation
    let context_entries = state.context.lock().await.clone();
    let translator = OnlineTranslator::new();
    let target_lang = &cfg.translation.target_lang;
    let app_clone = app.clone();
    let generation = state.generation.clone();
    let gen_for_chunk = gen;

    let outcome = translator
        .translate_vlm_with_cache(
            &png_bytes,
            &image_digest,
            &context_entries,
            &vision_api,
            target_lang,
            StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk {
                        emit_chunk(&app_clone, chunk, gen_for_chunk);
                    }
                },
                is_current: || {
                    generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk
                },
            },
        )
        .await;

    if state.current_generation() != gen {
        return Err(QualityPipelineError::Stale(
            "Generation changed during VLM translation, discarding result".to_string(),
        ));
    }

    let (translated, latency_ms) = outcome
        .context("VLM translation failed")
        .map_err(QualityPipelineError::Runtime)?;

    // Update context (Quality mode: source is empty, target is the translation)
    {
        let mut ctx = state.context.lock().await;
        if state.current_generation() != gen {
            return Err(QualityPipelineError::Stale(
                "Generation changed before context update".to_string(),
            ));
        }
        ctx.push(ContextEntry {
            source: String::new(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    let provider_label = quality_provider_label(&cfg.api);
    let ocr_engine = format!("vlm-{}", vision_profile.model);

    let result = TranslationResult {
        source: String::new(),
        target: translated,
        ocr_engine,
        translation_engine: "quality".to_string(),
        provider_label,
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Run the Speed pipeline: OCR → text translation.
async fn run_speed_pipeline(
    app: &AppHandle,
    img: &image::RgbaImage,
    state: &AppState,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
) -> anyhow::Result<()> {
    use anyhow::Context;

    emit_status(app, "ocr", gen);

    let source_lang = &cfg.translation.source_lang;
    let winrt_tag = source_lang
        .validate_for_ocr()
        .map_err(|e| anyhow::anyhow!(e))?;

    if !ocr_winrt::is_available_for(winrt_tag) {
        anyhow::bail!(
            "Windows Native OCR is not available for language '{winrt_tag}'. \
             Please install the corresponding Windows language pack."
        );
    }

    let ocr = ocr_winrt::recognize(img, winrt_tag)
        .await
        .context("WinRT OCR failed")?;

    if ocr.is_empty() {
        emit_status(app, "idle", gen);
        return Ok(());
    }

    // CJK de-space
    let raw_text = ocr.text.trim().to_string();
    let source_text = crate::services::translate_online::normalize_cache_key(&raw_text);
    let source_text = if source_text.is_empty() {
        raw_text.clone()
    } else {
        source_text
    };

    if skip_if_same_source {
        let last = state.last_ocr_text.lock().await;
        if last.as_deref() == Some(source_text.as_str()) {
            emit_status(app, "idle", gen);
            return Ok(());
        }
    }

    // Check generation
    if state.current_generation() != gen {
        anyhow::bail!("Generation changed, aborting stale pipeline");
    }

    emit_status(app, "translating", gen);

    // Run streaming translation
    let context_entries = state.context.lock().await.clone();
    let translator = OnlineTranslator::new();
    let target_lang = &cfg.translation.target_lang;
    let app_clone = app.clone();
    let generation = state.generation.clone();
    let gen_for_chunk = gen;

    let (translated, latency_ms) = translator
        .translate_with_cache(
            &source_text,
            &context_entries,
            &cfg.api,
            target_lang,
            &TranslationMode::Speed,
            StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk {
                        emit_chunk(&app_clone, chunk, gen_for_chunk);
                    }
                },
                is_current: || {
                    generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk
                },
            },
        )
        .await
        .context("Translation failed")?;

    // Verify generation before committing state writes
    if state.current_generation() != gen {
        anyhow::bail!("Generation changed during translation, discarding result");
    }

    // Update context
    {
        let mut ctx = state.context.lock().await;
        if state.current_generation() != gen {
            anyhow::bail!("Generation changed before context update");
        }
        ctx.push(ContextEntry {
            source: source_text.clone(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    {
        let mut last = state.last_ocr_text.lock().await;
        if state.current_generation() != gen {
            anyhow::bail!("Generation changed before OCR baseline update");
        }
        *last = Some(source_text.clone());
    }

    let provider_label = cfg.api.provider.to_string();

    let result = TranslationResult {
        source: source_text,
        target: translated,
        ocr_engine: format!("winrt-{winrt_tag}"),
        translation_engine: "speed".to_string(),
        provider_label,
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Encode an RgbaImage as PNG bytes.
fn encode_image_as_png(img: &image::RgbaImage) -> anyhow::Result<Vec<u8>> {
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        use image::codecs::png::PngEncoder;
        use image::ImageEncoder;
        let enc = PngEncoder::new(&mut png_bytes);
        enc.write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ColorType::Rgba8,
        )
        .map_err(|e| anyhow::anyhow!("PNG encoding failed: {e}"))?;
    }
    Ok(png_bytes)
}

/// Run the Local pipeline: WinRT OCR → local llama.cpp translate.
/// NEVER falls back to remote. Fails directly on error.
async fn run_local_pipeline(
    app: &AppHandle,
    img: &image::RgbaImage,
    state: &AppState,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
) -> anyhow::Result<()> {
    use anyhow::Context;

    emit_status(app, "ocr", gen);

    // Local mode still uses WinRT OCR
    let source_lang = &cfg.translation.source_lang;
    let winrt_tag = source_lang
        .validate_for_ocr()
        .map_err(|e| anyhow::anyhow!(e))?;

    if !ocr_winrt::is_available_for(winrt_tag) {
        anyhow::bail!(
            "Windows Native OCR is not available for language '{winrt_tag}'. \
             Please install the corresponding Windows language pack."
        );
    }

    let ocr = ocr_winrt::recognize(img, winrt_tag)
        .await
        .context("WinRT OCR failed")?;

    if ocr.is_empty() {
        emit_status(app, "idle", gen);
        return Ok(());
    }

    let raw_text = ocr.text.trim().to_string();
    let source_text = crate::services::translate_online::normalize_cache_key(&raw_text);
    let source_text = if source_text.is_empty() {
        raw_text.clone()
    } else {
        source_text
    };

    if skip_if_same_source {
        let last = state.last_ocr_text.lock().await;
        if last.as_deref() == Some(source_text.as_str()) {
            emit_status(app, "idle", gen);
            return Ok(());
        }
    }

    if state.current_generation() != gen {
        anyhow::bail!("Generation changed, aborting stale pipeline");
    }

    emit_status(app, "translating", gen);

    // Get local runtime endpoint
    let local = &cfg.local;
    let endpoint = if local.backend == crate::models::config::LocalBackend::BundledLlamaCpp {
        // Use the managed process endpoint
        let runtime = state.local_runtime.read().await;
        runtime
            .translation_endpoint(local)
            .await
            .map_err(|e| anyhow::anyhow!(e))?
    } else {
        crate::services::translate_local::LocalTranslator::effective_endpoint(local)
            .map_err(|e| anyhow::anyhow!(e))?
    };

    let model = crate::services::translate_local::LocalTranslator::effective_model(local)
        .map_err(|e| anyhow::anyhow!(e))?;

    let context_entries = state.context.lock().await.clone();
    let translator = crate::services::translate_local::LocalTranslator::new();
    let target_lang = &cfg.translation.target_lang;
    let app_clone = app.clone();
    let generation = state.generation.clone();
    let gen_for_chunk = gen;

    let (translated, latency_ms) = translator
        .translate_stream(
            &source_text,
            &context_entries,
            &endpoint,
            &model,
            target_lang,
            &mut crate::services::translate_online::StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk {
                        emit_chunk(&app_clone, chunk, gen_for_chunk);
                    }
                },
                is_current: || {
                    generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk
                },
            },
        )
        .await
        .context("Local translation failed")?;

    if state.current_generation() != gen {
        anyhow::bail!("Generation changed during local translation, discarding result");
    }

    // Update context
    {
        let mut ctx = state.context.lock().await;
        if state.current_generation() != gen {
            anyhow::bail!("Generation changed before context update");
        }
        ctx.push(crate::models::translation::ContextEntry {
            source: source_text.clone(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    {
        let mut last = state.last_ocr_text.lock().await;
        if state.current_generation() != gen {
            anyhow::bail!("Generation changed before OCR baseline update");
        }
        *last = Some(source_text.clone());
    }

    let provider_label = match local.backend {
        crate::models::config::LocalBackend::BundledLlamaCpp => "Local (Bundled)".to_string(),
        crate::models::config::LocalBackend::CustomLoopback => "Local (Custom)".to_string(),
    };

    let result = crate::models::translation::TranslationResult {
        source: source_text,
        target: translated,
        ocr_engine: format!("winrt-{winrt_tag}"),
        translation_engine: "local".to_string(),
        provider_label,
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Auto-mode Local pipeline: WinRT OCR → local translate.
#[allow(clippy::too_many_arguments)]
async fn run_local_pipeline_auto(
    app: &AppHandle,
    img: &image::RgbaImage,
    context: &std::sync::Arc<tokio::sync::Mutex<Vec<crate::models::translation::ContextEntry>>>,
    last_ocr_text: &std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
    generation: &std::sync::Arc<std::sync::atomic::AtomicU64>,
    local_runtime: &std::sync::Arc<
        tokio::sync::RwLock<crate::services::local_runtime::LocalRuntime>,
    >,
) -> anyhow::Result<()> {
    use anyhow::Context;

    emit_status(app, "ocr", gen);

    let source_lang = &cfg.translation.source_lang;
    let winrt_tag = source_lang
        .validate_for_ocr()
        .map_err(|e| anyhow::anyhow!(e))?;

    if !ocr_winrt::is_available_for(winrt_tag) {
        anyhow::bail!("Windows Native OCR is not available for language '{winrt_tag}'.");
    }

    let ocr = ocr_winrt::recognize(img, winrt_tag)
        .await
        .context("WinRT OCR failed")?;

    if ocr.is_empty() {
        emit_status(app, "idle", gen);
        return Ok(());
    }

    let raw_text = ocr.text.trim().to_string();
    let source_text = crate::services::translate_online::normalize_cache_key(&raw_text);
    let source_text = if source_text.is_empty() {
        raw_text.clone()
    } else {
        source_text
    };

    if skip_if_same_source {
        let last = last_ocr_text.lock().await;
        if last.as_deref() == Some(source_text.as_str()) {
            emit_status(app, "idle", gen);
            return Ok(());
        }
    }

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        anyhow::bail!("Generation changed, aborting stale pipeline");
    }

    emit_status(app, "translating", gen);

    // Get local runtime endpoint
    let local = &cfg.local;
    let endpoint = if local.backend == crate::models::config::LocalBackend::BundledLlamaCpp {
        let runtime = local_runtime.read().await;
        runtime
            .translation_endpoint(local)
            .await
            .map_err(|e| anyhow::anyhow!(e))?
    } else {
        crate::services::translate_local::LocalTranslator::effective_endpoint(local)
            .map_err(|e| anyhow::anyhow!(e))?
    };

    let model = crate::services::translate_local::LocalTranslator::effective_model(local)
        .map_err(|e| anyhow::anyhow!(e))?;

    let context_entries = context.lock().await.clone();
    let translator = crate::services::translate_local::LocalTranslator::new();
    let app_clone = app.clone();
    let gen_for_chunk = gen;

    let (translated, latency_ms) = translator
        .translate_stream(
            &source_text,
            &context_entries,
            &endpoint,
            &model,
            &cfg.translation.target_lang,
            &mut crate::services::translate_online::StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk {
                        emit_chunk(&app_clone, chunk, gen_for_chunk);
                    }
                },
                is_current: || generation.load(std::sync::atomic::Ordering::SeqCst) == gen,
            },
        )
        .await
        .context("Local translation failed")?;

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        anyhow::bail!("Generation changed during local translation, discarding result");
    }

    {
        let mut ctx = context.lock().await;
        if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
            anyhow::bail!("Generation changed before context update");
        }
        ctx.push(crate::models::translation::ContextEntry {
            source: source_text.clone(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    {
        let mut last = last_ocr_text.lock().await;
        if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
            anyhow::bail!("Generation changed before OCR baseline update");
        }
        *last = Some(source_text.clone());
    }

    let provider_label = match local.backend {
        crate::models::config::LocalBackend::BundledLlamaCpp => "Local (Bundled)".to_string(),
        crate::models::config::LocalBackend::CustomLoopback => "Local (Custom)".to_string(),
    };

    let result = crate::models::translation::TranslationResult {
        source: source_text,
        target: translated,
        ocr_engine: format!("winrt-{winrt_tag}"),
        translation_engine: "local".to_string(),
        provider_label,
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Auto-mode variant of emit_ocr_and_translate.
/// Uses AtomicU64 generation directly (no AppState ref needed in the spawned task).
#[allow(clippy::too_many_arguments)]
async fn emit_ocr_and_translate_auto(
    app: &AppHandle,
    img: &image::RgbaImage,
    context: &std::sync::Arc<tokio::sync::Mutex<Vec<ContextEntry>>>,
    last_ocr_text: &std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
    generation: &std::sync::Arc<std::sync::atomic::AtomicU64>,
    local_runtime: &std::sync::Arc<
        tokio::sync::RwLock<crate::services::local_runtime::LocalRuntime>,
    >,
) -> anyhow::Result<()> {
    match cfg.translation.mode {
        TranslationMode::Quality => run_quality_with_one_fallback(
            || run_quality_pipeline_auto(app, img, context, cfg, gen, generation),
            || {
                run_speed_pipeline_auto(
                    app,
                    img,
                    context,
                    last_ocr_text,
                    skip_if_same_source,
                    cfg,
                    gen,
                    generation,
                )
            },
            |reason| {
                log::warn!("Quality auto failed, attempting Speed fallback: {reason}");
                let concise = concise_quality_failure_reason(reason);
                emit_warning(
                    app,
                    &format!("图像翻译失败，已改用文本翻译：{concise}"),
                    gen,
                );
            },
        )
        .await
        .map(|_| ()),
        TranslationMode::Speed => {
            run_speed_pipeline_auto(
                app,
                img,
                context,
                last_ocr_text,
                skip_if_same_source,
                cfg,
                gen,
                generation,
            )
            .await
        }
        TranslationMode::Local => {
            // Local mode: WinRT OCR → local llama.cpp translate (NO remote fallback)
            run_local_without_remote_fallback(|| {
                run_local_pipeline_auto(
                    app,
                    img,
                    context,
                    last_ocr_text,
                    skip_if_same_source,
                    cfg,
                    gen,
                    generation,
                    local_runtime,
                )
            })
            .await
        }
    }
}

/// Auto-mode Quality pipeline: VLM translate without OCR.
async fn run_quality_pipeline_auto(
    app: &AppHandle,
    img: &image::RgbaImage,
    context: &std::sync::Arc<tokio::sync::Mutex<Vec<ContextEntry>>>,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
    generation: &std::sync::Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), QualityPipelineError> {
    use anyhow::Context;

    let vision_profile = cfg.api.resolved_vision_profile();
    if !vision_profile.supports_vision() {
        return Err(QualityPipelineError::Configuration(
            "当前图像服务不支持图像输入。请前往 API 设置。".to_string(),
        ));
    }

    if vision_profile.model.trim().is_empty() {
        return Err(QualityPipelineError::Configuration(
            "图像模型未配置。请前往 API 设置。".to_string(),
        ));
    }
    let vision_api = vision_profile.to_api_config();
    translate_online::validate_vlm_configuration(&vision_api)
        .map_err(|error| QualityPipelineError::Configuration(error.to_string()))?;

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        return Err(QualityPipelineError::Stale(
            "Generation changed, aborting stale pipeline".to_string(),
        ));
    }

    emit_status(app, "translating", gen);

    let png_bytes = encode_image_as_png(img).map_err(QualityPipelineError::Internal)?;
    let image_digest = compute_image_digest(&png_bytes);

    let context_entries = context.lock().await.clone();
    let translator = OnlineTranslator::new();
    let app_clone = app.clone();
    let gen_for_chunk = gen;

    let outcome = translator
        .translate_vlm_with_cache(
            &png_bytes,
            &image_digest,
            &context_entries,
            &vision_api,
            &cfg.translation.target_lang,
            StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation.load(std::sync::atomic::Ordering::SeqCst) == gen_for_chunk {
                        emit_chunk(&app_clone, chunk, gen_for_chunk);
                    }
                },
                is_current: || generation.load(std::sync::atomic::Ordering::SeqCst) == gen,
            },
        )
        .await;

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        return Err(QualityPipelineError::Stale(
            "Generation changed during VLM translation, discarding result".to_string(),
        ));
    }

    let (translated, latency_ms) = outcome
        .context("VLM translation failed")
        .map_err(QualityPipelineError::Runtime)?;

    {
        let mut ctx = context.lock().await;
        if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
            return Err(QualityPipelineError::Stale(
                "Generation changed before context update".to_string(),
            ));
        }
        ctx.push(ContextEntry {
            source: String::new(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    let result = TranslationResult {
        source: String::new(),
        target: translated,
        ocr_engine: format!("vlm-{}", vision_profile.model),
        translation_engine: "quality".to_string(),
        provider_label: quality_provider_label(&cfg.api),
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Auto-mode Speed pipeline: OCR → text translate.
#[allow(clippy::too_many_arguments)]
async fn run_speed_pipeline_auto(
    app: &AppHandle,
    img: &image::RgbaImage,
    context: &std::sync::Arc<tokio::sync::Mutex<Vec<ContextEntry>>>,
    last_ocr_text: &std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
    skip_if_same_source: bool,
    cfg: &crate::models::config::AppConfig,
    gen: Generation,
    generation: &std::sync::Arc<std::sync::atomic::AtomicU64>,
) -> anyhow::Result<()> {
    use anyhow::Context;

    emit_status(app, "ocr", gen);

    let winrt_tag = cfg
        .translation
        .source_lang
        .validate_for_ocr()
        .map_err(|e| anyhow::anyhow!(e))?;
    if !ocr_winrt::is_available_for(winrt_tag) {
        anyhow::bail!("Windows Native OCR is not available for language '{winrt_tag}'.");
    }

    let ocr = ocr_winrt::recognize(img, winrt_tag)
        .await
        .context("WinRT OCR failed")?;

    if ocr.is_empty() {
        emit_status(app, "idle", gen);
        return Ok(());
    }

    let raw_text = ocr.text.trim().to_string();
    let source_text = crate::services::translate_online::normalize_cache_key(&raw_text);
    let source_text = if source_text.is_empty() {
        raw_text.clone()
    } else {
        source_text
    };

    if skip_if_same_source {
        let last = last_ocr_text.lock().await;
        if last.as_deref() == Some(source_text.as_str()) {
            emit_status(app, "idle", gen);
            return Ok(());
        }
    }

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        anyhow::bail!("Generation changed, aborting stale pipeline");
    }

    emit_status(app, "translating", gen);

    let context_entries = context.lock().await.clone();
    let translator = OnlineTranslator::new();
    let app_clone = app.clone();
    let generation_for_chunk = generation.clone();

    let (translated, latency_ms) = translator
        .translate_with_cache(
            &source_text,
            &context_entries,
            &cfg.api,
            &cfg.translation.target_lang,
            &TranslationMode::Speed,
            StreamObserver {
                on_chunk: |chunk: &str| {
                    if generation_for_chunk.load(std::sync::atomic::Ordering::SeqCst) == gen {
                        emit_chunk(&app_clone, chunk, gen);
                    }
                },
                is_current: || generation.load(std::sync::atomic::Ordering::SeqCst) == gen,
            },
        )
        .await
        .context("Translation failed")?;

    if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
        anyhow::bail!("Generation changed during translation, discarding result");
    }

    {
        let mut ctx = context.lock().await;
        if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
            anyhow::bail!("Generation changed before context update");
        }
        ctx.push(ContextEntry {
            source: source_text.clone(),
            target: translated.clone(),
        });
        let max = cfg.translation.context_size;
        if ctx.len() > max {
            let drain_count = ctx.len() - max;
            ctx.drain(0..drain_count);
        }
    }

    {
        let mut last = last_ocr_text.lock().await;
        if generation.load(std::sync::atomic::Ordering::SeqCst) != gen {
            anyhow::bail!("Generation changed before OCR baseline update");
        }
        *last = Some(source_text.clone());
    }

    let result = TranslationResult {
        source: source_text,
        target: translated,
        ocr_engine: format!("winrt-{winrt_tag}"),
        translation_engine: "speed".to_string(),
        provider_label: cfg.api.provider.to_string(),
        latency_ms,
        generation: gen,
    };

    let _ = app.emit("translation-result", &result);
    emit_status(app, "done", gen);

    Ok(())
}

/// Return the most recent captured screenshot as a base64 PNG data URL,
/// or null if no screenshot has been taken yet.
#[tauri::command]
pub async fn get_last_screenshot(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.last_screenshot_raw.lock().await;
    match guard.as_ref() {
        None => Ok(None),
        Some((raw, w, h)) => {
            let mut png_bytes: Vec<u8> = Vec::new();
            {
                use image::codecs::png::PngEncoder;
                use image::ImageEncoder;
                let enc = PngEncoder::new(&mut png_bytes);
                enc.write_image(raw, *w, *h, image::ColorType::Rgba8)
                    .map_err(|e| e.to_string())?;
            }
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
            Ok(Some(format!("data:image/png;base64,{b64}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{ApiConfig, CaptureRegion, RemoteProviderId, VisionProfileMode};

    #[tokio::test(start_paused = true)]
    async fn auto_interval_resets_when_config_changes() {
        let config = std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::models::config::AppConfig::default(),
        ));
        config.lock().await.trigger.auto_interval_ms = 500;
        let notify = std::sync::Arc::new(tokio::sync::Notify::new());

        let waiter = tokio::spawn({
            let config = config.clone();
            let notify = notify.clone();
            async move { wait_for_auto_interval(&config, &notify).await }
        });

        tokio::time::advance(std::time::Duration::from_millis(250)).await;
        config.lock().await.trigger.auto_interval_ms = 100;
        notify.notify_one();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(99)).await;
        assert!(!waiter.is_finished());
        tokio::time::advance(std::time::Duration::from_millis(1)).await;
        waiter.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn auto_interval_clamps_to_one_hundred_ms() {
        let config = std::sync::Arc::new(tokio::sync::Mutex::new(
            crate::models::config::AppConfig::default(),
        ));
        config.lock().await.trigger.auto_interval_ms = 1;
        let notify = std::sync::Arc::new(tokio::sync::Notify::new());
        let waiter = tokio::spawn({
            let config = config.clone();
            let notify = notify.clone();
            async move { wait_for_auto_interval(&config, &notify).await }
        });

        tokio::time::advance(std::time::Duration::from_millis(99)).await;
        assert!(!waiter.is_finished());
        tokio::time::advance(std::time::Duration::from_millis(1)).await;
        waiter.await.unwrap();
    }

    #[test]
    fn compute_ocr_region_for_scale_basic_case() {
        let region = CaptureRegion {
            x: 200,
            y: 120,
            width: 640,
            height: 200,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: None,
        };

        let ocr = compute_ocr_region_for_scale(&region, 1.0).expect("region should be valid");
        assert_eq!(ocr.x, 206);
        assert_eq!(ocr.y, 144);
        assert_eq!(ocr.width, 628);
        assert_eq!(ocr.height, 170);
    }

    #[test]
    fn live_window_geometry_replaces_debounced_saved_geometry() {
        let region = CaptureRegion {
            x: 200,
            y: 120,
            width: 640,
            height: 200,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: Some([17, 53, 17, 17]),
        };

        let current = capture_region_with_window_geometry(&region, 300, 220, 800, 260);
        assert_eq!((current.x, current.y), (300, 220));
        assert_eq!((current.width, current.height), (800, 260));
        assert_eq!(current.measured_insets, region.measured_insets);
    }

    #[test]
    fn compute_ocr_region_for_scale_respects_high_dpi() {
        let region = CaptureRegion {
            x: 0,
            y: 0,
            width: 800,
            height: 300,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: None,
        };

        let ocr = compute_ocr_region_for_scale(&region, 1.5).expect("region should be valid");
        assert_eq!(ocr.x, 9);
        assert_eq!(ocr.y, 36);
        assert_eq!(ocr.width, 782);
        assert_eq!(ocr.height, 255);
    }

    #[test]
    fn compute_ocr_region_for_scale_rejects_too_small_region() {
        let region = CaptureRegion {
            x: 0,
            y: 0,
            width: 10,
            height: 20,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: None,
        };

        let err =
            compute_ocr_region_for_scale(&region, 2.0).expect_err("region should be rejected");
        assert!(err.contains("采集框太小"));
    }

    #[test]
    fn compute_ocr_region_no_border_skips_border_px() {
        let region = CaptureRegion {
            x: 100,
            y: 100,
            width: 640,
            height: 200,
            border_hue: 0,
            border_opacity: 100,
            show_border: false,
            measured_insets: None,
        };

        let ocr = compute_ocr_region_for_scale(&region, 1.0).expect("region should be valid");
        // No border subtracted — x stays at region.x, only title_h subtracted from y
        assert_eq!(ocr.x, 100);
        assert_eq!(ocr.y, 124);
        assert_eq!(ocr.width, 640);
        assert_eq!(ocr.height, 176);
    }

    #[test]
    fn compute_ocr_region_clamps_coordinate_overflow() {
        let region = CaptureRegion {
            x: i32::MAX - 2,
            y: i32::MAX - 2,
            width: 640,
            height: 200,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: None,
        };

        let ocr = compute_ocr_region_for_scale(&region, 1.0).expect("region should be valid");
        assert_eq!(ocr.x, i32::MAX);
        assert_eq!(ocr.y, i32::MAX);
    }

    #[test]
    fn compute_ocr_region_rejects_invalid_scale() {
        let region = CaptureRegion::default();
        assert!(compute_ocr_region_for_scale(&region, 0.0).is_err());
        assert!(compute_ocr_region_for_scale(&region, f64::NAN).is_err());
    }

    // ── Measured-insets OCR region tests ──

    #[test]
    fn compute_ocr_region_measured_insets_bypass_scale() {
        let region = CaptureRegion {
            x: 100,
            y: 200,
            width: 640,
            height: 300,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: Some([7, 24, 7, 7]), // physical px from frontend
        };

        // Even with a bogus scale, measured insets take priority
        let ocr = compute_ocr_region_for_scale(&region, 999.0).expect("should use measured");
        assert_eq!(ocr.x, 107); // 100 + 7
        assert_eq!(ocr.y, 224); // 200 + 24
        assert_eq!(ocr.width, 626); // 640 - 7 - 7
        assert_eq!(ocr.height, 269); // 300 - 24 - 7
    }

    #[test]
    fn compute_ocr_region_measured_insets_fallback_on_zero_size() {
        // If measured insets produce a non-positive dimension, fall back to formula
        let region = CaptureRegion {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            border_hue: 0,
            border_opacity: 100,
            show_border: true,
            measured_insets: Some([100, 100, 100, 100]), // absurd insets
        };

        // Should fall back to formula (which will also fail for tiny region)
        let result = compute_ocr_region_for_scale(&region, 1.0);
        assert!(result.is_err());
    }

    // ── Typed one-shot fallback tests ──

    #[test]
    fn quality_provider_label_uses_independent_profile() {
        let mut api = ApiConfig::default();
        api.vision.mode = VisionProfileMode::Separate;
        api.vision.provider = RemoteProviderId::Gemini;
        assert_eq!(quality_provider_label(&api), "Gemini");
    }

    #[test]
    fn fallback_reason_is_concise_and_does_not_echo_provider_payload() {
        assert_eq!(
            concise_quality_failure_reason("request timed out after 30s"),
            "请求超时"
        );
        assert_eq!(
            concise_quality_failure_reason("HTTP 503: giant provider body"),
            "服务暂不可用"
        );
        assert_eq!(
            concise_quality_failure_reason("invalid JSON response"),
            "响应格式异常"
        );
    }

    #[tokio::test]
    async fn quality_internal_error_never_runs_fallback() {
        let speed_calls = std::cell::Cell::new(0);
        let result = run_quality_with_one_fallback(
            || async {
                Err(QualityPipelineError::Internal(anyhow::anyhow!(
                    "PNG encoding failed"
                )))
            },
            || async {
                speed_calls.set(speed_calls.get() + 1);
                Ok(())
            },
            |_| {},
        )
        .await;
        assert!(result.is_err());
        assert_eq!(speed_calls.get(), 0);
    }

    #[tokio::test]
    async fn quality_configuration_error_never_runs_fallback() {
        let speed_calls = std::cell::Cell::new(0);
        let warning_calls = std::cell::Cell::new(0);
        let result = run_quality_with_one_fallback(
            || async {
                Err(QualityPipelineError::Configuration(
                    "vision unavailable".to_string(),
                ))
            },
            || async {
                speed_calls.set(speed_calls.get() + 1);
                Ok(())
            },
            |_| warning_calls.set(warning_calls.get() + 1),
        )
        .await;

        assert!(result.is_err());
        assert_eq!(speed_calls.get(), 0);
        assert_eq!(warning_calls.get(), 0);
    }

    #[tokio::test]
    async fn stale_quality_generation_never_runs_fallback() {
        let speed_calls = std::cell::Cell::new(0);
        let result = run_quality_with_one_fallback(
            || async { Err(QualityPipelineError::Stale("stale".to_string())) },
            || async {
                speed_calls.set(speed_calls.get() + 1);
                Ok(())
            },
            |_| {},
        )
        .await;

        assert!(result.is_err());
        assert_eq!(speed_calls.get(), 0);
    }

    #[tokio::test]
    async fn quality_runtime_error_runs_speed_and_warning_exactly_once() {
        let quality_calls = std::cell::Cell::new(0);
        let speed_calls = std::cell::Cell::new(0);
        let warning_calls = std::cell::Cell::new(0);
        let result = run_quality_with_one_fallback(
            || async {
                quality_calls.set(quality_calls.get() + 1);
                Err(QualityPipelineError::Runtime(anyhow::anyhow!(
                    "network failed"
                )))
            },
            || async {
                speed_calls.set(speed_calls.get() + 1);
                Ok(())
            },
            |_| warning_calls.set(warning_calls.get() + 1),
        )
        .await
        .unwrap();

        assert_eq!(result, QualityExecution::SpeedFallback);
        assert_eq!(quality_calls.get(), 1);
        assert_eq!(speed_calls.get(), 1);
        assert_eq!(warning_calls.get(), 1);
    }

    #[tokio::test]
    async fn speed_failure_stops_after_single_fallback_attempt() {
        let quality_calls = std::cell::Cell::new(0);
        let speed_calls = std::cell::Cell::new(0);
        let result = run_quality_with_one_fallback(
            || async {
                quality_calls.set(quality_calls.get() + 1);
                Err(QualityPipelineError::Runtime(anyhow::anyhow!(
                    "quality failed"
                )))
            },
            || async {
                speed_calls.set(speed_calls.get() + 1);
                anyhow::bail!("speed failed")
            },
            |_| {},
        )
        .await
        .unwrap_err();

        assert_eq!(quality_calls.get(), 1);
        assert_eq!(speed_calls.get(), 1);
        assert!(result.to_string().contains("quality failed"));
        assert!(result.to_string().contains("speed failed"));
    }

    #[tokio::test]
    async fn local_failure_is_terminal_without_remote_fallback() {
        let local_calls = std::cell::Cell::new(0);
        let remote_calls = std::cell::Cell::new(0);

        let result = run_local_without_remote_fallback(|| async {
            local_calls.set(local_calls.get() + 1);
            anyhow::bail!("local runtime unavailable")
        })
        .await;

        // There is intentionally no remote closure passed to the Local
        // boundary; this counter models the forbidden fallback path.
        assert!(result.is_err());
        assert_eq!(local_calls.get(), 1);
        assert_eq!(remote_calls.get(), 0);
    }

    // ── PNG encoding test ──

    #[test]
    fn encode_image_as_png_produces_valid_png() {
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([255, 0, 0, 255]));
        let png = encode_image_as_png(&img).unwrap();
        // PNG magic bytes
        assert!(png.len() > 8);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
