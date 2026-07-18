use crate::DatabaseState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const TITLE_MAX_LENGTH: usize = 160;
const DESCRIPTION_MAX_LENGTH: usize = 2_000;
const SCHEDULED_AT_MAX_LENGTH: usize = 35;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    Normal,
    High,
}

impl TaskPriority {
    fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "low" => Ok(Self::Low),
            "normal" => Ok(Self::Normal),
            "high" => Ok(Self::High),
            _ => Err(invalid_database_value("prioridad", value)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
}

impl TaskStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "in_progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            _ => Err(invalid_database_value("estado", value)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: i64,
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    client_name: Option<String>,
    client_is_archived: bool,
    priority: TaskPriority,
    status: TaskStatus,
    scheduled_at: Option<String>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    priority: TaskPriority,
    status: TaskStatus,
    scheduled_at: Option<String>,
}

struct ValidatedTaskInput {
    title: String,
    description: Option<String>,
    client_id: Option<i64>,
    priority: TaskPriority,
    status: TaskStatus,
    scheduled_at: Option<String>,
}

#[tauri::command]
pub fn create_task(state: State<'_, DatabaseState>, input: TaskInput) -> Result<Task, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;
    validate_client(&connection, input.client_id, None)?;

    connection
        .execute(
            "
            INSERT INTO tasks (
                title,
                description,
                client_id,
                priority,
                status,
                scheduled_at,
                completed_at
            )
            VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                CASE
                    WHEN ?5 = 'completed'
                    THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    ELSE NULL
                END
            )
            ",
            params![
                input.title,
                input.description,
                input.client_id,
                input.priority.as_str(),
                input.status.as_str(),
                input.scheduled_at
            ],
        )
        .map_err(|error| format!("No se pudo guardar la tarea: {error}"))?;

    find_task_by_id(&connection, connection.last_insert_rowid())
}

#[tauri::command]
pub fn list_tasks(state: State<'_, DatabaseState>) -> Result<Vec<Task>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "
            {}
            ORDER BY
                CASE tasks.status
                    WHEN 'pending' THEN 0
                    WHEN 'in_progress' THEN 1
                    ELSE 2
                END,
                tasks.scheduled_at IS NULL,
                tasks.scheduled_at,
                CASE tasks.priority
                    WHEN 'high' THEN 0
                    WHEN 'normal' THEN 1
                    ELSE 2
                END,
                tasks.title COLLATE NOCASE
            ",
            task_select()
        ))
        .map_err(|error| format!("No se pudo preparar la consulta de tareas: {error}"))?;

    let tasks = statement
        .query_map([], task_from_row)
        .map_err(|error| format!("No se pudieron consultar las tareas: {error}"))?
        .collect::<rusqlite::Result<Vec<Task>>>()
        .map_err(|error| format!("No se pudieron leer las tareas: {error}"))?;

    Ok(tasks)
}

#[tauri::command]
pub fn update_task(
    state: State<'_, DatabaseState>,
    id: i64,
    input: TaskInput,
) -> Result<Task, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;
    let current_client_id = find_task_client_id(&connection, id)?;
    validate_client(&connection, input.client_id, current_client_id)?;

    connection
        .execute(
            "
            UPDATE tasks
            SET
                title = ?1,
                description = ?2,
                client_id = ?3,
                priority = ?4,
                status = ?5,
                scheduled_at = ?6,
                completed_at = CASE
                    WHEN ?5 = 'completed'
                    THEN COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ELSE NULL
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?7
            ",
            params![
                input.title,
                input.description,
                input.client_id,
                input.priority.as_str(),
                input.status.as_str(),
                input.scheduled_at,
                id
            ],
        )
        .map_err(|error| format!("No se pudo actualizar la tarea: {error}"))?;

    find_task_by_id(&connection, id)
}

#[tauri::command]
pub fn set_task_status(
    state: State<'_, DatabaseState>,
    id: i64,
    status: TaskStatus,
) -> Result<Task, String> {
    let connection = lock_connection(&state)?;
    let updated_rows = connection
        .execute(
            "
            UPDATE tasks
            SET
                status = ?1,
                completed_at = CASE
                    WHEN ?1 = 'completed'
                    THEN COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ELSE NULL
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![status.as_str(), id],
        )
        .map_err(|error| format!("No se pudo cambiar el estado de la tarea: {error}"))?;

    if updated_rows == 0 {
        return Err("La tarea ya no existe.".to_owned());
    }

    find_task_by_id(&connection, id)
}

