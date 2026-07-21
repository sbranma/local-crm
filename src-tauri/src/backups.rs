use crate::{
    database::{migrate_to_current_schema, CURRENT_SCHEMA_VERSION},
    system::record_successful_backup,
    DatabaseState,
};
use rusqlite::{backup::Progress, params, Connection, OpenFlags, MAIN_DB};
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
const FIRST_SUPPORTED_SCHEMA_VERSION: i64 = 5;
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
const DOCUMENT_TABLES: [&str; 3] = ["document_folders", "documents", "backup_document_contents"];

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
    document_count: i64,
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
    export_database(&connection, &destination, &state.documents_path)?;
    let backup = inspect_backup_path(&destination)?;
    record_successful_backup(&connection)?;
    Ok(backup)
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
    restore_database(
        &mut connection,
        &source,
        &safety_backup,
        &state.documents_path,
    )?;

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
    if !(FIRST_SUPPORTED_SCHEMA_VERSION..=CURRENT_SCHEMA_VERSION).contains(&schema_version) {
        return Err(format!(
            "El respaldo usa la versión {schema_version}; esta aplicación admite desde la versión {FIRST_SUPPORTED_SCHEMA_VERSION} hasta la {CURRENT_SCHEMA_VERSION}."
        ));
    }

    if schema_version >= 6 {
        for table in DOCUMENT_TABLES {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [table],
                    |row| row.get(0),
                )
                .map_err(|error| {
                    format!("No se pudo revisar la estructura del respaldo: {error}")
                })?;
            if !exists {
                return Err(format!(
                    "El respaldo está incompleto: falta la tabla obligatoria {table}."
                ));
            }
        }
        validate_document_contents(connection)?;
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
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("No se pudo leer la versión del respaldo: {error}"))?;
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
        schema_version,
        business_name,
        client_count: table_count(connection, "clients")?,
        task_count: table_count(connection, "tasks")?,
        quote_count: table_count(connection, "quotes")?,
        calendar_event_count: table_count(connection, "calendar_events")?,
        inventory_item_count: table_count(connection, "inventory_items")?,
        document_count: if schema_version >= 6 {
            table_count(connection, "documents")?
        } else {
            0
        },
    })
}

fn validate_document_contents(connection: &Connection) -> Result<(), String> {
    let missing_contents: i64 = connection
        .query_row(
            "SELECT COUNT(*)
             FROM documents document
             LEFT JOIN backup_document_contents content
                ON content.document_id = document.id
             WHERE content.document_id IS NULL
                OR length(content.data) != document.size_bytes",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudieron validar los archivos del respaldo: {error}"))?;
    let orphan_contents: i64 = connection
        .query_row(
            "SELECT COUNT(*)
             FROM backup_document_contents content
             LEFT JOIN documents document ON document.id = content.document_id
             WHERE document.id IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("No se pudieron validar los archivos del respaldo: {error}"))?;
    if missing_contents > 0 || orphan_contents > 0 {
        return Err("El respaldo contiene archivos incompletos o sin registro.".to_owned());
    }
    Ok(())
}

fn table_count(connection: &Connection, table: &str) -> Result<i64, String> {
    if !REQUIRED_TABLES.contains(&table) && table != "documents" {
        return Err("Se intentó consultar una tabla no permitida.".to_owned());
    }
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("No se pudo contar la información del respaldo: {error}"))
}

