use crate::DatabaseState;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

const NAME_MAX_LENGTH: usize = 120;
const PHONE_MAX_LENGTH: usize = 30;
const EMAIL_MAX_LENGTH: usize = 254;
const IDENTIFICATION_MAX_LENGTH: usize = 50;
const ADDRESS_MAX_LENGTH: usize = 300;
const NOTES_MAX_LENGTH: usize = 2_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    id: i64,
    name: String,
    phone: Option<String>,
    email: Option<String>,
    identification: Option<String>,
    address: Option<String>,
    notes: Option<String>,
    is_archived: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClientInput {
    name: String,
    phone: Option<String>,
    email: Option<String>,
    identification: Option<String>,
    address: Option<String>,
    notes: Option<String>,
}

struct ValidatedClientInput {
    name: String,
    phone: Option<String>,
    email: Option<String>,
    identification: Option<String>,
    address: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
pub fn create_client(
    state: State<'_, DatabaseState>,
    input: CreateClientInput,
) -> Result<Client, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;

    connection
        .execute(
            "
            INSERT INTO clients (
                name,
                phone,
                email,
                identification,
                address,
                notes
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                input.name,
                input.phone,
                input.email,
                input.identification,
                input.address,
                input.notes
            ],
        )
        .map_err(|error| format!("No se pudo guardar el cliente: {error}"))?;

    let client_id = connection.last_insert_rowid();
    find_client_by_id(&connection, client_id)
}

#[tauri::command]
pub fn list_clients(state: State<'_, DatabaseState>) -> Result<Vec<Client>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                id,
                name,
                phone,
                email,
                identification,
                address,
                notes,
                is_archived,
                created_at,
                updated_at
            FROM clients
            ORDER BY is_archived ASC, name COLLATE NOCASE
            ",
        )
        .map_err(|error| format!("No se pudo preparar la consulta: {error}"))?;

    let clients = statement
        .query_map([], client_from_row)
        .map_err(|error| format!("No se pudieron consultar los clientes: {error}"))?
        .collect::<rusqlite::Result<Vec<Client>>>()
        .map_err(|error| format!("No se pudieron leer los clientes: {error}"))?;

    Ok(clients)
}

#[tauri::command]
pub fn update_client(
    state: State<'_, DatabaseState>,
    id: i64,
    input: CreateClientInput,
) -> Result<Client, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;
    let updated_rows = connection
        .execute(
            "
            UPDATE clients
            SET
                name = ?1,
                phone = ?2,
                email = ?3,
                identification = ?4,
                address = ?5,
                notes = ?6,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?7
            ",
            params![
                input.name,
                input.phone,
                input.email,
                input.identification,
                input.address,
                input.notes,
                id
            ],
        )
        .map_err(|error| format!("No se pudo actualizar el cliente: {error}"))?;

    if updated_rows == 0 {
        return Err("El cliente ya no existe.".to_owned());
    }

    find_client_by_id(&connection, id)
}

#[tauri::command]
pub fn set_client_archived(
    state: State<'_, DatabaseState>,
    id: i64,
    is_archived: bool,
) -> Result<Client, String> {
    let connection = lock_connection(&state)?;
    let updated_rows = connection
        .execute(
            "
            UPDATE clients
            SET
                is_archived = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![is_archived, id],
        )
        .map_err(|error| format!("No se pudo cambiar el estado del cliente: {error}"))?;

    if updated_rows == 0 {
        return Err("El cliente ya no existe.".to_owned());
    }

    find_client_by_id(&connection, id)
}

#[tauri::command]
pub fn delete_client(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let deleted_rows = connection
        .execute(
            "DELETE FROM clients WHERE id = ?1 AND is_archived = 1",
            params![id],
        )
        .map_err(|error| format!("No se pudo eliminar el cliente: {error}"))?;

    if deleted_rows == 0 {
        return Err(
            "El cliente debe estar archivado antes de eliminarlo o ya no existe.".to_owned(),
        );
    }

    Ok(())
}

fn lock_connection(state: &DatabaseState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos.".to_owned())
}

fn find_client_by_id(connection: &Connection, id: i64) -> Result<Client, String> {
    connection
        .query_row(
            "
            SELECT
                id,
                name,
                phone,
                email,
                identification,
                address,
                notes,
                is_archived,
                created_at,
                updated_at
            FROM clients
            WHERE id = ?1
            ",
            params![id],
            client_from_row,
        )
        .map_err(|error| format!("No se pudo consultar el cliente: {error}"))
}

fn validate_input(input: CreateClientInput) -> Result<ValidatedClientInput, String> {
    let name = input.name.trim().to_owned();

    if name.chars().count() < 2 {
        return Err("El nombre debe tener al menos 2 caracteres.".to_owned());
    }

    validate_length("El nombre", &name, NAME_MAX_LENGTH)?;

    let phone = normalize_optional(input.phone);
    let email = normalize_optional(input.email);
    let identification = normalize_optional(input.identification);
    let address = normalize_optional(input.address);
    let notes = normalize_optional(input.notes);

    validate_optional_length("El teléfono", phone.as_deref(), PHONE_MAX_LENGTH)?;
    validate_optional_length("El correo electrónico", email.as_deref(), EMAIL_MAX_LENGTH)?;
    validate_optional_length(
        "La identificación",
        identification.as_deref(),
        IDENTIFICATION_MAX_LENGTH,
    )?;
    validate_optional_length("La dirección", address.as_deref(), ADDRESS_MAX_LENGTH)?;
    validate_optional_length("Las notas", notes.as_deref(), NOTES_MAX_LENGTH)?;

    if let Some(email_value) = &email {
        if !is_valid_email(email_value) {
            return Err("El correo electrónico no tiene un formato válido.".to_owned());
        }
    }

    Ok(ValidatedClientInput {
        name,
        phone,
        email,
        identification,
        address,
        notes,
    })
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

fn is_valid_email(email: &str) -> bool {
    let mut parts = email.split('@');
    let local_part = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();

    !local_part.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && parts.next().is_none()
}

fn client_from_row(row: &Row<'_>) -> rusqlite::Result<Client> {
    Ok(Client {
        id: row.get(0)?,
        name: row.get(1)?,
        phone: row.get(2)?,
        email: row.get(3)?,
        identification: row.get(4)?,
        address: row.get(5)?,
        notes: row.get(6)?,
        is_archived: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> CreateClientInput {
        CreateClientInput {
            name: "Cliente de prueba".to_owned(),
            phone: None,
            email: None,
            identification: None,
            address: None,
            notes: None,
        }
    }

    #[test]
    fn trims_client_fields() {
        let mut input = valid_input();
        input.name = "  Cliente de prueba  ".to_owned();
        input.phone = Some("  8888-8888  ".to_owned());

        let result = validate_input(input).expect("the input should be valid");

        assert_eq!(result.name, "Cliente de prueba");
        assert_eq!(result.phone.as_deref(), Some("8888-8888"));
    }

    #[test]
    fn rejects_a_short_name() {
        let mut input = valid_input();
        input.name = "A".to_owned();

        assert!(validate_input(input).is_err());
    }

    #[test]
    fn rejects_an_invalid_email() {
        let mut input = valid_input();
        input.email = Some("correo-invalido".to_owned());

        assert!(validate_input(input).is_err());
    }
}
