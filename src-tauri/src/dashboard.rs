use crate::{quotes::refresh_expired_quotes, DatabaseState};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const DASHBOARD_LIST_LIMIT: i64 = 6;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRangeInput {
    now: String,
    today_start: String,
    today_end: String,
    upcoming_end: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    business_name: Option<String>,
    currency: String,
    active_client_count: i64,
    open_task_count: i64,
    overdue_task_count: i64,
    today_item_count: i64,
    low_stock_count: i64,
    upcoming_items: Vec<DashboardScheduleItem>,
    alerts: Vec<DashboardAlert>,
    quote_statuses: Vec<DashboardQuoteStatus>,
    recent_clients: Vec<DashboardRecentClient>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardScheduleItem {
    source: String,
    record_id: i64,
    title: String,
    client_name: Option<String>,
    starts_at: String,
    is_all_day: bool,
    item_type: String,
    priority: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAlert {
    alert_type: String,
    record_id: i64,
    title: String,
    context: Option<String>,
    date_value: Option<String>,
    current_stock_millis: Option<i64>,
    minimum_stock_millis: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQuoteStatus {
    status: String,
    count: i64,
    total_minor: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRecentClient {
    id: i64,
    name: String,
    phone: Option<String>,
    email: Option<String>,
    created_at: String,
}

#[tauri::command]
pub fn get_dashboard_summary(
    state: State<'_, DatabaseState>,
    range: DashboardRangeInput,
) -> Result<DashboardSummary, String> {
    validate_range(&range)?;
    let connection = state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder al resumen local.".to_owned())?;
    load_dashboard_summary(&connection, &range)
}

fn load_dashboard_summary(
    connection: &Connection,
    range: &DashboardRangeInput,
) -> Result<DashboardSummary, String> {
    refresh_expired_quotes(connection)?;

    let (business_name, currency) = connection
        .query_row(
            "SELECT NULLIF(trim(business_name), ''), currency FROM business_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("No se pudo consultar la configuración: {error}"))?;

    let (
        active_client_count,
        open_task_count,
        overdue_task_count,
        today_item_count,
        low_stock_count,
    ) = connection
        .query_row(
            "
            SELECT
                (SELECT COUNT(*) FROM clients WHERE is_archived = 0),
                (SELECT COUNT(*) FROM tasks WHERE status != 'completed'),
                (
                    SELECT COUNT(*)
                    FROM tasks
                    WHERE status != 'completed'
                      AND scheduled_at IS NOT NULL
                      AND scheduled_at < ?1
                ),
                (
                    SELECT COUNT(*)
                    FROM tasks
                    WHERE status != 'completed'
                      AND scheduled_at >= ?2
                      AND scheduled_at < ?3
                ) + (
                    SELECT COUNT(*)
                    FROM calendar_events
                    WHERE status = 'scheduled'
                      AND starts_at < ?3
                      AND (
                          (ends_at IS NULL AND starts_at >= ?2)
                          OR (ends_at IS NOT NULL AND ends_at > ?2)
                      )
                ),
                (
                    SELECT COUNT(*)
                    FROM inventory_items
                    WHERE item_type = 'product'
                      AND is_archived = 0
                      AND minimum_stock_millis > 0
                      AND current_stock_millis <= minimum_stock_millis
                )
            ",
            params![range.now, range.today_start, range.today_end],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| format!("No se pudieron calcular los indicadores: {error}"))?;

    Ok(DashboardSummary {
        business_name,
        currency,
        active_client_count,
        open_task_count,
        overdue_task_count,
        today_item_count,
        low_stock_count,
        upcoming_items: load_upcoming_items(connection, range)?,
        alerts: load_alerts(connection, range)?,
        quote_statuses: load_quote_statuses(connection)?,
        recent_clients: load_recent_clients(connection)?,
    })
}

fn load_upcoming_items(
    connection: &Connection,
    range: &DashboardRangeInput,
) -> Result<Vec<DashboardScheduleItem>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                source,
                record_id,
                title,
                client_name,
                starts_at,
                is_all_day,
                item_type,
                priority
            FROM (
                SELECT
                    'task' AS source,
                    tasks.id AS record_id,
                    tasks.title,
                    clients.name AS client_name,
                    tasks.scheduled_at AS starts_at,
                    0 AS is_all_day,
                    'task' AS item_type,
                    tasks.priority
                FROM tasks
                LEFT JOIN clients ON clients.id = tasks.client_id
                WHERE tasks.status != 'completed'
                  AND tasks.scheduled_at >= ?1
                  AND tasks.scheduled_at < ?2

                UNION ALL

                SELECT
                    'event' AS source,
                    calendar_events.id AS record_id,
                    calendar_events.title,
                    clients.name AS client_name,
                    calendar_events.starts_at,
                    calendar_events.is_all_day,
                    calendar_events.event_type AS item_type,
                    NULL AS priority
                FROM calendar_events
                LEFT JOIN clients ON clients.id = calendar_events.client_id
                WHERE calendar_events.status = 'scheduled'
                  AND calendar_events.starts_at < ?2
                  AND (
                      (calendar_events.ends_at IS NULL AND calendar_events.starts_at >= ?1)
                      OR (calendar_events.ends_at IS NOT NULL AND calendar_events.ends_at > ?1)
                  )
            )
            ORDER BY starts_at, source, record_id
            LIMIT ?3
            ",
        )
        .map_err(|error| format!("No se pudo preparar la agenda resumida: {error}"))?;

    let items = statement
        .query_map(
            params![range.today_start, range.upcoming_end, DASHBOARD_LIST_LIMIT],
            schedule_item_from_row,
        )
        .map_err(|error| format!("No se pudo consultar la agenda resumida: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("No se pudo leer la agenda resumida: {error}"))?;
    Ok(items)
}

fn load_alerts(
    connection: &Connection,
    range: &DashboardRangeInput,
) -> Result<Vec<DashboardAlert>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                alert_type,
                record_id,
                title,
                context,
                date_value,
                current_stock_millis,
                minimum_stock_millis
            FROM (
                SELECT
                    'overdue_task' AS alert_type,
                    tasks.id AS record_id,
                    tasks.title,
                    clients.name AS context,
                    tasks.scheduled_at AS date_value,
                    NULL AS current_stock_millis,
                    NULL AS minimum_stock_millis,
                    1 AS alert_order,
                    tasks.scheduled_at AS sort_value
                FROM tasks
                LEFT JOIN clients ON clients.id = tasks.client_id
                WHERE tasks.status != 'completed'
                  AND tasks.scheduled_at IS NOT NULL
                  AND tasks.scheduled_at < ?1

                UNION ALL

                SELECT
                    'expired_quote' AS alert_type,
                    quotes.id AS record_id,
                    quotes.quote_number AS title,
                    quotes.client_name AS context,
                    quotes.valid_until AS date_value,
                    NULL AS current_stock_millis,
                    NULL AS minimum_stock_millis,
                    2 AS alert_order,
                    quotes.valid_until AS sort_value
                FROM quotes
                WHERE quotes.status = 'expired'

                UNION ALL

                SELECT
                    'low_stock' AS alert_type,
                    inventory_items.id AS record_id,
                    inventory_items.name AS title,
                    inventory_items.sku AS context,
                    NULL AS date_value,
                    inventory_items.current_stock_millis,
                    inventory_items.minimum_stock_millis,
                    3 AS alert_order,
                    inventory_items.updated_at AS sort_value
                FROM inventory_items
                WHERE inventory_items.item_type = 'product'
                  AND inventory_items.is_archived = 0
                  AND inventory_items.minimum_stock_millis > 0
                  AND inventory_items.current_stock_millis <= inventory_items.minimum_stock_millis
            )
            ORDER BY alert_order, sort_value, record_id
            LIMIT ?2
            ",
        )
        .map_err(|error| format!("No se pudieron preparar las alertas: {error}"))?;

    let alerts = statement
        .query_map(params![range.now, DASHBOARD_LIST_LIMIT], alert_from_row)
        .map_err(|error| format!("No se pudieron consultar las alertas: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("No se pudieron leer las alertas: {error}"))?;
    Ok(alerts)
}

fn load_quote_statuses(connection: &Connection) -> Result<Vec<DashboardQuoteStatus>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT status, COUNT(*), COALESCE(SUM(total_minor), 0)
            FROM quotes
            GROUP BY status
            ",
        )
        .map_err(|error| format!("No se pudo preparar el estado comercial: {error}"))?;

    let statuses = statement
        .query_map([], |row| {
            Ok(DashboardQuoteStatus {
                status: row.get(0)?,
                count: row.get(1)?,
                total_minor: row.get(2)?,
            })
        })
        .map_err(|error| format!("No se pudo consultar el estado comercial: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("No se pudo leer el estado comercial: {error}"))?;
    Ok(statuses)
}

fn load_recent_clients(connection: &Connection) -> Result<Vec<DashboardRecentClient>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, name, phone, email, created_at
            FROM clients
            WHERE is_archived = 0
            ORDER BY created_at DESC, id DESC
            LIMIT ?1
            ",
        )
        .map_err(|error| format!("No se pudieron preparar los clientes recientes: {error}"))?;

    let clients = statement
        .query_map([5_i64], |row| {
            Ok(DashboardRecentClient {
                id: row.get(0)?,
                name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| format!("No se pudieron consultar los clientes recientes: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("No se pudieron leer los clientes recientes: {error}"))?;
    Ok(clients)
}

fn schedule_item_from_row(row: &Row<'_>) -> rusqlite::Result<DashboardScheduleItem> {
    Ok(DashboardScheduleItem {
        source: row.get(0)?,
        record_id: row.get(1)?,
        title: row.get(2)?,
        client_name: row.get(3)?,
        starts_at: row.get(4)?,
        is_all_day: row.get::<_, i64>(5)? != 0,
        item_type: row.get(6)?,
        priority: row.get(7)?,
    })
}

fn alert_from_row(row: &Row<'_>) -> rusqlite::Result<DashboardAlert> {
    Ok(DashboardAlert {
        alert_type: row.get(0)?,
        record_id: row.get(1)?,
        title: row.get(2)?,
        context: row.get(3)?,
        date_value: row.get(4)?,
        current_stock_millis: row.get(5)?,
        minimum_stock_millis: row.get(6)?,
    })
}

fn validate_range(range: &DashboardRangeInput) -> Result<(), String> {
    if ![
        range.now.as_str(),
        range.today_start.as_str(),
        range.today_end.as_str(),
        range.upcoming_end.as_str(),
    ]
    .into_iter()
    .all(is_iso_utc_datetime)
    {
        return Err("No se pudo interpretar el rango de fechas del Dashboard.".to_owned());
    }
    if !(range.today_start <= range.now
        && range.now < range.today_end
        && range.today_end < range.upcoming_end)
    {
        return Err("El rango de fechas del Dashboard no es válido.".to_owned());
    }
    Ok(())
}

fn is_iso_utc_datetime(value: &str) -> bool {
    value.len() >= 20
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && value.ends_with('Z')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::initialize_database;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn summarizes_actionable_business_data() {
        let database_path = temporary_database_path();
        let connection = initialize_database(&database_path).expect("database should initialize");
        connection
            .execute("INSERT INTO clients (name) VALUES ('Cliente ficticio')", [])
            .expect("client should be inserted");
        connection
            .execute(
                "INSERT INTO tasks (title, priority, status, scheduled_at) VALUES (?1, 'high', 'pending', ?2)",
                params!["Tarea vencida", "2026-07-20T10:00:00.000Z"],
            )
            .expect("overdue task should be inserted");
        connection
            .execute(
                "INSERT INTO tasks (title, status, scheduled_at) VALUES (?1, 'pending', ?2)",
                params!["Tarea de hoy", "2026-07-21T15:00:00.000Z"],
            )
            .expect("today task should be inserted");
        connection
            .execute(
                "INSERT INTO inventory_items (item_type, name, unit, current_stock_millis, minimum_stock_millis) VALUES ('product', 'Producto ficticio', 'unidad', 1000, 2000)",
                [],
            )
            .expect("low-stock item should be inserted");

        let summary = load_dashboard_summary(
            &connection,
            &DashboardRangeInput {
                now: "2026-07-21T12:00:00.000Z".to_owned(),
                today_start: "2026-07-21T06:00:00.000Z".to_owned(),
                today_end: "2026-07-22T06:00:00.000Z".to_owned(),
                upcoming_end: "2026-07-29T06:00:00.000Z".to_owned(),
            },
        )
        .expect("dashboard should load");

        assert_eq!(summary.active_client_count, 1);
        assert_eq!(summary.open_task_count, 2);
        assert_eq!(summary.overdue_task_count, 1);
        assert_eq!(summary.today_item_count, 1);
        assert_eq!(summary.low_stock_count, 1);
        assert_eq!(summary.upcoming_items.len(), 1);
        assert_eq!(summary.alerts.len(), 2);

        drop(connection);
        std::fs::remove_file(database_path).expect("temporary database should be removed");
    }

    #[test]
    fn rejects_an_inconsistent_date_range() {
        let error = validate_range(&DashboardRangeInput {
            now: "2026-07-21T12:00:00.000Z".to_owned(),
            today_start: "2026-07-21T06:00:00.000Z".to_owned(),
            today_end: "2026-07-20T06:00:00.000Z".to_owned(),
            upcoming_end: "2026-07-29T06:00:00.000Z".to_owned(),
        })
        .expect_err("invalid range should fail");

        assert!(error.contains("no es válido"));
    }

    fn temporary_database_path() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "local-crm-dashboard-{}-{unique}.sqlite3",
            std::process::id()
        ))
    }
}
