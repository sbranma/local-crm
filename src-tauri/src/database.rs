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

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK (length(trim(title)) >= 2),
                description TEXT,
                client_id INTEGER,
                priority TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high')),
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed')),
                scheduled_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status_scheduled
                ON tasks (status, scheduled_at);

            CREATE INDEX IF NOT EXISTS idx_tasks_client
                ON tasks (client_id);

            PRAGMA user_version = 2;
            ",
        )
        .map_err(|error| format!("No se pudo preparar la base de datos: {error}"))?;

    Ok(connection)
}
