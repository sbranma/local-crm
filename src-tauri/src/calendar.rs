use crate::DatabaseState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const TITLE_MAX_LENGTH: usize = 160;
const DESCRIPTION_MAX_LENGTH: usize = 2_000;
const DATE_MAX_LENGTH: usize = 35;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventType {
    Appointment,
    Meeting,
    Call,
    Reminder,
    Other,
}

impl CalendarEventType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Appointment => "appointment",
            Self::Meeting => "meeting",
            Self::Call => "call",
            Self::Reminder => "reminder",
            Self::Other => "other",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "appointment" => Ok(Self::Appointment),
            "meeting" => Ok(Self::Meeting),
            "call" => Ok(Self::Call),
            "reminder" => Ok(Self::Reminder),
            "other" => Ok(Self::Other),
            _ => Err(invalid_database_value("tipo de evento", value)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventStatus {
    Scheduled,
    Completed,
    Cancelled,
}

impl CalendarEventStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "scheduled" => Ok(Self::Scheduled),
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(invalid_database_value("estado del evento", value)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    id: i64,
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    client_name: Option<String>,
    client_phone: Option<String>,
    client_email: Option<String>,
    client_is_archived: bool,
    event_type: CalendarEventType,
    status: CalendarEventStatus,
    starts_at: String,
    ends_at: Option<String>,
    is_all_day: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventInput {
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    event_type: CalendarEventType,
    status: CalendarEventStatus,
    starts_at: String,
    ends_at: Option<String>,
    is_all_day: bool,
}

struct ValidatedCalendarEventInput {
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    event_type: CalendarEventType,
    status: CalendarEventStatus,
    starts_at: String,
    ends_at: Option<String>,
    is_all_day: bool,
}

#[tauri::command]
pub fn create_calendar_event(
    state: State<'_, DatabaseState>,
    input: CalendarEventInput,
) -> Result<CalendarEvent, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;
    validate_client(&connection, input.client_id, None)?;

    connection
        .execute(
            "
            INSERT INTO calendar_events (
                title,
                description,
                client_id,
                event_type,
                status,
                starts_at,
                ends_at,
                is_all_day
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ",
            params![
                input.title,
                input.description,
                input.client_id,
                input.event_type.as_str(),
                input.status.as_str(),
                input.starts_at,
                input.ends_at,
                i64::from(input.is_all_day)
            ],
        )
        .map_err(|error| format!("No se pudo guardar el evento: {error}"))?;

    find_event_by_id(&connection, connection.last_insert_rowid())
}

#[tauri::command]
pub fn list_calendar_events(state: State<'_, DatabaseState>) -> Result<Vec<CalendarEvent>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "
            {}
            ORDER BY calendar_events.starts_at, calendar_events.title COLLATE NOCASE
            ",
            event_select()
        ))
        .map_err(|error| format!("No se pudo preparar la consulta de eventos: {error}"))?;

    let events = statement
        .query_map([], event_from_row)
        .map_err(|error| format!("No se pudieron consultar los eventos: {error}"))?
        .collect::<rusqlite::Result<Vec<CalendarEvent>>>()
        .map_err(|error| format!("No se pudieron leer los eventos: {error}"))?;

    Ok(events)
}

#[tauri::command]
pub fn update_calendar_event(
    state: State<'_, DatabaseState>,
    id: i64,
    input: CalendarEventInput,
) -> Result<CalendarEvent, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;
    let current_client_id = find_event_client_id(&connection, id)?;
    validate_client(&connection, input.client_id, current_client_id)?;

    let updated_rows = connection
        .execute(
            "
            UPDATE calendar_events
            SET
                title = ?1,
                description = ?2,
                client_id = ?3,
                event_type = ?4,
                status = ?5,
                starts_at = ?6,
                ends_at = ?7,
                is_all_day = ?8,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?9
            ",
            params![
                input.title,
                input.description,
                input.client_id,
                input.event_type.as_str(),
                input.status.as_str(),
                input.starts_at,
                input.ends_at,
                i64::from(input.is_all_day),
                id
            ],
        )
        .map_err(|error| format!("No se pudo actualizar el evento: {error}"))?;

    if updated_rows == 0 {
        return Err("El evento ya no existe.".to_owned());
    }

    find_event_by_id(&connection, id)
}

#[tauri::command]
pub fn set_calendar_event_status(
    state: State<'_, DatabaseState>,
    id: i64,
    status: CalendarEventStatus,
) -> Result<CalendarEvent, String> {
    let connection = lock_connection(&state)?;
    let updated_rows = connection
        .execute(
            "
            UPDATE calendar_events
            SET
                status = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![status.as_str(), id],
        )
        .map_err(|error| format!("No se pudo cambiar el estado del evento: {error}"))?;

    if updated_rows == 0 {
        return Err("El evento ya no existe.".to_owned());
    }

    find_event_by_id(&connection, id)
}

#[tauri::command]
pub fn delete_calendar_event(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let deleted_rows = connection
        .execute("DELETE FROM calendar_events WHERE id = ?1", params![id])
        .map_err(|error| format!("No se pudo eliminar el evento: {error}"))?;

    if deleted_rows == 0 {
        return Err("El evento ya no existe.".to_owned());
    }

    Ok(())
}

