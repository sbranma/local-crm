use crate::DatabaseState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

const BUSINESS_NAME_MAX_LENGTH: usize = 120;
const IDENTIFICATION_MAX_LENGTH: usize = 50;
const PHONE_MAX_LENGTH: usize = 30;
const EMAIL_MAX_LENGTH: usize = 254;
const ADDRESS_MAX_LENGTH: usize = 300;
const TERMS_MAX_LENGTH: usize = 2_000;
const LOGO_MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessSettings {
    business_name: String,
    identification: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    currency: String,
    default_tax_basis_points: i64,
    default_validity_days: i64,
    terms: Option<String>,
    logo_mime_type: Option<String>,
    logo_data: Option<Vec<u8>>,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoInput {
    mime_type: String,
    data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessSettingsInput {
    business_name: String,
    identification: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    currency: String,
    default_tax_basis_points: i64,
    default_validity_days: i64,
    terms: Option<String>,
    logo: Option<LogoInput>,
    remove_logo: bool,
}

#[tauri::command]
pub fn get_business_settings(state: State<'_, DatabaseState>) -> Result<BusinessSettings, String> {
    let connection = lock_connection(&state)?;
    find_settings(&connection)
}

#[tauri::command]
pub fn update_business_settings(
    state: State<'_, DatabaseState>,
    input: BusinessSettingsInput,
) -> Result<BusinessSettings, String> {
    let input = validate_input(input)?;
    let connection = lock_connection(&state)?;

    let (logo_mime_type, logo_data) = input
        .logo
        .map(|logo| (Some(logo.mime_type), Some(logo.data)))
        .unwrap_or((None, None));

    connection
        .execute(
            "
            UPDATE business_settings
            SET
                business_name = ?1,
                identification = ?2,
                phone = ?3,
                email = ?4,
                address = ?5,
                currency = ?6,
                default_tax_basis_points = ?7,
                default_validity_days = ?8,
                terms = ?9,
                logo_mime_type = CASE
                    WHEN ?10 THEN NULL
                    WHEN ?11 IS NOT NULL THEN ?11
                    ELSE logo_mime_type
                END,
                logo_data = CASE
                    WHEN ?10 THEN NULL
                    WHEN ?12 IS NOT NULL THEN ?12
                    ELSE logo_data
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = 1
            ",
            params![
                input.business_name,
                input.identification,
                input.phone,
                input.email,
                input.address,
                input.currency,
                input.default_tax_basis_points,
                input.default_validity_days,
                input.terms,
                input.remove_logo,
                logo_mime_type,
                logo_data
            ],
        )
        .map_err(|error| format!("No se pudo guardar la configuración: {error}"))?;

    find_settings(&connection)
}

pub(crate) fn find_settings(connection: &Connection) -> Result<BusinessSettings, String> {
    connection
        .query_row(
            "
            SELECT
                business_name,
                identification,
                phone,
                email,
                address,
                currency,
                default_tax_basis_points,
                default_validity_days,
                terms,
                logo_mime_type,
                logo_data,
                updated_at
            FROM business_settings
            WHERE id = 1
            ",
            [],
            |row| {
                Ok(BusinessSettings {
                    business_name: row.get(0)?,
                    identification: row.get(1)?,
                    phone: row.get(2)?,
                    email: row.get(3)?,
                    address: row.get(4)?,
                    currency: row.get(5)?,
                    default_tax_basis_points: row.get(6)?,
                    default_validity_days: row.get(7)?,
                    terms: row.get(8)?,
                    logo_mime_type: row.get(9)?,
                    logo_data: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|error| format!("No se pudo consultar la configuración: {error}"))
}

fn validate_input(input: BusinessSettingsInput) -> Result<BusinessSettingsInput, String> {
    let business_name = input.business_name.trim().to_owned();

    if business_name.chars().count() < 2 {
        return Err("El nombre del negocio debe tener al menos 2 caracteres.".to_owned());
    }

    validate_length(
        "El nombre del negocio",
        &business_name,
        BUSINESS_NAME_MAX_LENGTH,
    )?;

    let identification = normalize_optional(input.identification);
    let phone = normalize_optional(input.phone);
    let email = normalize_optional(input.email);
    let address = normalize_optional(input.address);
    let terms = normalize_optional(input.terms);

    validate_optional_length(
        "La identificación",
        identification.as_deref(),
        IDENTIFICATION_MAX_LENGTH,
    )?;
    validate_optional_length("El teléfono", phone.as_deref(), PHONE_MAX_LENGTH)?;
    validate_optional_length("El correo electrónico", email.as_deref(), EMAIL_MAX_LENGTH)?;
    validate_optional_length("La dirección", address.as_deref(), ADDRESS_MAX_LENGTH)?;
    validate_optional_length("Las condiciones", terms.as_deref(), TERMS_MAX_LENGTH)?;

    if email.as_deref().is_some_and(|value| !is_valid_email(value)) {
        return Err("El correo electrónico no tiene un formato válido.".to_owned());
    }

    if !matches!(input.currency.as_str(), "CRC" | "USD" | "EUR") {
        return Err("Selecciona una moneda válida.".to_owned());
    }

    if !(0..=10_000).contains(&input.default_tax_basis_points) {
        return Err("El impuesto debe estar entre 0% y 100%.".to_owned());
    }

    if !(1..=365).contains(&input.default_validity_days) {
        return Err("La validez debe estar entre 1 y 365 días.".to_owned());
    }

    if input.remove_logo && input.logo.is_some() {
        return Err("No se puede reemplazar y eliminar el logo al mismo tiempo.".to_owned());
    }

    if let Some(logo) = &input.logo {
        validate_logo(logo)?;
    }

    Ok(BusinessSettingsInput {
        business_name,
        identification,
        phone,
        email,
        address,
        currency: input.currency,
        default_tax_basis_points: input.default_tax_basis_points,
        default_validity_days: input.default_validity_days,
        terms,
        logo: input.logo,
        remove_logo: input.remove_logo,
    })
}

fn validate_logo(logo: &LogoInput) -> Result<(), String> {
    if logo.data.is_empty() || logo.data.len() > LOGO_MAX_BYTES {
        return Err("El logo debe pesar menos de 2 MB.".to_owned());
    }

    let valid_signature = match logo.mime_type.as_str() {
        "image/png" => logo
            .data
            .starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "image/jpeg" => logo.data.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/webp" => logo.data.starts_with(b"RIFF") && logo.data.get(8..12) == Some(b"WEBP"),
        _ => false,
    };

    if !valid_signature {
        return Err("El logo debe ser un archivo PNG, JPG o WebP válido.".to_owned());
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> BusinessSettingsInput {
        BusinessSettingsInput {
            business_name: "Negocio de prueba".to_owned(),
            identification: None,
            phone: None,
            email: None,
            address: None,
            currency: "CRC".to_owned(),
            default_tax_basis_points: 1_300,
            default_validity_days: 15,
            terms: None,
            logo: None,
            remove_logo: false,
        }
    }

    #[test]
    fn rejects_an_unknown_currency() {
        let mut input = valid_input();
        input.currency = "BTC".to_owned();

        assert!(validate_input(input).is_err());
    }

    #[test]
    fn accepts_a_valid_png_signature() {
        let logo = LogoInput {
            mime_type: "image/png".to_owned(),
            data: vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0],
        };

        assert!(validate_logo(&logo).is_ok());
    }

    #[test]
    fn rejects_a_mismatched_logo_signature() {
        let logo = LogoInput {
            mime_type: "image/png".to_owned(),
            data: vec![0xFF, 0xD8, 0xFF, 0],
        };

        assert!(validate_logo(&logo).is_err());
    }
}
