fn main() {
    // `generate_context!` bakes the window/tray icon RGBA in at macro-expansion
    // time with no tracked input, so regenerated icons keep shipping stale
    // embedded pixels unless the crate itself recompiles. Exporting a
    // fingerprint that lib.rs reads via `env!` makes rustc re-expand the macro
    // whenever the ICO bytes change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!(
        "cargo:rustc-env=OVERLAYTRANS_ICON_FINGERPRINT={}",
        icon_fingerprint()
    );
    tauri_build::build()
}

fn icon_fingerprint() -> String {
    let bytes = std::fs::read("icons/icon.ico").unwrap_or_default();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}
