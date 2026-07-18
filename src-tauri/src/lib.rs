mod clients;
mod database;
mod tasks;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub(crate) struct DatabaseState {
    pub(crate) connection: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("local-crm.sqlite3");

            let connection =
                database::initialize_database(&database_path).map_err(std::io::Error::other)?;

            app.manage(DatabaseState {
                connection: Mutex::new(connection),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            clients::create_client,
            clients::list_clients,
            clients::update_client,
            clients::set_client_archived,
            clients::delete_client,
            tasks::create_task,
            tasks::list_tasks,
            tasks::update_task,
            tasks::set_task_status,
            tasks::delete_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
