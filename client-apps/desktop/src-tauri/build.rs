fn main() {
    // The notification plugin's macOS half is Swift, linked as a static
    // library that loads Swift's concurrency runtime by `@rpath`. Without the
    // system's Swift directory on the rpath the app aborts in dyld at launch
    // ("Library not loaded: @rpath/libswift_Concurrency.dylib"), which the
    // plugin's own build does not arrange.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build();
}
