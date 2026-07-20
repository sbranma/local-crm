use crate::DatabaseState;
use rusqlite::{params, Connection, Transaction};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    database_is_empty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoSeedResult {
    clients_created: usize,
    tasks_created: usize,
    events_created: usize,
    inventory_items_created: usize,
    quotes_created: usize,
}

#[tauri::command]
pub fn get_onboarding_status(state: State<'_, DatabaseState>) -> Result<OnboardingStatus, String> {
    let connection = lock_connection(&state)?;
    Ok(OnboardingStatus {
        database_is_empty: database_is_empty(&connection)?,
    })
}

#[tauri::command]
pub fn seed_demo_data(state: State<'_, DatabaseState>) -> Result<DemoSeedResult, String> {
    let mut connection = lock_connection(&state)?;
    seed_demo_data_into(&mut connection)
}

fn seed_demo_data_into(connection: &mut Connection) -> Result<DemoSeedResult, String> {
    if !database_is_empty(connection)? {
        return Err(
            "Los ejemplos solo pueden cargarse cuando la base de datos está vacía. Tus datos actuales no fueron modificados."
                .to_owned(),
        );
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar la carga de ejemplos: {error}"))?;

    transaction
        .execute(
            "
            UPDATE business_settings
            SET
                business_name = ?1,
                identification = ?2,
                phone = ?3,
                email = ?4,
                address = ?5,
                currency = 'CRC',
                default_tax_basis_points = 1300,
                default_validity_days = 15,
                terms = ?6,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = 1
            ",
            params![
                "Servicios Horizonte — Demostración",
                "DEMO-001",
                "+506 2222-0100",
                "contacto@example.invalid",
                "San José, Costa Rica — Dirección ficticia",
                "Datos de demostración. Condiciones sujetas a confirmación.",
            ],
        )
        .map_err(|error| format!("No se pudo preparar el negocio de ejemplo: {error}"))?;

    let ana_id = insert_client(
        &transaction,
        "Ana Morales — Ejemplo",
        "+506 8888-0101",
        "ana.morales@example.invalid",
        "Cliente ficticio para explorar el CRM.",
    )?;
    let cafe_id = insert_client(
        &transaction,
        "Café Mirador — Ejemplo",
        "+506 8888-0102",
        "cafe.mirador@example.invalid",
        "Negocio ficticio usado en la cotización de demostración.",
    )?;
    let constructora_id = insert_client(
        &transaction,
        "Constructora Norte — Ejemplo",
        "+506 8888-0103",
        "proyectos.norte@example.invalid",
        "Cliente ficticio para mostrar tareas y agenda.",
    )?;

    let maintenance_id = insert_inventory_item(
        &transaction,
        "service",
        "Mantenimiento preventivo — Ejemplo",
        Some("SERV-DEMO-01"),
        "Servicios",
        "Revisión general y mantenimiento preventivo de demostración.",
        "servicio",
        2_500_000,
        4_500_000,
        0,
        0,
    )?;
    let diagnostic_id = insert_inventory_item(
        &transaction,
        "service",
        "Diagnóstico técnico — Ejemplo",
        Some("SERV-DEMO-02"),
        "Servicios",
        "Evaluación técnica ficticia con reporte de hallazgos.",
        "servicio",
        900_000,
        1_800_000,
        0,
        0,
    )?;
    let filter_id = insert_inventory_item(
        &transaction,
        "product",
        "Filtro de aire — Ejemplo",
        Some("PROD-DEMO-01"),
        "Repuestos",
        "Producto ficticio con existencias bajas para mostrar alertas.",
        "unidad",
        650_000,
        950_000,
        2_000,
        4_000,
    )?;
    let cleaning_id = insert_inventory_item(
        &transaction,
        "product",
        "Kit de limpieza — Ejemplo",
        Some("PROD-DEMO-02"),
        "Consumibles",
        "Producto ficticio con existencias saludables.",
        "kit",
        375_000,
        650_000,
        12_000,
        3_000,
    )?;
    insert_initial_movement(&transaction, filter_id, 2_000)?;
    insert_initial_movement(&transaction, cleaning_id, 12_000)?;

    insert_task(
        &transaction,
        "Preparar visita técnica — Ejemplo",
        "Revisar herramientas y confirmar la ubicación antes de la visita ficticia.",
        ana_id,
        "high",
        "pending",
        "strftime('%Y-%m-%dT16:00:00.000Z', 'now', '+1 day')",
    )?;
    insert_task(
        &transaction,
        "Confirmar materiales — Ejemplo",
        "Validar la lista de materiales del caso de demostración.",
        constructora_id,
        "normal",
        "in_progress",
        "strftime('%Y-%m-%dT20:00:00.000Z', 'now')",
    )?;
    insert_task(
        &transaction,
        "Enviar resumen de diagnóstico — Ejemplo",
        "Tarea ficticia completada para mostrar el historial.",
        cafe_id,
        "low",
        "completed",
        "strftime('%Y-%m-%dT18:00:00.000Z', 'now', '-1 day')",
    )?;

    insert_event(
        &transaction,
        "Reunión inicial — Ejemplo",
        "Reunión ficticia para revisar necesidades y próximos pasos.",
        cafe_id,
        "meeting",
        "strftime('%Y-%m-%dT16:00:00.000Z', 'now', '+2 days')",
        "strftime('%Y-%m-%dT17:00:00.000Z', 'now', '+2 days')",
    )?;
    insert_event(
        &transaction,
        "Llamada de seguimiento — Ejemplo",
        "Confirmar la recepción de la cotización de demostración.",
        ana_id,
        "call",
        "strftime('%Y-%m-%dT19:30:00.000Z', 'now', '+3 days')",
        "strftime('%Y-%m-%dT20:00:00.000Z', 'now', '+3 days')",
    )?;

    let quote_id = insert_quote(&transaction, cafe_id)?;
    insert_quote_item(
        &transaction,
        quote_id,
        maintenance_id,
        "Mantenimiento preventivo — Ejemplo",
        4_500_000,
        0,
    )?;
    insert_quote_item(
        &transaction,
        quote_id,
        diagnostic_id,
        "Diagnóstico técnico — Ejemplo",
        1_800_000,
        1,
    )?;

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar la carga de ejemplos: {error}"))?;

    Ok(DemoSeedResult {
        clients_created: 3,
        tasks_created: 3,
        events_created: 2,
        inventory_items_created: 4,
        quotes_created: 1,
    })
}

fn database_is_empty(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "
            SELECT
                (SELECT COUNT(*) FROM clients) = 0
                AND (SELECT COUNT(*) FROM tasks) = 0
                AND (SELECT COUNT(*) FROM calendar_events) = 0
                AND (SELECT COUNT(*) FROM inventory_items) = 0
                AND (SELECT COUNT(*) FROM quotes) = 0
                AND (SELECT COUNT(*) FROM document_folders) = 0
                AND (SELECT COUNT(*) FROM documents) = 0
                AND trim(business_name) = ''
                AND identification IS NULL
                AND phone IS NULL
                AND email IS NULL
                AND address IS NULL
                AND currency = 'CRC'
                AND default_tax_basis_points = 1300
                AND default_validity_days = 15
                AND terms IS NULL
                AND logo_data IS NULL
            FROM business_settings
            WHERE id = 1
            ",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudo revisar si la base está vacía: {error}"))
}