#[tauri::command]
pub fn delete_task(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let deleted_rows = connection
        .execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|error| format!("No se pudo eliminar la tarea: {error}"))?;

    if deleted_rows == 0 {
        return Err("La tarea ya no existe.".to_owned());
    }

    Ok(())
}

fn validate_input(input: TaskInput) -> Result<ValidatedTaskInput, String> {
    let title = input.title.trim().to_owned();
    let description = normalize_optional(input.description);
    let scheduled_at = normalize_optional(input.scheduled_at);

    if title.chars().count() < 2 {
        return Err("El título debe tener al menos 2 caracteres.".to_owned());
    }

    validate_length("El título", &title, TITLE_MAX_LENGTH)?;
    validate_optional_length(
        "La descripción",
        description.as_deref(),
        DESCRIPTION_MAX_LENGTH,
    )?;
    validate_optional_length(
        "La fecha programada",
        scheduled_at.as_deref(),
        SCHEDULED_AT_MAX_LENGTH,
    )?;

    if scheduled_at
        .as_deref()
        .is_some_and(|value| !is_iso_utc_datetime(value))
    {
        return Err("La fecha y hora programada no tiene un formato válido.".to_owned());
    }

    Ok(ValidatedTaskInput {
        title,
        description,
        client_id: input.client_id,
        priority: input.priority,
        status: input.status,
        scheduled_at,
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
        return Err("No se pueden asignar tareas nuevas a un cliente archivado.".to_owned());
    }

    Ok(())
}

fn find_task_client_id(connection: &Connection, id: i64) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "SELECT client_id FROM tasks WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar la tarea: {error}"))?
        .ok_or_else(|| "La tarea ya no existe.".to_owned())
}

fn find_task_by_id(connection: &Connection, id: i64) -> Result<Task, String> {
    connection
        .query_row(
            &format!("{} WHERE tasks.id = ?1", task_select()),
            params![id],
            task_from_row,
        )
        .map_err(|error| format!("No se pudo consultar la tarea: {error}"))
}

fn task_select() -> &'static str {
    "
    SELECT
        tasks.id,
        tasks.title,
        tasks.description,
        tasks.client_id,
        clients.name,
        COALESCE(clients.is_archived, 0),
        tasks.priority,
        tasks.status,
        tasks.scheduled_at,
        tasks.completed_at,
        tasks.created_at,
        tasks.updated_at
    FROM tasks
    LEFT JOIN clients ON clients.id = tasks.client_id
    "
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<Task> {
    let priority = row.get::<_, String>(6)?;
    let status = row.get::<_, String>(7)?;

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        client_id: row.get(3)?,
        client_name: row.get(4)?,
        client_is_archived: row.get::<_, i64>(5)? != 0,
        priority: TaskPriority::from_database(&priority)?,
        status: TaskStatus::from_database(&status)?,
        scheduled_at: row.get(8)?,
        completed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
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

    fn valid_input() -> TaskInput {
        TaskInput {
            title: "Confirmar visita".to_owned(),
            description: None,
            client_id: None,
            priority: TaskPriority::Normal,
            status: TaskStatus::Pending,
            scheduled_at: None,
        }
    }

    #[test]
    fn trims_task_fields() {
        let mut input = valid_input();
        input.title = "  Confirmar visita  ".to_owned();
        input.description = Some("  Llamar por la tarde  ".to_owned());

        let result = validate_input(input).expect("the input should be valid");

        assert_eq!(result.title, "Confirmar visita");
        assert_eq!(result.description.as_deref(), Some("Llamar por la tarde"));
    }

    #[test]
    fn rejects_a_short_title() {
        let mut input = valid_input();
        input.title = "A".to_owned();

        assert!(validate_input(input).is_err());
    }

    #[test]
    fn rejects_a_non_utc_scheduled_date() {
        let mut input = valid_input();
        input.scheduled_at = Some("2026-07-20T14:00".to_owned());

        assert!(validate_input(input).is_err());
    }
}
