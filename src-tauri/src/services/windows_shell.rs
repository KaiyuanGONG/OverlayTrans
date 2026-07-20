use std::path::{Path, PathBuf};

pub fn versioned_icon_filename() -> String {
    format!("OverlayTrans-{}.ico", env!("CARGO_PKG_VERSION"))
}

fn shortcut_candidates(desktop: &Path, roaming: &Path) -> Vec<PathBuf> {
    let programs = roaming.join("Microsoft/Windows/Start Menu/Programs");
    vec![
        desktop.join("OverlayTrans.lnk"),
        programs.join("OverlayTrans.lnk"),
        programs.join("OverlayTrans/OverlayTrans.lnk"),
    ]
}

#[cfg(windows)]
pub fn refresh_owned_shortcuts(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    let Ok(resource_dir) = app.path().resource_dir() else {
        return;
    };
    let icon = resource_dir.join(versioned_icon_filename());
    if !icon.is_file() {
        log::debug!(
            "Versioned shortcut icon is not packaged at {}",
            icon.display()
        );
        return;
    }
    let Some(desktop) = dirs_next::desktop_dir() else {
        return;
    };
    let Some(roaming) = dirs_next::data_dir() else {
        return;
    };
    let shortcuts = shortcut_candidates(&desktop, &roaming);

    std::thread::spawn(move || {
        if let Err(error) = refresh_shortcuts_worker(&executable, &icon, &shortcuts) {
            log::warn!("Failed to refresh Windows shortcuts: {error}");
        }
    });
}

#[cfg(not(windows))]
pub fn refresh_owned_shortcuts(_app: &tauri::AppHandle) {}

#[cfg(windows)]
fn refresh_shortcuts_worker(
    executable: &Path,
    icon: &Path,
    shortcuts: &[PathBuf],
) -> windows::core::Result<()> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHChangeNotify, ShellLink, SHCNE_UPDATEITEM, SHCNF_PATHW,
    };

    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
    let _guard = ComGuard;

    let executable_canonical = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.to_path_buf());
    let executable_wide = wide(executable);
    let working_directory_wide = wide(executable.parent().unwrap_or_else(|| Path::new(".")));
    let icon_wide = wide(icon);

    for shortcut in shortcuts.iter().filter(|path| path.is_file()) {
        let link: IShellLinkW =
            unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
        let persist: IPersistFile = link.cast()?;
        let shortcut_wide = wide(shortcut);
        if unsafe { persist.Load(PCWSTR(shortcut_wide.as_ptr()), STGM_READWRITE) }.is_err() {
            continue;
        }
        let mut target = vec![0u16; 32_768];
        if unsafe { link.GetPath(&mut target, std::ptr::null_mut(), 0) }.is_err() {
            continue;
        }
        let target_length = target
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(target.len());
        let target = PathBuf::from(String::from_utf16_lossy(&target[..target_length]));
        let target_canonical = target.canonicalize().unwrap_or(target);
        if !target_canonical
            .to_string_lossy()
            .eq_ignore_ascii_case(&executable_canonical.to_string_lossy())
        {
            continue;
        }

        unsafe {
            link.SetPath(PCWSTR(executable_wide.as_ptr()))?;
            link.SetWorkingDirectory(PCWSTR(working_directory_wide.as_ptr()))?;
            link.SetIconLocation(PCWSTR(icon_wide.as_ptr()), 0)?;
            persist.Save(PCWSTR(shortcut_wide.as_ptr()), true)?;
            SHChangeNotify(
                SHCNE_UPDATEITEM,
                SHCNF_PATHW,
                Some(shortcut_wide.as_ptr().cast()),
                None,
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{shortcut_candidates, versioned_icon_filename};
    use std::path::Path;

    #[test]
    fn shortcut_icon_filename_is_versioned() {
        let filename = versioned_icon_filename();
        assert!(filename.starts_with("OverlayTrans-"));
        assert!(filename.ends_with(".ico"));
        assert!(filename.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn shortcut_candidates_cover_desktop_and_start_menu_layouts() {
        let candidates = shortcut_candidates(Path::new("D:/Desktop"), Path::new("D:/Roaming"));
        assert_eq!(candidates.len(), 3);
        assert!(candidates[0].ends_with("Desktop/OverlayTrans.lnk"));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("Programs/OverlayTrans.lnk")));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("OverlayTrans/OverlayTrans.lnk")));
    }
}
