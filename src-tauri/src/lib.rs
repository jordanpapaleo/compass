use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager};

/// Handle to the gateway sidecar process so we can kill it on app exit.
struct GatewaySidecar(Mutex<Option<Child>>);

/// Spawn the Compass gateway as a supervised child process.
///
/// Dev builds run the gateway from the repo with system `node` (>= 24, which
/// executes TypeScript natively). Packaged builds will ship a bundled sidecar
/// binary instead — see DECISIONS.md. Failure to spawn is non-fatal: the app
/// still opens and the dashboard reports the gateway as offline (it may also
/// already be running externally via `npm run dev`, which is fine — the child
/// simply exits when the port is taken).
fn spawn_gateway() -> Option<Child> {
    let gateway_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../gateway");
    match Command::new("node")
        .args(["--env-file-if-exists=.env", "src/index.ts"])
        .current_dir(gateway_dir)
        .spawn()
    {
        Ok(child) => {
            println!("compass: gateway sidecar spawned (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            // Likely `node` missing from PATH (GUI-launched apps get a minimal
            // PATH on macOS) — dev runs from a terminal are unaffected.
            eprintln!("compass: failed to spawn gateway sidecar: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ── Gateway sidecar ───────────────────────────────────────────
            app.manage(GatewaySidecar(Mutex::new(spawn_gateway())));

            // ── Compass (app) menu ────────────────────────────────────────
            let about_metadata = AboutMetadataBuilder::new()
                .version(Some(app.package_info().version.to_string()))
                .copyright(Some("© 2026 Jordan Papaleo".to_string()))
                .build();

            let settings_item = MenuItemBuilder::new("Settings…")
                .id("open_settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Compass")
                .item(&PredefinedMenuItem::about(app, Some("About Compass"), Some(about_metadata))?)
                .separator()
                .item(&settings_item)
                .item(&PredefinedMenuItem::services(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, Some("Hide Compass"))?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Compass"))?)
                .build()?;

            // ── Edit menu ─────────────────────────────────────────────────
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == "open_settings" {
                    let _ = app_handle.emit("open-settings", ());
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill the gateway child when the app exits so we never leak a
            // background node process.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<GatewaySidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
