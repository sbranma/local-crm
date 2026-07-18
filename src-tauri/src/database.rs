use rusqlite::Connection;
use std::{fs, path::Path};

pub fn initialize_database(database_path: &Path) -> Result<Connection, String> {
    if let Some(parent_directory) = database_path.parent() {
        fs::create_dir_all(parent_directory)
            .map_err(|error| format!("No se pudo crear la carpeta de datos: {error}"))?;
    }

    let connection = Connection::open(database_path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;

    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                phone TEXT,
                email TEXT,
                identification TEXT,
                address TEXT,
                notes TEXT,
                is_archived INTEGER NOT NULL DEFAULT 0
                    CHECK (is_archived IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                )
            );

            CREATE INDEX IF NOT EXISTS idx_clients_archived_name
                ON clients (is_archived, name COLLATE NOCASE);

            PRAGMA user_version = 1;
            ",
        )
        .map_err(|error| format!("No se pudo preparar la base de datos: {error}"))?;

    Ok(connection)
}
