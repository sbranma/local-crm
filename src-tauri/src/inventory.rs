use crate::DatabaseState;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

const NAME_MAX_LENGTH: usize = 160;
const SKU_MAX_LENGTH: usize = 80;
const CATEGORY_MAX_LENGTH: usize = 100;
const DESCRIPTION_MAX_LENGTH: usize = 2_000;
const UNIT_MAX_LENGTH: usize = 30;
const REASON_MAX_LENGTH: usize = 300;
const MAX_MONEY_MINOR: i64 = 1_000_000_000_000;
const MAX_STOCK_MILLIS: i64 = 1_000_000_000_000;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InventoryItemType {
    Product,
    Service,
}

impl InventoryItemType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Product => "product",
            Self::Service => "service",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "product" => Ok(Self::Product),
            "service" => Ok(Self::Service),
            _ => Err(invalid_database_value("tipo de artículo", value)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InventoryMovementType {
    Entry,
    Exit,
    Adjustment,
}

impl InventoryMovementType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Entry => "entry",
            Self::Exit => "exit",
            Self::Adjustment => "adjustment",
        }
    }

    fn from_database(value: &str) -> rusqlite::Result<Self> {
        match value {
            "entry" => Ok(Self::Entry),
            "exit" => Ok(Self::Exit),
            "adjustment" => Ok(Self::Adjustment),
            _ => Err(invalid_database_value("tipo de movimiento", value)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    id: i64,
    item_type: InventoryItemType,
    name: String,
    sku: Option<String>,
    category: Option<String>,
    description: Option<String>,
    unit: String,
    cost_price_minor: i64,
    sale_price_minor: i64,
    current_stock_millis: i64,
    minimum_stock_millis: i64,
    is_archived: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemInput {
    item_type: InventoryItemType,
    name: String,
    sku: Option<String>,
    category: Option<String>,
    description: Option<String>,
    unit: String,
    cost_price_minor: i64,
    sale_price_minor: i64,
    minimum_stock_millis: i64,
    initial_stock_millis: i64,
}

struct ValidatedInventoryItemInput {
    item_type: InventoryItemType,
    name: String,
    sku: Option<String>,
    category: Option<String>,
    description: Option<String>,
    unit: String,
    cost_price_minor: i64,
    sale_price_minor: i64,
    minimum_stock_millis: i64,
    initial_stock_millis: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovementInput {
    item_id: i64,
    movement_type: InventoryMovementType,
    quantity_millis: i64,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovement {
    id: i64,
    item_id: i64,
    item_name: String,
    item_sku: Option<String>,
    movement_type: InventoryMovementType,
    quantity_delta_millis: i64,
    previous_stock_millis: i64,
    new_stock_millis: i64,
    reason: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovementResult {
    item: InventoryItem,
    movement: InventoryMovement,
}

#[tauri::command]
pub fn create_inventory_item(
    state: State<'_, DatabaseState>,
    input: InventoryItemInput,
) -> Result<InventoryItem, String> {
    let input = validate_item_input(input)?;
    let mut connection = lock_connection(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar el registro del artículo: {error}"))?;

    transaction
        .execute(
            "
            INSERT INTO inventory_items (
                item_type,
                name,
                sku,
                category,
                description,
                unit,
                cost_price_minor,
                sale_price_minor,
                current_stock_millis,
                minimum_stock_millis
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ",
            params![
                input.item_type.as_str(),
                input.name,
                input.sku,
                input.category,
                input.description,
                input.unit,
                input.cost_price_minor,
                input.sale_price_minor,
                input.initial_stock_millis,
                input.minimum_stock_millis,
            ],
        )
        .map_err(map_item_write_error)?;

    let item_id = transaction.last_insert_rowid();
    if input.initial_stock_millis > 0 {
        insert_movement(
            &transaction,
            item_id,
            InventoryMovementType::Adjustment,
            input.initial_stock_millis,
            0,
            input.initial_stock_millis,
            "Existencia inicial",
        )?;
    }

    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar el artículo: {error}"))?;
    find_item_by_id(&connection, item_id)
}

#[tauri::command]
pub fn list_inventory_items(state: State<'_, DatabaseState>) -> Result<Vec<InventoryItem>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "
            {}
            ORDER BY is_archived, item_type, name COLLATE NOCASE
            ",
            item_select()
        ))
        .map_err(|error| format!("No se pudo preparar la consulta de inventario: {error}"))?;

    let items = statement
        .query_map([], item_from_row)
        .map_err(|error| format!("No se pudo consultar el inventario: {error}"))?
        .collect::<rusqlite::Result<Vec<InventoryItem>>>()
        .map_err(|error| format!("No se pudo leer el inventario: {error}"))?;
    Ok(items)
}

#[tauri::command]
pub fn update_inventory_item(
    state: State<'_, DatabaseState>,
    id: i64,
    input: InventoryItemInput,
) -> Result<InventoryItem, String> {
    let input = validate_item_input(input)?;
    let connection = lock_connection(&state)?;
    let current_type = find_item_type(&connection, id)?;

    if current_type != input.item_type {
        return Err("El tipo de artículo no puede cambiar después de crearlo.".to_owned());
    }

    let updated_rows = connection
        .execute(
            "
            UPDATE inventory_items
            SET
                name = ?1,
                sku = ?2,
                category = ?3,
                description = ?4,
                unit = ?5,
                cost_price_minor = ?6,
                sale_price_minor = ?7,
                minimum_stock_millis = ?8,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?9
            ",
            params![
                input.name,
                input.sku,
                input.category,
                input.description,
                input.unit,
                input.cost_price_minor,
                input.sale_price_minor,
                input.minimum_stock_millis,
                id,
            ],
        )
        .map_err(map_item_write_error)?;

    if updated_rows == 0 {
        return Err("El artículo ya no existe.".to_owned());
    }
    find_item_by_id(&connection, id)
}

#[tauri::command]
pub fn set_inventory_item_archived(
    state: State<'_, DatabaseState>,
    id: i64,
    is_archived: bool,
) -> Result<InventoryItem, String> {
    let connection = lock_connection(&state)?;
    let updated_rows = connection
        .execute(
            "
            UPDATE inventory_items
            SET
                is_archived = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![i64::from(is_archived), id],
        )
        .map_err(|error| format!("No se pudo cambiar el estado del artículo: {error}"))?;

    if updated_rows == 0 {
        return Err("El artículo ya no existe.".to_owned());
    }
    find_item_by_id(&connection, id)
}

#[tauri::command]
pub fn delete_inventory_item(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let relation_count: i64 = connection
        .query_row(
            "
            SELECT
                (SELECT COUNT(*) FROM inventory_movements WHERE inventory_item_id = ?1)
                + (SELECT COUNT(*) FROM quote_items WHERE inventory_item_id = ?1)
            ",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudieron revisar las relaciones del artículo: {error}"))?;

    if relation_count > 0 {
        return Err(
            "No se puede eliminar porque tiene movimientos o cotizaciones relacionadas. Puedes mantenerlo archivado."
                .to_owned(),
        );
    }

    let deleted_rows = connection
        .execute(
            "DELETE FROM inventory_items WHERE id = ?1 AND is_archived = 1",
            params![id],
        )
        .map_err(|error| format!("No se pudo eliminar el artículo: {error}"))?;

    if deleted_rows == 0 {
        return Err("Solo se puede eliminar definitivamente un artículo archivado.".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub fn create_inventory_movement(
    state: State<'_, DatabaseState>,
    input: InventoryMovementInput,
) -> Result<InventoryMovementResult, String> {
    let reason = input.reason.trim().to_owned();
    validate_length("El motivo", &reason, REASON_MAX_LENGTH)?;
    if reason.chars().count() < 2 {
        return Err("Escribe un motivo para el movimiento.".to_owned());
    }

    let mut connection = lock_connection(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("No se pudo iniciar el movimiento: {error}"))?;
    let (item_type, previous_stock, is_archived) = find_stock_state(&transaction, input.item_id)?;

    if item_type != InventoryItemType::Product {
        return Err("Los servicios no manejan existencias.".to_owned());
    }
    if is_archived {
        return Err("Restaura el producto antes de registrar movimientos.".to_owned());
    }

    let (quantity_delta, new_stock) =
        calculate_stock_change(previous_stock, input.movement_type, input.quantity_millis)?;

    transaction
        .execute(
            "
            UPDATE inventory_items
            SET
                current_stock_millis = ?1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?2
            ",
            params![new_stock, input.item_id],
        )
        .map_err(|error| format!("No se pudo actualizar la existencia: {error}"))?;

    let movement_id = insert_movement(
        &transaction,
        input.item_id,
        input.movement_type,
        quantity_delta,
        previous_stock,
        new_stock,
        &reason,
    )?;
    transaction
        .commit()
        .map_err(|error| format!("No se pudo confirmar el movimiento: {error}"))?;

    Ok(InventoryMovementResult {
        item: find_item_by_id(&connection, input.item_id)?,
        movement: find_movement_by_id(&connection, movement_id)?,
    })
}

#[tauri::command]
pub fn list_inventory_movements(
    state: State<'_, DatabaseState>,
    item_id: Option<i64>,
) -> Result<Vec<InventoryMovement>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "
            {}
            WHERE (?1 IS NULL OR inventory_movements.inventory_item_id = ?1)
            ORDER BY inventory_movements.created_at DESC, inventory_movements.id DESC
            ",
            movement_select()
        ))
        .map_err(|error| format!("No se pudo preparar el historial: {error}"))?;

    let movements = statement
        .query_map(params![item_id], movement_from_row)
        .map_err(|error| format!("No se pudo consultar el historial: {error}"))?
        .collect::<rusqlite::Result<Vec<InventoryMovement>>>()
        .map_err(|error| format!("No se pudo leer el historial: {error}"))?;
    Ok(movements)
}

fn validate_item_input(input: InventoryItemInput) -> Result<ValidatedInventoryItemInput, String> {
    let name = input.name.trim().to_owned();
    let sku = normalize_optional(input.sku).map(|value| value.to_uppercase());
    let category = normalize_optional(input.category);
    let description = normalize_optional(input.description);
    let unit = input.unit.trim().to_owned();

    if name.chars().count() < 2 {
        return Err("El nombre debe tener al menos 2 caracteres.".to_owned());
    }
    validate_length("El nombre", &name, NAME_MAX_LENGTH)?;
    validate_optional_length("El SKU", sku.as_deref(), SKU_MAX_LENGTH)?;
    validate_optional_length("La categoría", category.as_deref(), CATEGORY_MAX_LENGTH)?;
    validate_optional_length(
        "La descripción",
        description.as_deref(),
        DESCRIPTION_MAX_LENGTH,
    )?;
    if unit.is_empty() {
        return Err("Indica una unidad.".to_owned());
    }
    validate_length("La unidad", &unit, UNIT_MAX_LENGTH)?;

    if !(0..=MAX_MONEY_MINOR).contains(&input.cost_price_minor)
        || !(0..=MAX_MONEY_MINOR).contains(&input.sale_price_minor)
    {
        return Err("Los precios no tienen un valor válido.".to_owned());
    }
    if !(0..=MAX_STOCK_MILLIS).contains(&input.minimum_stock_millis)
        || !(0..=MAX_STOCK_MILLIS).contains(&input.initial_stock_millis)
    {
        return Err("Las existencias no tienen un valor válido.".to_owned());
    }
    if input.item_type == InventoryItemType::Service
        && (input.minimum_stock_millis != 0 || input.initial_stock_millis != 0)
    {
        return Err("Los servicios no pueden tener existencias.".to_owned());
    }

    Ok(ValidatedInventoryItemInput {
        item_type: input.item_type,
        name,
        sku,
        category,
        description,
        unit,
        cost_price_minor: input.cost_price_minor,
        sale_price_minor: input.sale_price_minor,
        minimum_stock_millis: input.minimum_stock_millis,
        initial_stock_millis: input.initial_stock_millis,
    })
}

fn calculate_stock_change(
    current_stock: i64,
    movement_type: InventoryMovementType,
    quantity_millis: i64,
) -> Result<(i64, i64), String> {
    if !(0..=MAX_STOCK_MILLIS).contains(&quantity_millis) {
        return Err("La cantidad no tiene un valor válido.".to_owned());
    }

    match movement_type {
        InventoryMovementType::Entry => {
            if quantity_millis == 0 {
                return Err("La entrada debe ser mayor que cero.".to_owned());
            }
            let new_stock = current_stock
                .checked_add(quantity_millis)
                .filter(|value| *value <= MAX_STOCK_MILLIS)
                .ok_or_else(|| "La existencia resultante es demasiado grande.".to_owned())?;
            Ok((quantity_millis, new_stock))
        }
        InventoryMovementType::Exit => {
            if quantity_millis == 0 {
                return Err("La salida debe ser mayor que cero.".to_owned());
            }
            if quantity_millis > current_stock {
                return Err("La salida supera las existencias disponibles.".to_owned());
            }
            Ok((-quantity_millis, current_stock - quantity_millis))
        }
        InventoryMovementType::Adjustment => {
            if quantity_millis == current_stock {
                return Err("El ajuste debe cambiar la existencia actual.".to_owned());
            }
            Ok((quantity_millis - current_stock, quantity_millis))
        }
    }
}

fn insert_movement(
    transaction: &Transaction<'_>,
    item_id: i64,
    movement_type: InventoryMovementType,
    quantity_delta: i64,
    previous_stock: i64,
    new_stock: i64,
    reason: &str,
) -> Result<i64, String> {
    transaction
        .execute(
            "
            INSERT INTO inventory_movements (
                inventory_item_id,
                movement_type,
                quantity_delta_millis,
                previous_stock_millis,
                new_stock_millis,
                reason
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                item_id,
                movement_type.as_str(),
                quantity_delta,
                previous_stock,
                new_stock,
                reason,
            ],
        )
        .map_err(|error| format!("No se pudo registrar el movimiento: {error}"))?;
    Ok(transaction.last_insert_rowid())
}

fn find_stock_state(
    transaction: &Transaction<'_>,
    id: i64,
) -> Result<(InventoryItemType, i64, bool), String> {
    transaction
        .query_row(
            "SELECT item_type, current_stock_millis, is_archived FROM inventory_items WHERE id = ?1",
            params![id],
            |row| {
                let item_type = row.get::<_, String>(0)?;
                Ok((
                    InventoryItemType::from_database(&item_type)?,
                    row.get(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el producto: {error}"))?
        .ok_or_else(|| "El producto ya no existe.".to_owned())
}

fn find_item_type(connection: &Connection, id: i64) -> Result<InventoryItemType, String> {
    connection
        .query_row(
            "SELECT item_type FROM inventory_items WHERE id = ?1",
            params![id],
            |row| {
                let value = row.get::<_, String>(0)?;
                InventoryItemType::from_database(&value)
            },
        )
        .optional()
        .map_err(|error| format!("No se pudo consultar el artículo: {error}"))?
        .ok_or_else(|| "El artículo ya no existe.".to_owned())
}

fn find_item_by_id(connection: &Connection, id: i64) -> Result<InventoryItem, String> {
    connection
        .query_row(
            &format!("{} WHERE id = ?1", item_select()),
            params![id],
            item_from_row,
        )
        .map_err(|error| format!("No se pudo consultar el artículo: {error}"))
}

fn find_movement_by_id(connection: &Connection, id: i64) -> Result<InventoryMovement, String> {
    connection
        .query_row(
            &format!("{} WHERE inventory_movements.id = ?1", movement_select()),
            params![id],
            movement_from_row,
        )
        .map_err(|error| format!("No se pudo consultar el movimiento: {error}"))
}

fn item_select() -> &'static str {
    "
    SELECT
        id,
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
        is_archived,
        created_at,
        updated_at
    FROM inventory_items
    "
}

fn item_from_row(row: &Row<'_>) -> rusqlite::Result<InventoryItem> {
    let item_type = row.get::<_, String>(1)?;
    Ok(InventoryItem {
        id: row.get(0)?,
        item_type: InventoryItemType::from_database(&item_type)?,
        name: row.get(2)?,
        sku: row.get(3)?,
        category: row.get(4)?,
        description: row.get(5)?,
        unit: row.get(6)?,
        cost_price_minor: row.get(7)?,
        sale_price_minor: row.get(8)?,
        current_stock_millis: row.get(9)?,
        minimum_stock_millis: row.get(10)?,
        is_archived: row.get::<_, i64>(11)? != 0,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn movement_select() -> &'static str {
    "
    SELECT
        inventory_movements.id,
        inventory_movements.inventory_item_id,
        inventory_items.name,
        inventory_items.sku,
        inventory_movements.movement_type,
        inventory_movements.quantity_delta_millis,
        inventory_movements.previous_stock_millis,
        inventory_movements.new_stock_millis,
        inventory_movements.reason,
        inventory_movements.created_at
    FROM inventory_movements
    INNER JOIN inventory_items
        ON inventory_items.id = inventory_movements.inventory_item_id
    "
}

fn movement_from_row(row: &Row<'_>) -> rusqlite::Result<InventoryMovement> {
    let movement_type = row.get::<_, String>(4)?;
    Ok(InventoryMovement {
        id: row.get(0)?,
        item_id: row.get(1)?,
        item_name: row.get(2)?,
        item_sku: row.get(3)?,
        movement_type: InventoryMovementType::from_database(&movement_type)?,
        quantity_delta_millis: row.get(5)?,
        previous_stock_millis: row.get(6)?,
        new_stock_millis: row.get(7)?,
        reason: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn map_item_write_error(error: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(sqlite_error, _) = &error {
        if sqlite_error.code == ErrorCode::ConstraintViolation {
            return "Ya existe un artículo con ese SKU o alguno de los datos no es válido."
                .to_owned();
        }
    }
    format!("No se pudo guardar el artículo: {error}")
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

    fn valid_product() -> InventoryItemInput {
        InventoryItemInput {
            item_type: InventoryItemType::Product,
            name: "Cable de red".to_owned(),
            sku: Some(" cab-01 ".to_owned()),
            category: Some("Redes".to_owned()),
            description: None,
            unit: "unidad".to_owned(),
            cost_price_minor: 2_000,
            sale_price_minor: 3_500,
            minimum_stock_millis: 5_000,
            initial_stock_millis: 10_000,
        }
    }

    #[test]
    fn normalizes_inventory_fields() {
        let input = validate_item_input(valid_product()).expect("the product should be valid");
        assert_eq!(input.sku.as_deref(), Some("CAB-01"));
        assert_eq!(input.name, "Cable de red");
    }

    #[test]
    fn rejects_stock_for_services() {
        let mut input = valid_product();
        input.item_type = InventoryItemType::Service;
        assert!(validate_item_input(input).is_err());
    }

    #[test]
    fn prevents_negative_stock() {
        let result = calculate_stock_change(2_000, InventoryMovementType::Exit, 3_000);
        assert!(result.is_err());
    }

    #[test]
    fn calculates_an_adjustment_delta() {
        let result = calculate_stock_change(5_000, InventoryMovementType::Adjustment, 3_500)
            .expect("the adjustment should be valid");
        assert_eq!(result, (-1_500, 3_500));
    }
}
