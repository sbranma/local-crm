mod backups;
mod calendar;
mod clients;
mod database;
mod inventory;
mod pdf_export;
mod quotes;
mod settings;
mod tasks;

use rusqlite::Connection;
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;

pub(crate) struct DatabaseState {
    pub(crate) connection: Mutex<Connection>,
    pub(crate) database_path: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("local-crm.sqlite3");

            let connection =
                database::initialize_database(&database_path).map_err(std::io::Error::other)?;

            app.manage(DatabaseState {
                connection: Mutex::new(connection),
                database_path,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backups::export_backup,
            backups::inspect_backup,
            backups::restore_backup,
            clients::create_client,
            clients::list_clients,
            clients::update_client,
            clients::set_client_archived,
            clients::delete_client,
            calendar::create_calendar_event,
            calendar::list_calendar_events,
            calendar::update_calendar_event,
            calendar::set_calendar_event_status,
            calendar::delete_calendar_event,
            inventory::create_inventory_item,
            inventory::list_inventory_items,
            inventory::update_inventory_item,
            inventory::set_inventory_item_archived,
            inventory::delete_inventory_item,
            inventory::create_inventory_movement,
            inventory::list_inventory_movements,
            tasks::create_task,
            tasks::list_tasks,
            tasks::update_task,
            tasks::set_task_status,
            tasks::delete_task,
            settings::get_business_settings,
            settings::update_business_settings,
            quotes::create_quote,
            quotes::list_quotes,
            quotes::get_quote,
            quotes::update_quote,
            quotes::set_quote_status,
            quotes::delete_quote,
            pdf_export::save_quote_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
