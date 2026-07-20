use crate::DatabaseState;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

const DESCRIPTION_MAX_LENGTH: usize = 300;
const UNIT_MAX_LENGTH: usize = 30;
const NOTES_MAX_LENGTH: usize = 2_000;
const TERMS_MAX_LENGTH: usize = 2_000;
const MAX_ITEMS: usize = 100;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuoteStatus {
    Draft,
    Sent,
    Accepted,
    Rejected,
    Expired,
}

impl QuoteStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Sent => "sent",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "draft" => Ok(Self::Draft),
            "sent" => Ok(Self::Sent),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            "expired" => Ok(Self::Expired),
            _ => Err(invalid_database_value("estado", value)),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteItemInput {
    inventory_item_id: Option<i64>,
    description: String,
    quantity_millis: i64,
    unit: String,
    unit_price_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteInput {
    client_id: i64,
    issue_date: String,
    valid_until: String,
    discount_basis_points: i64,
    tax_basis_points: i64,
    notes: Option<String>,
    terms: Option<String>,
    items: Vec<QuoteItemInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteItem {
    id: i64,
    inventory_item_id: Option<i64>,
    description: String,
    quantity_millis: i64,
    unit: String,
    unit_price_minor: i64,
    total_minor: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    id: i64,
    quote_number: String,
    client_id: i64,
    client_name: String,
    client_identification: Option<String>,
    client_phone: Option<String>,
    client_email: Option<String>,
    client_address: Option<String>,
    client_is_archived: bool,
    business_name: String,
    business_identification: Option<String>,
    business_phone: Option<String>,
    business_email: Option<String>,
    business_address: Option<String>,
    currency: String,
    issue_date: String,
    valid_until: String,
    status: QuoteStatus,
    discount_basis_points: i64,
    tax_basis_points: i64,
    subtotal_minor: i64,
    discount_minor: i64,
    tax_minor: i64,
    total_minor: i64,
    notes: Option<String>,
    terms: Option<String>,
    items: Vec<QuoteItem>,
    created_at: String,
    updated_at: String,
}

struct ValidatedQuoteInput {
    client_id: i64,
    issue_date: String,
    valid_until: String,
    discount_basis_points: i64,
    tax_basis_points: i64,
    notes: Option<String>,
    terms: Option<String>,
    items: Vec<QuoteItemInput>,
}

struct ClientSnapshot {
    name: String,
    identification: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    is_archived: bool,
}

struct BusinessSnapshot {
    name: String,
    identification: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    currency: String,
}

struct QuoteTotals {
    subtotal_minor: i64,
    discount_minor: i64,
    tax_minor: i64,
    total_minor: i64,
}

#[tauri::command]
pub fn create_quote(state: State<'_, DatabaseState>, input: QuoteInput) -> Result<Quote, String> {
    let input = validate_input(input)?;
    let mut connection = lock_connection(&state)?;
    let client = find_client_snapshot(&connection, input.client_id)?;

    if client.is_archived {
        return Err("No se puede crear una cotización para un cliente archivado.".to_owned());
    }

    let business = find_business_snapshot(&connection)?;
    let totals = calculate_totals(
        &input.items,
        input.discount_basis_points,
        input.tax_basis_points,
    )?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar el guardado: {error}"))?;
    let quote_number = next_quote_number(&transaction, &input.issue_date)?;

    transaction
        .execute(
            "
            INSERT INTO quotes (
                quote_number,
                client_id,
                client_name,
                client_identification,
                client_phone,
                client_email,
                client_address,
                business_name,
                business_identification,
                business_phone,
                business_email,
                business_address,
                currency,
                issue_date,
                valid_until,
                discount_basis_points,
                tax_basis_points,
                subtotal_minor,
                discount_minor,
                tax_minor,
                total_minor,
                notes,
                terms
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
            )
            ",
            params![
                quote_number,
                input.client_id,
                client.name,
                client.identification,
                client.phone,
                client.email,
                client.address,
                business.name,
                business.identification,
                business.phone,
                business.email,
                business.address,
                business.currency,
                input.issue_date,
                input.valid_until,
                input.discount_basis_points,
                input.tax_basis_points,
                totals.subtotal_minor,
                totals.discount_minor,
                totals.tax_minor,
                totals.total_minor,
                input.notes,
                input.terms
            ],
        )
        .map_err(|error| format!("No se pudo guardar la cotización: {error}"))?;

    let quote_id = transaction.last_insert_rowid();
    insert_items(&transaction, quote_id, &input.items)?;
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar la cotización: {error}"))?;

    find_quote_by_id(&connection, quote_id)
}

#[tauri::command]
pub fn list_quotes(state: State<'_, DatabaseState>) -> Result<Vec<Quote>, String> {
    let connection = lock_connection(&state)?;
    refresh_expired_quotes(&connection)?;
    let mut statement = connection
        .prepare(&format!(
            "{} ORDER BY quotes.issue_date DESC, quotes.id DESC",
            quote_select()
        ))
        .map_err(|error| format!("No se pudo preparar la consulta: {error}"))?;

    let quotes = statement
        .query_map([], quote_from_row)
        .map_err(|error| format!("No se pudieron consultar las cotizaciones: {error}"))?
        .collect::<rusqlite::Result<Vec<Quote>>>()
        .map_err(|error| format!("No se pudieron leer las cotizaciones: {error}"))?;

    Ok(quotes)
}

#[tauri::command]
pub fn get_quote(state: State<'_, DatabaseState>, id: i64) -> Result<Quote, String> {
    let connection = lock_connection(&state)?;
    refresh_expired_quotes(&connection)?;
    find_quote_by_id(&connection, id)
}

#[tauri::command]
pub fn update_quote(
    state: State<'_, DatabaseState>,
    id: i64,
    input: QuoteInput,
) -> Result<Quote, String> {
    let input = validate_input(input)?;
    let mut connection = lock_connection(&state)?;
    let (status, current_client_id) = find_quote_status_and_client(&connection, id)?;

    if status != QuoteStatus::Draft {
        return Err("Solo se pueden editar cotizaciones en borrador.".to_owned());
    }

    let client = find_client_snapshot(&connection, input.client_id)?;
    if client.is_archived && current_client_id != input.client_id {
        return Err("No se puede asignar un cliente archivado.".to_owned());
    }

    let business = find_business_snapshot(&connection)?;
    let totals = calculate_totals(
        &input.items,
        input.discount_basis_points,
        input.tax_basis_points,
    )?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar la actualización: {error}"))?;

    transaction
        .execute(
            "
            UPDATE quotes
            SET
                client_id = ?1,
                client_name = ?2,
                client_identification = ?3,
                client_phone = ?4,
                client_email = ?5,
                client_address = ?6,
                business_name = ?7,
                business_identification = ?8,
                business_phone = ?9,
                business_email = ?10,
                business_address = ?11,
                currency = ?12,
                issue_date = ?13,
                valid_until = ?14,
                discount_basis_points = ?15,
                tax_basis_points = ?16,
                subtotal_minor = ?17,
                discount_minor = ?18,
                tax_minor = ?19,
                total_minor = ?20,
                notes = ?21,
                terms = ?22,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?23 AND status = 'draft'
            ",
            params![
                input.client_id,
                client.name,
                client.identification,
                client.phone,
                client.email,
                client.address,
                business.name,
                business.identification,
                business.phone,
                business.email,
                business.address,
                business.currency,
                input.issue_date,
                input.valid_until,
                input.discount_basis_points,
                input.tax_basis_points,
                totals.subtotal_minor,
                totals.discount_minor,
                totals.tax_minor,
                totals.total_minor,
                input.notes,
                input.terms,
                id
            ],
        )
        .map_err(|error| format!("No se pudo actualizar la cotización: {error}"))?;

    transaction
        .execute("DELETE FROM quote_items WHERE quote_id = ?1", params![id])
        .map_err(|error| format!("No se pudieron actualizar los conceptos: {error}"))?;
    insert_items(&transaction, id, &input.items)?;
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar la actualización: {error}"))?;

    find_quote_by_id(&connection, id)
}

#[tauri::command]
pub fn set_quote_status(
    state: State<'_, DatabaseState>,
    id: i64,
    status: QuoteStatus,
) -> Result<Quote, String> {
    let connection = lock_connection(&state)?;
    refresh_expired_quotes(&connection)?;
    let (current_status, _) = find_quote_status_and_client(&connection, id)?;

    if !is_valid_transition(current_status, status) {
        return Err(format!(
            "No se puede cambiar una cotización de {} a {}.",
            status_label(current_status),
            status_label(status)
        ));
    }

    connection
        .execute(
            "
            UPDATE quotes
            SET
                status = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![status.as_str(), id],
        )
        .map_err(|error| format!("No se pudo cambiar el estado: {error}"))?;

    find_quote_by_id(&connection, id)
}

#[tauri::command]
pub fn delete_quote(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let deleted_rows = connection
        .execute(
            "DELETE FROM quotes WHERE id = ?1 AND status = 'draft'",
            params![id],
        )
        .map_err(|error| format!("No se pudo eliminar la cotización: {error}"))?;

    if deleted_rows == 0 {
        return Err("Solo se puede eliminar una cotización en borrador.".to_owned());
    }

    Ok(())
}

fn validate_input(input: QuoteInput) -> Result<ValidatedQuoteInput, String> {
    if input.client_id <= 0 {
        return Err("Selecciona un cliente válido.".to_owned());
    }

    if !is_valid_date(&input.issue_date) || !is_valid_date(&input.valid_until) {
        return Err("Las fechas de la cotización no son válidas.".to_owned());
    }

    if input.valid_until < input.issue_date {
        return Err("La fecha de vencimiento no puede ser anterior a la emisión.".to_owned());
    }

    if !(0..=10_000).contains(&input.discount_basis_points) {
        return Err("El descuento debe estar entre 0% y 100%.".to_owned());
    }

    if !(0..=10_000).contains(&input.tax_basis_points) {
        return Err("El impuesto debe estar entre 0% y 100%.".to_owned());
    }

    if input.items.is_empty() || input.items.len() > MAX_ITEMS {
        return Err("La cotización debe tener entre 1 y 100 conceptos.".to_owned());
    }

    let mut items = Vec::with_capacity(input.items.len());
    for item in input.items {
        let description = item.description.trim().to_owned();
        let unit = item.unit.trim().to_owned();

        if description.chars().count() < 2 {
            return Err("Cada concepto debe tener una descripción.".to_owned());
        }
        validate_length("La descripción", &description, DESCRIPTION_MAX_LENGTH)?;

        if unit.is_empty() {
            return Err("Cada concepto debe indicar una unidad.".to_owned());
        }
        validate_length("La unidad", &unit, UNIT_MAX_LENGTH)?;

        if !(1..=1_000_000_000).contains(&item.quantity_millis) {
            return Err("La cantidad de un concepto no es válida.".to_owned());
        }

        if !(0..=1_000_000_000_000).contains(&item.unit_price_minor) {
            return Err("El precio de un concepto no es válido.".to_owned());
        }

        items.push(QuoteItemInput {
            inventory_item_id: item.inventory_item_id,
            description,
            quantity_millis: item.quantity_millis,
            unit,
            unit_price_minor: item.unit_price_minor,
        });
    }

    let notes = normalize_optional(input.notes);
    let terms = normalize_optional(input.terms);
    validate_optional_length("Las notas", notes.as_deref(), NOTES_MAX_LENGTH)?;
    validate_optional_length("Las condiciones", terms.as_deref(), TERMS_MAX_LENGTH)?;

    Ok(ValidatedQuoteInput {
        client_id: input.client_id,
        issue_date: input.issue_date,
        valid_until: input.valid_until,
        discount_basis_points: input.discount_basis_points,
        tax_basis_points: input.tax_basis_points,
        notes,
        terms,
        items,
    })
}

fn calculate_totals(
    items: &[QuoteItemInput],
    discount_basis_points: i64,
    tax_basis_points: i64,
) -> Result<QuoteTotals, String> {
    let subtotal = items.iter().try_fold(0_i128, |total, item| {
        let item_total = round_div(
            i128::from(item.quantity_millis) * i128::from(item.unit_price_minor),
            1_000,
        );
        total
            .checked_add(item_total)
            .ok_or_else(|| "El total de la cotización es demasiado grande.".to_owned())
    })?;
    let discount = round_div(subtotal * i128::from(discount_basis_points), 10_000);
    let taxable = subtotal - discount;
    let tax = round_div(taxable * i128::from(tax_basis_points), 10_000);
    let total = taxable + tax;

    Ok(QuoteTotals {
        subtotal_minor: to_money_i64(subtotal)?,
        discount_minor: to_money_i64(discount)?,
        tax_minor: to_money_i64(tax)?,
        total_minor: to_money_i64(total)?,
    })
}

fn round_div(value: i128, divisor: i128) -> i128 {
    (value + divisor / 2) / divisor
}

fn to_money_i64(value: i128) -> Result<i64, String> {
    i64::try_from(value)
        .ok()
        .filter(|amount| *amount <= 9_000_000_000_000_000)
        .ok_or_else(|| "El total de la cotización es demasiado grande.".to_owned())
}

fn insert_items(
    transaction: &Transaction<'_>,
    quote_id: i64,
    items: &[QuoteItemInput],
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(
            "
            INSERT INTO quote_items (
                quote_id,
                inventory_item_id,
                description,
                quantity_millis,
                unit,
                unit_price_minor,
                position
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
        )
        .map_err(|error| format!("No se pudieron preparar los conceptos: {error}"))?;

    for (position, item) in items.iter().enumerate() {
        if let Some(inventory_item_id) = item.inventory_item_id {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM inventory_items WHERE id = ?1",
                    params![inventory_item_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| format!("No se pudo consultar el catálogo: {error}"))?
                .is_some();

            if !exists {
                return Err("Uno de los artículos seleccionados ya no existe.".to_owned());
            }
        }

        statement
            .execute(params![
                quote_id,
                item.inventory_item_id,
                item.description,
                item.quantity_millis,
                item.unit,
                item.unit_price_minor,
                position as i64
            ])
            .map_err(|error| format!("No se pudo guardar un concepto: {error}"))?;
    }

    Ok(())
}

fn find_quote_by_id(connection: &Connection, id: i64) -> Result<Quote, String> {
    let mut quote = connection
        .query_row(
            &format!("{} WHERE quotes.id = ?1", quote_select()),
            params![id],
            quote_from_row,
        )
        .map_err(|error| format!("No se pudo consultar la cotización: {error}"))?;
    quote.items = find_quote_items(connection, id)?;
    Ok(quote)
}

fn find_quote_items(connection: &Connection, quote_id: i64) -> Result<Vec<QuoteItem>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, inventory_item_id, description, quantity_millis, unit, unit_price_minor
            FROM quote_items
            WHERE quote_id = ?1
            ORDER BY position
            ",
        )
        .map_err(|error| format!("No se pudieron preparar los conceptos: {error}"))?;

    let items = statement
        .query_map(params![quote_id], |row| {
            let quantity_millis = row.get::<_, i64>(3)?;
            let unit_price_minor = row.get::<_, i64>(5)?;
            let total_minor = i64::try_from(round_div(
                i128::from(quantity_millis) * i128::from(unit_price_minor),
                1_000,
            ))
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?;

            Ok(QuoteItem {
                id: row.get(0)?,
                inventory_item_id: row.get(1)?,
                description: row.get(2)?,
                quantity_millis,
                unit: row.get(4)?,
                unit_price_minor,
                total_minor,
            })
        })
        .map_err(|error| format!("No se pudieron consultar los conceptos: {error}"))?
        .collect::<rusqlite::Result<Vec<QuoteItem>>>()
        .map_err(|error| format!("No se pudieron leer los conceptos: {error}"))?;

    Ok(items)
}

fn find_client_snapshot(connection: &Connection, id: i64) -> Result<ClientSnapshot, String> {
    connection
        .query_row(
            "
            SELECT name, identification, phone, email, address, is_archived
            FROM clients
            WHERE id = ?1
            ",
            params![id],
            |row| {
                Ok(ClientSnapshot {
                    name: row.get(0)?,
                    identification: row.get(1)?,
                    phone: row.get(2)?,
                    email: row.get(3)?,
                    address: row.get(4)?,
                    is_archived: row.get::<_, i64>(5)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el cliente: {error}"))?
        .ok_or_else(|| "El cliente seleccionado ya no existe.".to_owned())
}

fn find_business_snapshot(connection: &Connection) -> Result<BusinessSnapshot, String> {
    let business = connection
        .query_row(
            "
            SELECT business_name, identification, phone, email, address, currency
            FROM business_settings
            WHERE id = 1
            ",
            [],
            |row| {
                Ok(BusinessSnapshot {
                    name: row.get(0)?,
                    identification: row.get(1)?,
                    phone: row.get(2)?,
                    email: row.get(3)?,
                    address: row.get(4)?,
                    currency: row.get(5)?,
                })
            },
        )
        .map_err(|error| format!("No se pudo consultar el negocio: {error}"))?;

    if business.name.trim().chars().count() < 2 {
        return Err("Configura los datos del negocio antes de crear cotizaciones.".to_owned());
    }

    Ok(business)
}

fn find_quote_status_and_client(
    connection: &Connection,
    id: i64,
) -> Result<(QuoteStatus, i64), String> {
    connection
        .query_row(
            "SELECT status, client_id FROM quotes WHERE id = ?1",
            params![id],
            |row| {
                let status = row.get::<_, String>(0)?;
                Ok((QuoteStatus::from_database(&status)?, row.get(1)?))
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar la cotización: {error}"))?
        .ok_or_else(|| "La cotización ya no existe.".to_owned())
}

fn next_quote_number(transaction: &Transaction<'_>, issue_date: &str) -> Result<String, String> {
    let year = &issue_date[..4];
    let prefix = format!("COT-{year}-");
    let pattern = format!("{prefix}%");
    let last_number = transaction
        .query_row(
            "
            SELECT COALESCE(MAX(CAST(SUBSTR(quote_number, 10) AS INTEGER)), 0)
            FROM quotes
            WHERE quote_number LIKE ?1
            ",
            params![pattern],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("No se pudo generar el número de cotización: {error}"))?;

    Ok(format!("{prefix}{:04}", last_number + 1))
}

pub(crate) fn refresh_expired_quotes(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "
            UPDATE quotes
            SET
                status = 'expired',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE status = 'sent' AND valid_until < date('now')
            ",
            [],
        )
        .map_err(|error| format!("No se pudieron actualizar las cotizaciones vencidas: {error}"))?;
    Ok(())
}

fn quote_select() -> &'static str {
    "
    SELECT
        quotes.id,
        quotes.quote_number,
        quotes.client_id,
        quotes.client_name,
        quotes.client_identification,
        quotes.client_phone,
        quotes.client_email,
        quotes.client_address,
        quotes.business_name,
        quotes.business_identification,
        quotes.business_phone,
        quotes.business_email,
        quotes.business_address,
        quotes.currency,
        quotes.issue_date,
        quotes.valid_until,
        quotes.status,
        quotes.discount_basis_points,
        quotes.tax_basis_points,
        quotes.subtotal_minor,
        quotes.discount_minor,
        quotes.tax_minor,
        quotes.total_minor,
        quotes.notes,
        quotes.terms,
        quotes.created_at,
        quotes.updated_at,
        COALESCE(clients.is_archived, 0)
    FROM quotes
    LEFT JOIN clients ON clients.id = quotes.client_id
    "
}

fn quote_from_row(row: &Row<'_>) -> rusqlite::Result<Quote> {
    let status = row.get::<_, String>(16)?;

    Ok(Quote {
        id: row.get(0)?,
        quote_number: row.get(1)?,
        client_id: row.get(2)?,
        client_name: row.get(3)?,
        client_identification: row.get(4)?,
        client_phone: row.get(5)?,
        client_email: row.get(6)?,
        client_address: row.get(7)?,
        business_name: row.get(8)?,
        business_identification: row.get(9)?,
        business_phone: row.get(10)?,
        business_email: row.get(11)?,
        business_address: row.get(12)?,
        currency: row.get(13)?,
        issue_date: row.get(14)?,
        valid_until: row.get(15)?,
        status: QuoteStatus::from_database(&status)?,
        discount_basis_points: row.get(17)?,
        tax_basis_points: row.get(18)?,
        subtotal_minor: row.get(19)?,
        discount_minor: row.get(20)?,
        tax_minor: row.get(21)?,
        total_minor: row.get(22)?,
        notes: row.get(23)?,
        terms: row.get(24)?,
        items: Vec::new(),
        created_at: row.get(25)?,
        updated_at: row.get(26)?,
        client_is_archived: row.get::<_, i64>(27)? != 0,
    })
}

fn is_valid_transition(current: QuoteStatus, next: QuoteStatus) -> bool {
    matches!(
        (current, next),
        (QuoteStatus::Draft, QuoteStatus::Sent)
            | (QuoteStatus::Sent, QuoteStatus::Accepted)
            | (QuoteStatus::Sent, QuoteStatus::Rejected)
    )
}

fn status_label(status: QuoteStatus) -> &'static str {
    match status {
        QuoteStatus::Draft => "borrador",
        QuoteStatus::Sent => "enviada",
        QuoteStatus::Accepted => "aceptada",
        QuoteStatus::Rejected => "rechazada",
        QuoteStatus::Expired => "vencida",
    }
}

fn is_valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || !bytes.iter().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                *byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
    {
        return false;
    }

    let year = value[0..4].parse::<i32>().ok();
    let month = value[5..7].parse::<u32>().ok();
    let day = value[8..10].parse::<u32>().ok();
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return false;
    };

    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return false,
    };

    year >= 2000 && (1..=max_day).contains(&day)
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

fn invalid_database_value(field: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("Valor de {field} no reconocido: {value}").into(),
    )
}

fn lock_connection(state: &DatabaseState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(quantity_millis: i64, unit_price_minor: i64) -> QuoteItemInput {
        QuoteItemInput {
            inventory_item_id: None,
            description: "Servicio de prueba".to_owned(),
            quantity_millis,
            unit: "unidad".to_owned(),
            unit_price_minor,
        }
    }

    #[test]
    fn calculates_totals_with_discount_and_tax() {
        let totals = calculate_totals(&[item(2_000, 10_000)], 1_000, 1_300)
            .expect("the totals should be valid");

        assert_eq!(totals.subtotal_minor, 20_000);
        assert_eq!(totals.discount_minor, 2_000);
        assert_eq!(totals.tax_minor, 2_340);
        assert_eq!(totals.total_minor, 20_340);
    }

    #[test]
    fn validates_leap_dates() {
        assert!(is_valid_date("2028-02-29"));
        assert!(!is_valid_date("2027-02-29"));
    }

    #[test]
    fn only_allows_expected_status_transitions() {
        assert!(is_valid_transition(QuoteStatus::Draft, QuoteStatus::Sent));
        assert!(is_valid_transition(
            QuoteStatus::Sent,
            QuoteStatus::Accepted
        ));
        assert!(!is_valid_transition(
            QuoteStatus::Accepted,
            QuoteStatus::Draft
        ));
    }
}
