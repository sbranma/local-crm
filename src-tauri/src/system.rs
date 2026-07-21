use crate::DatabaseState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{path::Path, process::Command};
use tauri::State;

const LAST_BACKUP_AT_KEY: &str = "last_backup_at";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    data_directory: String,
    database_path: String,
    documents_path: String,
    last_backup_at: Option<String>,
    app_version: &'static str,
    author: &'static str,
    license: &'static str,
}

#[tauri::command]
pub fn get_system_info(state: State<'_, DatabaseState>) -> Result<SystemInfo, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos local.".to_owned())?;
    system_info(state.inner(), &connection)
}

#[tauri::command]
pub fn open_data_directory(state: State<'_, DatabaseState>) -> Result<(), String> {
    let directory = data_directory(&state.database_path)?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("No se pudo preparar la carpeta de datos: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(directory)
            .spawn()
            .map_err(|error| format!("No se pudo abrir la carpeta de datos: {error}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = directory;
        Err("Abrir la carpeta de datos solo está disponible en Windows.".to_owned())
    }
}

pub(crate) fn record_successful_backup(connection: &Connection) -> Result<String, String> {
    let timestamp: String = connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("No se pudo registrar la fecha del respaldo: {error}"))?;

    connection
        .execute(
            "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![LAST_BACKUP_AT_KEY, timestamp],
        )
        .map_err(|error| format!("No se pudo registrar la fecha del respaldo: {error}"))?;

    Ok(timestamp)
}

fn system_info(state: &DatabaseState, connection: &Connection) -> Result<SystemInfo, String> {
    let last_backup_at = connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [LAST_BACKUP_AT_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el último respaldo: {error}"))?;

    Ok(SystemInfo {
        data_directory: path_to_string(data_directory(&state.database_path)?),
        database_path: path_to_string(&state.database_path),
        documents_path: path_to_string(&state.documents_path),
        last_backup_at,
        app_version: env!("CARGO_PKG_VERSION"),
        author: env!("CARGO_PKG_AUTHORS"),
        license: env!("CARGO_PKG_LICENSE"),
    })
}

fn data_directory(database_path: &Path) -> Result<&Path, String> {
    database_path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de datos local.".to_owned())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::initialize_database;
    use std::{
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn records_and_reports_the_last_successful_backup() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("local-crm-system-{}-{unique}", std::process::id()));
        let database_path = root.join("local-crm.sqlite3");
        let documents_path = root.join("documents");
        std::fs::create_dir_all(&documents_path).expect("documents directory should be created");
        let connection = initialize_database(&database_path).expect("database should initialize");
        let recorded_at = record_successful_backup(&connection).expect("backup should be recorded");
        let state = DatabaseState {
            connection: Mutex::new(connection),
            database_path,
            documents_path,
        };
        let connection = state
            .connection
            .lock()
            .expect("database should be available");

        let info = system_info(&state, &connection).expect("system info should load");

        assert_eq!(info.last_backup_at.as_deref(), Some(recorded_at.as_str()));
        assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
        drop(connection);
        drop(state);
        std::fs::remove_dir_all(root).expect("temporary directory should be removable");
    }
}