fn insert_client(
    transaction: &Transaction<'_>,
    name: &str,
    phone: &str,
    email: &str,
    notes: &str,
) -> Result<i64, String> {
    transaction
        .execute(
            "INSERT INTO clients (name, phone, email, notes) VALUES (?1, ?2, ?3, ?4)",
            params![name, phone, email, notes],
        )
        .map_err(|error| format!("No se pudo crear un cliente de ejemplo: {error}"))?;
    Ok(transaction.last_insert_rowid())
}

#[allow(clippy::too_many_arguments)]
fn insert_inventory_item(
    transaction: &Transaction<'_>,
    item_type: &str,
    name: &str,
    sku: Option<&str>,
    category: &str,
    description: &str,
    unit: &str,
    cost_price_minor: i64,
    sale_price_minor: i64,
    current_stock_millis: i64,
    minimum_stock_millis: i64,
) -> Result<i64, String> {
    transaction
        .execute(
            "
            INSERT INTO inventory_items (
                item_type, name, sku, category, description, unit,
                cost_price_minor, sale_price_minor, current_stock_millis,
                minimum_stock_millis
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ",
            params![
                item_type,
                name,
                sku,
                category,
                description,
                unit,
                cost_price_minor,
                sale_price_minor,
                current_stock_millis,
                minimum_stock_millis,
            ],
        )
        .map_err(|error| format!("No se pudo crear un artículo de ejemplo: {error}"))?;
    Ok(transaction.last_insert_rowid())
}

fn insert_initial_movement(
    transaction: &Transaction<'_>,
    item_id: i64,
    quantity_millis: i64,
) -> Result<(), String> {
    transaction
        .execute(
            "
            INSERT INTO inventory_movements (
                inventory_item_id, movement_type, quantity_delta_millis,
                previous_stock_millis, new_stock_millis, reason
            )
            VALUES (?1, 'adjustment', ?2, 0, ?2, ?3)
            ",
            params![
                item_id,
                quantity_millis,
                "Existencia inicial de demostración"
            ],
        )
        .map_err(|error| format!("No se pudo registrar el inventario de ejemplo: {error}"))?;
    Ok(())
}

fn insert_task(
    transaction: &Transaction<'_>,
    title: &str,
    description: &str,
    client_id: i64,
    priority: &str,
    status: &str,
    scheduled_expression: &str,
) -> Result<(), String> {
    let statement = format!(
        "
        INSERT INTO tasks (
            title, description, client_id, priority, status, scheduled_at, completed_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, {scheduled_expression},
            CASE WHEN ?5 = 'completed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END
        )
        "
    );
    transaction
        .execute(
            &statement,
            params![title, description, client_id, priority, status],
        )
        .map_err(|error| format!("No se pudo crear una tarea de ejemplo: {error}"))?;
    Ok(())
}

fn insert_event(
    transaction: &Transaction<'_>,
    title: &str,
    description: &str,
    client_id: i64,
    event_type: &str,
    starts_expression: &str,
    ends_expression: &str,
) -> Result<(), String> {
    let statement = format!(
        "
        INSERT INTO calendar_events (
            title, description, client_id, event_type, status, starts_at, ends_at, is_all_day
        )
        VALUES (?1, ?2, ?3, ?4, 'scheduled', {starts_expression}, {ends_expression}, 0)
        "
    );
    transaction
        .execute(
            &statement,
            params![title, description, client_id, event_type],
        )
        .map_err(|error| format!("No se pudo crear un evento de ejemplo: {error}"))?;
    Ok(())
}

fn insert_quote(transaction: &Transaction<'_>, client_id: i64) -> Result<i64, String> {
    transaction
        .execute(
            "
            INSERT INTO quotes (
                quote_number, client_id, client_name, client_identification,
                client_phone, client_email, client_address, business_name,
                business_identification, business_phone, business_email,
                business_address, currency, issue_date, valid_until, status,
                discount_basis_points, tax_basis_points, subtotal_minor,
                discount_minor, tax_minor, total_minor, notes, terms
            )
            SELECT
                'DEMO-001', clients.id, clients.name, clients.identification,
                clients.phone, clients.email, clients.address,
                settings.business_name, settings.identification, settings.phone,
                settings.email, settings.address, settings.currency,
                date('now'), date('now', '+15 days'), 'sent', 0, 1300,
                6300000, 0, 819000, 7119000,
                ?2, settings.terms
            FROM clients
            CROSS JOIN business_settings AS settings
            WHERE clients.id = ?1 AND settings.id = 1
            ",
            params![
                client_id,
                "Cotización ficticia para conocer el flujo. No representa una venta real.",
            ],
        )
        .map_err(|error| format!("No se pudo crear la cotización de ejemplo: {error}"))?;
    Ok(transaction.last_insert_rowid())
}

fn insert_quote_item(
    transaction: &Transaction<'_>,
    quote_id: i64,
    inventory_item_id: i64,
    description: &str,
    unit_price_minor: i64,
    position: i64,
) -> Result<(), String> {
    transaction
        .execute(
            "
            INSERT INTO quote_items (
                quote_id, inventory_item_id, description, quantity_millis,
                unit, unit_price_minor, position
            )
            VALUES (?1, ?2, ?3, 1000, 'servicio', ?4, ?5)
            ",
            params![
                quote_id,
                inventory_item_id,
                description,
                unit_price_minor,
                position
            ],
        )
        .map_err(|error| format!("No se pudo crear un concepto de ejemplo: {error}"))?;
    Ok(())
}

fn lock_connection(state: &DatabaseState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos local.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::initialize_database;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn seeds_connected_demo_data_only_into_an_empty_database() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let database_path = std::env::temp_dir().join(format!(
            "local-crm-demo-{}-{unique_suffix}.sqlite3",
            std::process::id()
        ));
        let mut connection =
            initialize_database(&database_path).expect("the database should initialize correctly");

        assert!(database_is_empty(&connection).expect("the database should be readable"));
        let result =
            seed_demo_data_into(&mut connection).expect("demo data should be created atomically");

        assert_eq!(result.clients_created, 3);
        assert_eq!(result.inventory_items_created, 4);
        assert!(!database_is_empty(&connection).expect("the database should no longer be empty"));
        assert_eq!(table_count(&connection, "clients"), 3);
        assert_eq!(table_count(&connection, "tasks"), 3);
        assert_eq!(table_count(&connection, "calendar_events"), 2);
        assert_eq!(table_count(&connection, "quotes"), 1);
        assert_eq!(table_count(&connection, "quote_items"), 2);
        assert!(seed_demo_data_into(&mut connection).is_err());

        drop(connection);
        std::fs::remove_file(database_path).expect("the temporary database should be removable");
    }

    fn table_count(connection: &Connection, table_name: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table_name}"), [], |row| {
                row.get(0)
            })
            .expect("the table count should be readable")
    }
}
