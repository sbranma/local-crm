use rusqlite::Connection;
use std::{fs, path::Path};

pub const CURRENT_SCHEMA_VERSION: i64 = 7;

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

            CREATE TABLE IF NOT EXISTS inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_type TEXT NOT NULL
                    CHECK (item_type IN ('product', 'service')),
                name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
                sku TEXT,
                category TEXT,
                description TEXT,
                unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
                cost_price_minor INTEGER NOT NULL DEFAULT 0
                    CHECK (cost_price_minor >= 0),
                sale_price_minor INTEGER NOT NULL DEFAULT 0
                    CHECK (sale_price_minor >= 0),
                current_stock_millis INTEGER NOT NULL DEFAULT 0
                    CHECK (current_stock_millis >= 0),
                minimum_stock_millis INTEGER NOT NULL DEFAULT 0
                    CHECK (minimum_stock_millis >= 0),
                is_archived INTEGER NOT NULL DEFAULT 0
                    CHECK (is_archived IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                CHECK (
                    item_type = 'product'
                    OR (current_stock_millis = 0 AND minimum_stock_millis = 0)
                )
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_sku_unique
                ON inventory_items (lower(sku))
                WHERE sku IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_inventory_items_archived_type_name
                ON inventory_items (is_archived, item_type, name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS inventory_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inventory_item_id INTEGER NOT NULL,
                movement_type TEXT NOT NULL
                    CHECK (movement_type IN ('entry', 'exit', 'adjustment')),
                quantity_delta_millis INTEGER NOT NULL
                    CHECK (quantity_delta_millis != 0),
                previous_stock_millis INTEGER NOT NULL
                    CHECK (previous_stock_millis >= 0),
                new_stock_millis INTEGER NOT NULL
                    CHECK (new_stock_millis >= 0),
                reason TEXT NOT NULL CHECK (length(trim(reason)) >= 2),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (inventory_item_id)
                    REFERENCES inventory_items (id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_date
                ON inventory_movements (inventory_item_id, created_at DESC);

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
                inventory_item_id INTEGER,
                description TEXT NOT NULL,
                quantity_millis INTEGER NOT NULL CHECK (quantity_millis > 0),
                unit TEXT NOT NULL,
                unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
                position INTEGER NOT NULL,
                FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE CASCADE,
                FOREIGN KEY (inventory_item_id)
                    REFERENCES inventory_items (id) ON DELETE RESTRICT
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

            ",
        )
        .map_err(|error| format!("No se pudo preparar la base de datos: {error}"))?;

    migrate_to_current_schema(&connection)?;

    Ok(connection)
}

pub(crate) fn migrate_to_current_schema(connection: &Connection) -> Result<(), String> {
    ensure_quote_item_inventory_column(connection)?;

    connection
        .execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_quote_items_inventory
                ON quote_items (inventory_item_id);

            CREATE TABLE IF NOT EXISTS document_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (parent_id)
                    REFERENCES document_folders (id) ON DELETE RESTRICT,
                CHECK (parent_id IS NULL OR parent_id != id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_document_folders_root_name
                ON document_folders (lower(name))
                WHERE parent_id IS NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_document_folders_parent_name
                ON document_folders (parent_id, lower(name))
                WHERE parent_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER,
                client_id INTEGER,
                display_name TEXT NOT NULL CHECK (
                    length(trim(display_name)) BETWEEN 1 AND 180
                ),
                stored_name TEXT NOT NULL UNIQUE CHECK (
                    length(trim(stored_name)) BETWEEN 1 AND 220
                ),
                extension TEXT NOT NULL CHECK (length(extension) BETWEEN 1 AND 10),
                mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
                size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
                created_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                updated_at TEXT NOT NULL DEFAULT (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ),
                FOREIGN KEY (folder_id)
                    REFERENCES document_folders (id) ON DELETE RESTRICT,
                FOREIGN KEY (client_id)
                    REFERENCES clients (id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_folder_name
                ON documents (folder_id, display_name COLLATE NOCASE);

            CREATE INDEX IF NOT EXISTS idx_documents_client
                ON documents (client_id);

            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY CHECK (length(trim(key)) > 0),
                value TEXT NOT NULL
            );

            PRAGMA user_version = 7;
            ",
        )
        .map_err(|error| format!("No se pudo finalizar la migración local: {error}"))
}

fn ensure_quote_item_inventory_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(quote_items)")
        .map_err(|error| format!("No se pudo revisar la estructura de cotizaciones: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("No se pudieron consultar las columnas: {error}"))?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|error| format!("No se pudieron leer las columnas: {error}"))?;

    if !columns.iter().any(|column| column == "inventory_item_id") {
        connection
            .execute_batch(
                "
                ALTER TABLE quote_items
                    ADD COLUMN inventory_item_id INTEGER
                    REFERENCES inventory_items (id) ON DELETE RESTRICT;
                ",
            )
            .map_err(|error| format!("No se pudo vincular inventario con cotizaciones: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_the_document_and_metadata_schema_at_version_seven() {
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
        let document_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
                [],
                |row| row.get(0),
            )
            .expect("the documents table should be readable");
        let quote_item_inventory_column: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('quote_items') WHERE name = 'inventory_item_id'",
                [],
                |row| row.get(0),
            )
            .expect("the quote item inventory column should be readable");
        let metadata_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'",
                [],
                |row| row.get(0),
            )
            .expect("the metadata table should be readable");

        assert_eq!(version, 7);
        assert_eq!(document_table_count, 1);
        assert_eq!(quote_item_inventory_column, 1);
        assert_eq!(metadata_table_count, 1);

        drop(connection);
        std::fs::remove_file(database_path).expect("the temporary database should be removable");
    }
}
