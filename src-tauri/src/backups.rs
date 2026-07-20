use crate::{database::CURRENT_SCHEMA_VERSION, DatabaseState};
use rusqlite::{backup::Progress, Connection, OpenFlags, MAIN_DB};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::MutexGuard,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const BACKUP_EXTENSION: &str = "localcrm";
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
const MAX_BACKUP_BYTES: u64 = 1024 * 1024 * 1024;
const REQUIRED_TABLES: [&str; 8] = [
    "clients",
    "tasks",
    "business_settings",
    "quotes",
    "quote_items",
    "calendar_events",
    "inventory_items",
    "inventory_movements",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    file_name: String,
    size_bytes: u64,
    schema_version: i64,
    business_name: Option<String>,
    client_count: i64,
    task_count: i64,
    quote_count: i64,
    calendar_event_count: i64,
    inventory_item_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    restored_backup: BackupInfo,
    safety_backup_path: String,
}

#[tauri::command]
pub fn export_backup(
    state: State<'_, DatabaseState>,
    destination_path: String,
) -> Result<BackupInfo, String> {
    let destination = PathBuf::from(destination_path);
    validate_selected_path(&destination, false)?;
    reject_live_database_path(&destination, &state.database_path)?;

    let connection = lock_connection(&state)?;
    export_database(&connection, &destination)?;
    inspect_backup_path(&destination)
}

#[tauri::command]
pub fn inspect_backup(source_path: String) -> Result<BackupInfo, String> {
    inspect_backup_path(Path::new(&source_path))
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, DatabaseState>,
    source_path: String,
    confirmed: bool,
) -> Result<RestoreResult, String> {
    if !confirmed {
        return Err("Confirma la restauración antes de reemplazar los datos.".to_owned());
    }

    let source = PathBuf::from(source_path);
    let restored_backup = inspect_backup_path(&source)?;
    reject_live_database_path(&source, &state.database_path)?;

    let safety_backup = state
        .database_path
        .with_file_name("local-crm-before-last-restore.localcrm");
    let mut connection = lock_connection(&state)?;
    restore_database(&mut connection, &source, &safety_backup)?;

    Ok(RestoreResult {
        restored_backup,
        safety_backup_path: safety_backup.to_string_lossy().into_owned(),
    })
}

fn inspect_backup_path(path: &Path) -> Result<BackupInfo, String> {
    validate_selected_path(path, true)?;
    validate_sqlite_header(path)?;

    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("No se pudo abrir el respaldo: {error}"))?;

    validate_database(&connection)?;
    backup_info(&connection, path)
}

fn validate_selected_path(path: &Path, must_exist: bool) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Selecciona una ubicación válida para el respaldo.".to_owned());
    }

    let has_valid_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(BACKUP_EXTENSION));
    if !has_valid_extension {
        return Err("El respaldo debe usar la extensión .localcrm.".to_owned());
    }

    if must_exist {
        let metadata = fs::metadata(path)
            .map_err(|_| "El archivo de respaldo ya no existe o no se puede leer.".to_owned())?;
        if !metadata.is_file() {
            return Err("Selecciona un archivo de respaldo válido.".to_owned());
        }
        if metadata.len() == 0 || metadata.len() > MAX_BACKUP_BYTES {
            return Err("El tamaño del respaldo no es válido.".to_owned());
        }
    } else if !path.parent().is_some_and(Path::is_dir) {
        return Err("La carpeta seleccionada ya no existe.".to_owned());
    }

    Ok(())
}

fn validate_sqlite_header(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("No se pudo leer el respaldo: {error}"))?;
    let mut header = [0_u8; SQLITE_HEADER.len()];
    file.read_exact(&mut header)
        .map_err(|_| "El archivo es demasiado pequeño para ser un respaldo válido.".to_owned())?;

    if &header != SQLITE_HEADER {
        return Err("El archivo seleccionado no es una base SQLite válida.".to_owned());
    }
    Ok(())
}