fn validate_input(input: CalendarEventInput) -> Result<ValidatedCalendarEventInput, String> {
    let title = input.title.trim().to_owned();
    let description = normalize_optional(input.description);
    let starts_at = input.starts_at.trim().to_owned();
    let ends_at = normalize_optional(input.ends_at);

    if title.chars().count() < 2 {
        return Err("El título debe tener al menos 2 caracteres.".to_owned());
    }

    validate_length("El título", &title, TITLE_MAX_LENGTH)?;
    validate_optional_length(
        "La descripción",
        description.as_deref(),
        DESCRIPTION_MAX_LENGTH,
    )?;
    validate_length("La fecha de inicio", &starts_at, DATE_MAX_LENGTH)?;
    validate_optional_length("La fecha final", ends_at.as_deref(), DATE_MAX_LENGTH)?;

    if !is_iso_utc_datetime(&starts_at) {
        return Err("La fecha y hora de inicio no tiene un formato válido.".to_owned());
    }

    if ends_at
        .as_deref()
        .is_some_and(|value| !is_iso_utc_datetime(value))
    {
        return Err("La fecha y hora final no tiene un formato válido.".to_owned());
    }

    if ends_at
        .as_deref()
        .is_some_and(|value| value <= starts_at.as_str())
    {
        return Err("La fecha final debe ser posterior a la fecha de inicio.".to_owned());
    }

    Ok(ValidatedCalendarEventInput {
        title,
        description,
        client_id: input.client_id,
        event_type: input.event_type,
        status: input.status,
        starts_at,
        ends_at,
        is_all_day: input.is_all_day,
    })
}

fn validate_client(
    connection: &Connection,
    client_id: Option<i64>,
    current_client_id: Option<i64>,
) -> Result<(), String> {
    let Some(client_id) = client_id else {
        return Ok(());
    };

    let is_archived = connection
        .query_row(
            "SELECT is_archived FROM clients WHERE id = ?1",
            params![client_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el cliente: {error}"))?
        .ok_or_else(|| "El cliente seleccionado ya no existe.".to_owned())?
        != 0;

    if is_archived && current_client_id != Some(client_id) {
        return Err("No se pueden asignar eventos nuevos a un cliente archivado.".to_owned());
    }

    Ok(())
}

fn find_event_client_id(connection: &Connection, id: i64) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "SELECT client_id FROM calendar_events WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el evento: {error}"))?
        .ok_or_else(|| "El evento ya no existe.".to_owned())
}

fn find_event_by_id(connection: &Connection, id: i64) -> Result<CalendarEvent, String> {
    connection
        .query_row(
            &format!("{} WHERE calendar_events.id = ?1", event_select()),
            params![id],
            event_from_row,
        )
        .map_err(|error| format!("No se pudo consultar el evento: {error}"))
}

fn event_select() -> &'static str {
    "
    SELECT
        calendar_events.id,
        calendar_events.title,
        calendar_events.description,
        calendar_events.client_id,
        clients.name,
        clients.phone,
        clients.email,
        COALESCE(clients.is_archived, 0),
        calendar_events.event_type,
        calendar_events.status,
        calendar_events.starts_at,
        calendar_events.ends_at,
        calendar_events.is_all_day,
        calendar_events.created_at,
        calendar_events.updated_at
    FROM calendar_events
    LEFT JOIN clients ON clients.id = calendar_events.client_id
    "
}

fn event_from_row(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    let event_type = row.get::<_, String>(8)?;
    let status = row.get::<_, String>(9)?;

    Ok(CalendarEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        client_id: row.get(3)?,
        client_name: row.get(4)?,
        client_phone: row.get(5)?,
        client_email: row.get(6)?,
        client_is_archived: row.get::<_, i64>(7)? != 0,
        event_type: CalendarEventType::from_database(&event_type)?,
        status: CalendarEventStatus::from_database(&status)?,
        starts_at: row.get(10)?,
        ends_at: row.get(11)?,
        is_all_day: row.get::<_, i64>(12)? != 0,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn lock_connection(state: &DatabaseState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos.".to_owned())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn validate_optional_length(
    field_name: &str,
    value: Option<&str>,
    max_length: usize,
) -> Result<(), String> {
    if let Some(value) = value {
        validate_length(field_name, value, max_length)?;
    }

    Ok(())
}

fn validate_length(field_name: &str, value: &str, max_length: usize) -> Result<(), String> {
    if value.chars().count() > max_length {
        return Err(format!(
            "{field_name} no puede superar {max_length} caracteres."
        ));
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

fn invalid_database_value(field: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("Valor de {field} no reconocido: {value}").into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> CalendarEventInput {
        CalendarEventInput {
            title: "Visita técnica".to_owned(),
            description: None,
            client_id: None,
            event_type: CalendarEventType::Appointment,
            status: CalendarEventStatus::Scheduled,
            starts_at: "2026-07-20T14:00:00.000Z".to_owned(),
            ends_at: Some("2026-07-20T15:00:00.000Z".to_owned()),
            is_all_day: false,
        }
    }

    #[test]
    fn trims_event_fields() {
        let mut input = valid_input();
        input.title = "  Visita técnica  ".to_owned();
        input.description = Some("  Llevar herramientas  ".to_owned());

        let result = validate_input(input).expect("the input should be valid");

        assert_eq!(result.title, "Visita técnica");
        assert_eq!(result.description.as_deref(), Some("Llevar herramientas"));
    }

    #[test]
    fn rejects_an_end_before_the_start() {
        let mut input = valid_input();
        input.ends_at = Some("2026-07-20T13:00:00.000Z".to_owned());

        assert!(validate_input(input).is_err());
    }

    #[test]
    fn rejects_a_non_utc_start() {
        let mut input = valid_input();
        input.starts_at = "2026-07-20T14:00".to_owned();

        assert!(validate_input(input).is_err());
    }
}