fn export_database(
    connection: &Connection,
    destination: &Path,
    documents_path: &Path,
) -> Result<(), String> {
    let temporary_path = adjacent_temporary_path(destination, "creating");
    remove_temporary_file(&temporary_path)?;

    let backup_result = connection
        .backup(MAIN_DB, &temporary_path, None)
        .map_err(|error| format!("No se pudo crear el respaldo: {error}"));
    if let Err(error) = backup_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = embed_documents(&temporary_path, documents_path) {
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
    documents_path: &Path,
) -> Result<(), String> {
    export_database(connection, safety_backup, documents_path)
        .map_err(|error| format!("No se pudo proteger la información actual: {error}"))?;

    let staging_directory = adjacent_documents_path(documents_path, "restoring");
    prepare_documents_directory(source, &staging_directory)?;

    let restore_result = connection
        .restore(MAIN_DB, source, None::<fn(Progress)>)
        .map_err(|error| format!("No se pudo copiar el respaldo seleccionado: {error}"))
        .and_then(|_| validate_database(connection))
        .and_then(|_| migrate_to_current_schema(connection))
        .and_then(|_| {
            connection
                .execute_batch("DROP TABLE IF EXISTS backup_document_contents;")
                .map_err(|error| format!("No se pudo finalizar la base restaurada: {error}"))
        });

    if let Err(error) = restore_result {
        let _ = fs::remove_dir_all(&staging_directory);
        let recovery_result = connection.restore(MAIN_DB, safety_backup, None::<fn(Progress)>);
        return match recovery_result {
            Ok(()) => {
                let _ = migrate_to_current_schema(connection);
                let _ = connection.execute_batch("DROP TABLE IF EXISTS backup_document_contents;");
                Err(format!(
                    "La restauración falló y se recuperaron los datos anteriores. {error}"
                ))
            }
            Err(recovery_error) => Err(format!(
                "La restauración falló y no se pudo recuperar automáticamente la información anterior. {error} Recuperación: {recovery_error}"
            )),
        };
    }

    if let Err(error) = replace_documents_directory(&staging_directory, documents_path) {
        let recovery_result = connection.restore(MAIN_DB, safety_backup, None::<fn(Progress)>);
        if recovery_result.is_ok() {
            let _ = migrate_to_current_schema(connection);
            let _ = connection.execute_batch("DROP TABLE IF EXISTS backup_document_contents;");
            return Err(format!(
                "La restauración falló al recuperar los archivos y se conservaron los datos anteriores. {error}"
            ));
        }
        return Err(format!(
            "La restauración falló al recuperar los archivos y tampoco pudo recuperar automáticamente la base anterior. {error}"
        ));
    }

    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| {
            format!("Los datos se restauraron, pero no se pudo reactivar su validación: {error}")
        })?;
    Ok(())
}

