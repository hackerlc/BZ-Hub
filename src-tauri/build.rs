fn build_taskbar_xaml_bridge() {
    use std::{env, path::PathBuf, process::Command};

    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("windows").join("taskbar_xaml_bridge.cpp");
    let output_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let output_dll = output_dir.join("bz-hub-taskbar-xaml-bridge.dll");
    let output_object = output_dir.join("bz-hub-taskbar-xaml-bridge.obj");
    let output_pdb = output_dir.join("bz-hub-taskbar-xaml-bridge.pdb");

    println!("cargo:rerun-if-changed={}", source.display());

    let compiler = cc::Build::new().cpp(true).get_compiler();
    if !compiler.is_like_msvc() {
        panic!("the Windows taskbar XAML bridge currently requires the MSVC toolchain");
    }

    let mut command: Command = compiler.to_command();
    command
        .current_dir(&output_dir)
        .arg("/nologo")
        .arg("/utf-8")
        .arg("/std:c++20")
        .arg("/permissive-")
        .arg("/EHsc")
        .arg("/O2")
        .arg("/MT")
        .arg("/LD")
        .arg("/DUNICODE")
        .arg("/D_UNICODE")
        .arg(format!("/Fo{}", output_object.display()))
        .arg(format!("/Fd{}", output_pdb.display()))
        .arg(format!("/Fe{}", output_dll.display()))
        .arg(&source)
        .arg("/link")
        .arg("/NOLOGO")
        .arg("/INCREMENTAL:NO")
        .arg("/OPT:REF")
        .arg("/OPT:ICF")
        .arg("/EXPORT:DllGetClassObject")
        .arg("/EXPORT:DllCanUnloadNow")
        .arg("kernel32.lib")
        .arg("user32.lib")
        .arg("ole32.lib")
        .arg("oleaut32.lib")
        .arg("runtimeobject.lib")
        .arg("windowsapp.lib");

    let status = command
        .status()
        .expect("failed to start MSVC for the taskbar XAML bridge");
    if !status.success() {
        panic!("failed to compile the Windows taskbar XAML bridge");
    }

    println!(
        "cargo:rustc-env=BZ_TASKBAR_XAML_BRIDGE_DLL={}",
        output_dll.display()
    );
}

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        build_taskbar_xaml_bridge();
    }

    tauri_build::build()
}