fn validate_database(connection: &Connection) -> Result<(), String> {
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("No se pudo leer la versión del respaldo: {error}"))?;
    if schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "El respaldo usa la versión {schema_version}; esta aplicación requiere la versión {CURRENT_SCHEMA_VERSION}."
        ));
    }

    for table in REQUIRED_TABLES {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table],
                |row| row.get(0),
            )
            .map_err(|error| format!("No se pudo revisar la estructura del respaldo: {error}"))?;
        if !exists {
            return Err(format!(
                "El respaldo está incompleto: falta la tabla obligatoria {table}."
            ));
        }
    }

    let integrity: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(|error| format!("No se pudo comprobar la integridad del respaldo: {error}"))?;
    if integrity != "ok" {
        return Err(format!(
            "El respaldo no superó la comprobación de integridad: {integrity}."
        ));
    }

    let mut foreign_key_check = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| format!("No se pudieron comprobar las relaciones: {error}"))?;
    if foreign_key_check
        .query([])
        .and_then(|mut rows| rows.next().map(|row| row.is_some()))
        .map_err(|error| format!("No se pudieron validar las relaciones: {error}"))?
    {
        return Err("El respaldo contiene relaciones inválidas entre sus registros.".to_owned());
    }

    Ok(())
}

fn backup_info(connection: &Connection, path: &Path) -> Result<BackupInfo, String> {
    let business_name = connection
        .query_row(
            "SELECT NULLIF(trim(business_name), '') FROM business_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudieron leer los datos del negocio: {error}"))?;

    Ok(BackupInfo {
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("respaldo.localcrm")
            .to_owned(),
        size_bytes: fs::metadata(path)
            .map_err(|error| format!("No se pudo consultar el tamaño del respaldo: {error}"))?
            .len(),
        schema_version: CURRENT_SCHEMA_VERSION,
        business_name,
        client_count: table_count(connection, "clients")?,
        task_count: table_count(connection, "tasks")?,
        quote_count: table_count(connection, "quotes")?,
        calendar_event_count: table_count(connection, "calendar_events")?,
        inventory_item_count: table_count(connection, "inventory_items")?,
    })
}

fn table_count(connection: &Connection, table: &str) -> Result<i64, String> {
    if !REQUIRED_TABLES.contains(&table) {
        return Err("Se intentó consultar una tabla no permitida.".to_owned());
    }
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("No se pudo contar la información del respaldo: {error}"))
}

fn export_database(connection: &Connection, destination: &Path) -> Result<(), String> {
    let temporary_path = adjacent_temporary_path(destination, "creating");
    remove_temporary_file(&temporary_path)?;

    let backup_result = connection
        .backup(MAIN_DB, &temporary_path, None)
        .map_err(|error| format!("No se pudo crear el respaldo: {error}"));
    if let Err(error) = backup_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = inspect_backup_path(&temporary_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!(
            "El respaldo creado no superó la validación: {error}"
        ));
    }

    replace_file(&temporary_path, destination)
}

fn restore_database(
    connection: &mut Connection,
    source: &Path,
    safety_backup: &Path,
) -> Result<(), String> {
    export_database(connection, safety_backup)
        .map_err(|error| format!("No se pudo proteger la información actual: {error}"))?;

    let restore_result = connection
        .restore(MAIN_DB, source, None::<fn(Progress)>)
        .map_err(|error| format!("No se pudo copiar el respaldo seleccionado: {error}"))
        .and_then(|_| validate_database(connection));

    if let Err(error) = restore_result {
        let recovery_result = connection.restore(MAIN_DB, safety_backup, None::<fn(Progress)>);
        return match recovery_result {
            Ok(()) => Err(format!(
                "La restauración falló y se recuperaron los datos anteriores. {error}"
            )),
            Err(recovery_error) => Err(format!(
                "La restauración falló y no se pudo recuperar automáticamente la información anterior. {error} Recuperación: {recovery_error}"
            )),
        };
    }

    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| {
            format!("Los datos se restauraron, pero no se pudo reactivar su validación: {error}")
        })?;
    Ok(())
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(source, destination)
            .map_err(|error| format!("No se pudo guardar el respaldo: {error}"));
    }

    let previous_path = adjacent_temporary_path(destination, "previous");
    remove_temporary_file(&previous_path)?;
    fs::rename(destination, &previous_path)
        .map_err(|error| format!("No se pudo preparar el archivo que será reemplazado: {error}"))?;

    if let Err(error) = fs::rename(source, destination) {
        let _ = fs::rename(&previous_path, destination);
        return Err(format!("No se pudo reemplazar el respaldo: {error}"));
    }

    fs::remove_file(&previous_path).map_err(|error| {
        format!("El respaldo se guardó, pero no se pudo limpiar el archivo temporal: {error}")
    })?;
    Ok(())
}

