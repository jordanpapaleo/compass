use tauri::Emitter;
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
