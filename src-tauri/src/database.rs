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

            CREATE TABLE IF NOT EXISTS business_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                business_name TEXT NOT NULL DEFAULT '',
                identification TEXT,
                phone TEXT,
                email TEXT,
                address TEXT,
                currency TEXT NOT NULL DEFAULT 'CRC'
                    CHECK (currency IN ('CRC', 'USD', 'EUR')),
                default_tax_basis_points INTEGER NOT NULL DEFAULT 1300
                    CHECK (default_tax_basis_points BETWEEN 0 AND 10000),
                default_validity_days INTEGER NOT NULL DEFAULT 15
                    CHECK (default_validity_days BETWEEN 1 AND 365),
                terms TEXT,
                logo_mime_type TEXT,
                logo_data BLOB,
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                )
            );

            INSERT OR IGNORE INTO business_settings (id) VALUES (1);

            CREATE TABLE IF NOT EXISTS quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quote_number TEXT NOT NULL UNIQUE,
                client_id INTEGER NOT NULL,
                client_name TEXT NOT NULL,
                client_identification TEXT,
                client_phone TEXT,
                client_email TEXT,
                client_address TEXT,
                business_name TEXT NOT NULL,
                business_identification TEXT,
                business_phone TEXT,
                business_email TEXT,
                business_address TEXT,
                currency TEXT NOT NULL,
                issue_date TEXT NOT NULL,
                valid_until TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
                discount_basis_points INTEGER NOT NULL DEFAULT 0
                    CHECK (discount_basis_points BETWEEN 0 AND 10000),
                tax_basis_points INTEGER NOT NULL DEFAULT 0
                    CHECK (tax_basis_points BETWEEN 0 AND 10000),
                subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
                discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
                tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0),
                total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
                notes TEXT,
                terms TEXT,
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS quote_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quote_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                quantity_millis INTEGER NOT NULL CHECK (quantity_millis > 0),
                unit TEXT NOT NULL,
                unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
                position INTEGER NOT NULL,
                FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_quotes_status_date
                ON quotes (status, issue_date DESC);

            CREATE INDEX IF NOT EXISTS idx_quotes_client
                ON quotes (client_id);

            CREATE INDEX IF NOT EXISTS idx_quote_items_quote_position
                ON quote_items (quote_id, position);

            CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK (length(trim(title)) >= 2),
                description TEXT,
                client_id INTEGER,
                event_type TEXT NOT NULL DEFAULT 'appointment'
                    CHECK (event_type IN ('appointment', 'meeting', 'call', 'reminder', 'other')),
                status TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
                starts_at TEXT NOT NULL,
                ends_at TEXT,
                is_all_day INTEGER NOT NULL DEFAULT 0
                    CHECK (is_all_day IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_calendar_events_start_status
                ON calendar_events (starts_at, status);

            CREATE INDEX IF NOT EXISTS idx_calendar_events_client
                ON calendar_events (client_id);

            PRAGMA user_version = 4;
            ",
        )
        .map_err(|error| format!("No se pudo preparar la base de datos: {error}"))?;

    Ok(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_the_calendar_schema_at_version_four() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let database_path = std::env::temp_dir().join(format!(
            "local-crm-schema-{}-{unique_suffix}.sqlite3",
            std::process::id()
        ));

        let connection =
            initialize_database(&database_path).expect("the database should initialize correctly");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("the schema version should be readable");
        let calendar_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'",
                [],
                |row| row.get(0),
            )
            .expect("the calendar table should be readable");

        assert_eq!(version, 4);
        assert_eq!(calendar_table_count, 1);

        drop(connection);
        std::fs::remove_file(database_path).expect("the temporary database should be removable");
    }
}