fn adjacent_temporary_path(path: &Path, label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("local-crm-backup.localcrm");
    path.with_file_name(format!(
        ".{file_name}.{label}-{}-{unique}.{BACKUP_EXTENSION}",
        std::process::id()
    ))
}

fn remove_temporary_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("No se pudo limpiar un archivo temporal: {error}"))?;
    }
    Ok(())
}

fn reject_live_database_path(selected: &Path, database_path: &Path) -> Result<(), String> {
    let same_path = if selected.exists() && database_path.exists() {
        match (fs::canonicalize(selected), fs::canonicalize(database_path)) {
            (Ok(selected), Ok(database_path)) => selected == database_path,
            _ => selected == database_path,
        }
    } else {
        selected == database_path
    };

    if same_path {
        return Err(
            "No selecciones el archivo interno que la aplicación está utilizando.".to_owned(),
        );
    }
    Ok(())
}

fn lock_connection(state: &DatabaseState) -> Result<MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "No se pudo acceder a la base de datos local.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::initialize_database;

    #[test]
    fn exports_and_inspects_a_complete_backup() {
        let source_path = temporary_test_path("backup-source", "sqlite3");
        let backup_path = temporary_test_path("backup-export", BACKUP_EXTENSION);
        let source = initialize_database(&source_path).expect("source database should initialize");
        source
            .execute("INSERT INTO clients (name) VALUES ('Cliente ficticio')", [])
            .expect("a client should be inserted");

        export_database(&source, &backup_path).expect("backup should be exported");
        let info = inspect_backup_path(&backup_path).expect("backup should be valid");

        assert_eq!(info.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(info.client_count, 1);
        cleanup(&[source_path, backup_path]);
    }

    #[test]
    fn rejects_a_file_without_the_sqlite_header() {
        let backup_path = temporary_test_path("backup-invalid", BACKUP_EXTENSION);
        fs::write(&backup_path, b"not a database").expect("invalid fixture should be written");

        let error = inspect_backup_path(&backup_path).expect_err("invalid backup should fail");

        assert!(error.contains("demasiado pequeño") || error.contains("no es una base SQLite"));
        cleanup(&[backup_path]);
    }

    #[test]
    fn restores_data_and_preserves_the_previous_database() {
        let current_path = temporary_test_path("restore-current", "sqlite3");
        let source_path = temporary_test_path("restore-source", "sqlite3");
        let backup_path = temporary_test_path("restore-selected", BACKUP_EXTENSION);
        let safety_path = temporary_test_path("restore-safety", BACKUP_EXTENSION);
        let mut current =
            initialize_database(&current_path).expect("current database should initialize");
        let source = initialize_database(&source_path).expect("source database should initialize");
        current
            .execute("INSERT INTO clients (name) VALUES ('Estado anterior')", [])
            .expect("current data should be inserted");
        source
            .execute(
                "INSERT INTO clients (name) VALUES ('Estado respaldado')",
                [],
            )
            .expect("backup data should be inserted");
        export_database(&source, &backup_path).expect("selected backup should be exported");

        restore_database(&mut current, &backup_path, &safety_path).expect("backup should restore");

        let restored_name: String = current
            .query_row("SELECT name FROM clients", [], |row| row.get(0))
            .expect("restored client should exist");
        let safety_info = inspect_backup_path(&safety_path).expect("safety backup should be valid");
        assert_eq!(restored_name, "Estado respaldado");
        assert_eq!(safety_info.client_count, 1);
        cleanup(&[current_path, source_path, backup_path, safety_path]);
    }

    fn temporary_test_path(label: &str, extension: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "local-crm-{label}-{}-{unique}.{extension}",
            std::process::id()
        ))
    }

    fn cleanup(paths: &[PathBuf]) {
        for path in paths {
            let _ = fs::remove_file(path);
        }
    }
}