fn embed_documents(backup_path: &Path, documents_path: &Path) -> Result<(), String> {
    let mut backup = Connection::open(backup_path)
        .map_err(|error| format!("No se pudo preparar el contenido del respaldo: {error}"))?;
    backup
        .execute_batch(
            "DROP TABLE IF EXISTS backup_document_contents;
             CREATE TABLE backup_document_contents (
                document_id INTEGER PRIMARY KEY,
                data BLOB NOT NULL,
                FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
             );",
        )
        .map_err(|error| format!("No se pudo preparar el contenido del respaldo: {error}"))?;

    let records = {
        let mut statement = backup
            .prepare("SELECT id, stored_name, size_bytes FROM documents ORDER BY id")
            .map_err(|error| format!("No se pudieron leer los archivos guardados: {error}"))?;
        let records = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|error| format!("No se pudieron leer los archivos guardados: {error}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("No se pudieron leer los archivos guardados: {error}"))?;
        records
    };

    let transaction = backup
        .transaction()
        .map_err(|error| format!("No se pudo iniciar el empaquetado de archivos: {error}"))?;
    for (id, stored_name, expected_size) in records {
        validate_stored_name(&stored_name)?;
        let path = documents_path.join(&stored_name);
        let data = fs::read(&path).map_err(|_| {
            format!("Falta el archivo físico “{stored_name}”. No se creó un respaldo incompleto.")
        })?;
        if data.len() as i64 != expected_size {
            return Err(format!(
                "El archivo “{stored_name}” cambió de tamaño inesperadamente. Intenta crear el respaldo otra vez."
            ));
        }
        transaction
            .execute(
                "INSERT INTO backup_document_contents (document_id, data) VALUES (?1, ?2)",
                params![id, data],
            )
            .map_err(|error| format!("No se pudo incluir un archivo en el respaldo: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("No se pudo finalizar el contenido del respaldo: {error}"))?;
    Ok(())
}

fn prepare_documents_directory(backup_path: &Path, staging: &Path) -> Result<(), String> {
    if staging.exists() {
        fs::remove_dir_all(staging)
            .map_err(|error| format!("No se pudo limpiar la restauración temporal: {error}"))?;
    }
    fs::create_dir_all(staging)
        .map_err(|error| format!("No se pudo preparar la restauración de archivos: {error}"))?;

    let backup = Connection::open_with_flags(
        backup_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("No se pudo abrir el respaldo para extraer archivos: {error}"))?;
    let schema_version: i64 = backup
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("No se pudo leer la versión del respaldo: {error}"))?;
    if schema_version < 6 {
        return Ok(());
    }

    let records = {
        let mut statement = backup
            .prepare(
                "SELECT document.stored_name, document.size_bytes, content.data
                 FROM documents document
                 JOIN backup_document_contents content
                    ON content.document_id = document.id
                 ORDER BY document.id",
            )
            .map_err(|error| {
                format!("No se pudieron preparar los archivos restaurados: {error}")
            })?;
        let records = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(|error| format!("No se pudieron leer los archivos restaurados: {error}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("No se pudieron leer los archivos restaurados: {error}"))?;
        records
    };

    for (stored_name, expected_size, data) in records {
        validate_stored_name(&stored_name)?;
        if data.len() as i64 != expected_size {
            let _ = fs::remove_dir_all(staging);
            return Err(format!(
                "El archivo “{stored_name}” está incompleto dentro del respaldo."
            ));
        }
        fs::write(staging.join(stored_name), data)
            .map_err(|error| format!("No se pudo extraer un archivo restaurado: {error}"))?;
    }
    Ok(())
}

fn replace_documents_directory(staging: &Path, documents_path: &Path) -> Result<(), String> {
    let previous = adjacent_documents_path(documents_path, "previous");
    if previous.exists() {
        fs::remove_dir_all(&previous)
            .map_err(|error| format!("No se pudo limpiar una carpeta temporal: {error}"))?;
    }
    if documents_path.exists() {
        fs::rename(documents_path, &previous).map_err(|error| {
            format!("No se pudo proteger la carpeta de archivos actual: {error}")
        })?;
    }
    if let Err(error) = fs::rename(staging, documents_path) {
        if previous.exists() {
            let _ = fs::rename(&previous, documents_path);
        }
        return Err(format!("No se pudo activar la carpeta restaurada: {error}"));
    }
    if previous.exists() {
        let _ = fs::remove_dir_all(previous);
    }
    Ok(())
}

fn validate_stored_name(stored_name: &str) -> Result<(), String> {
    let path = Path::new(stored_name);
    if path.components().count() != 1
        || path.file_name().and_then(|name| name.to_str()) != Some(stored_name)
    {
        return Err("El respaldo contiene una ruta interna de archivo inválida.".to_owned());
    }
    Ok(())
}

fn adjacent_documents_path(path: &Path, label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let directory_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("documents");
    path.with_file_name(format!(
        ".{directory_name}.{label}-{}-{unique}",
        std::process::id()
    ))
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

        let documents_path = temporary_test_directory("backup-documents");
        fs::create_dir_all(&documents_path).expect("documents directory should be created");
        export_database(&source, &backup_path, &documents_path).expect("backup should be exported");
        let info = inspect_backup_path(&backup_path).expect("backup should be valid");

        assert_eq!(info.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(info.client_count, 1);
        cleanup(&[source_path, backup_path]);
        cleanup_directories(&[documents_path]);
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
        let current_documents = temporary_test_directory("restore-current-documents");
        let source_documents = temporary_test_directory("restore-source-documents");
        fs::create_dir_all(&current_documents).expect("current documents directory should exist");
        fs::create_dir_all(&source_documents).expect("source documents directory should exist");
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
        let document_data = b"%PDF-1.7\nficticio!!";
        source
            .execute(
                "INSERT INTO documents (
                    display_name, stored_name, extension, mime_type, size_bytes
                 ) VALUES ('Contrato ficticio.pdf', 'document-fixture.pdf', 'pdf', 'application/pdf', ?1)",
                [document_data.len() as i64],
            )
            .expect("document metadata should be inserted");
        fs::write(source_documents.join("document-fixture.pdf"), document_data)
            .expect("document fixture should be written");
        export_database(&source, &backup_path, &source_documents)
            .expect("selected backup should be exported");

        restore_database(&mut current, &backup_path, &safety_path, &current_documents)
            .expect("backup should restore");

        let restored_name: String = current
            .query_row("SELECT name FROM clients", [], |row| row.get(0))
            .expect("restored client should exist");
        let safety_info = inspect_backup_path(&safety_path).expect("safety backup should be valid");
        assert_eq!(restored_name, "Estado respaldado");
        assert_eq!(safety_info.client_count, 1);
        assert!(current_documents.join("document-fixture.pdf").is_file());
        cleanup(&[current_path, source_path, backup_path, safety_path]);
        cleanup_directories(&[current_documents, source_documents]);
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

    fn temporary_test_directory(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("local-crm-{label}-{}-{unique}", std::process::id()))
    }

    fn cleanup(paths: &[PathBuf]) {
        for path in paths {
            let _ = fs::remove_file(path);
        }
    }

    fn cleanup_directories(paths: &[PathBuf]) {
        for path in paths {
            let _ = fs::remove_dir_all(path);
        }
    }
}
