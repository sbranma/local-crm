use crate::DatabaseState;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::MutexGuard,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const MAX_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFolder {
    id: i64,
    parent_id: Option<i64>,
    name: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    id: i64,
    folder_id: Option<i64>,
    folder_name: Option<String>,
    client_id: Option<i64>,
    client_name: Option<String>,
    display_name: String,
    extension: String,
    mime_type: String,
    size_bytes: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocumentInput {
    source_path: String,
    folder_id: Option<i64>,
    client_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDocumentInput {
    display_name: String,
    folder_id: Option<i64>,
    client_id: Option<i64>,
}

#[tauri::command]
pub fn list_document_folders(
    state: State<'_, DatabaseState>,
) -> Result<Vec<DocumentFolder>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT id, parent_id, name, created_at, updated_at
             FROM document_folders
             ORDER BY name COLLATE NOCASE",
        )
        .map_err(database_error)?;
    let folders = statement
        .query_map([], |row| {
            Ok(DocumentFolder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    Ok(folders)
}

#[tauri::command]
pub fn create_document_folder(
    state: State<'_, DatabaseState>,
    parent_id: Option<i64>,
    name: String,
) -> Result<DocumentFolder, String> {
    create_document_folder_inner(&state, parent_id, name)
}

fn create_document_folder_inner(
    state: &DatabaseState,
    parent_id: Option<i64>,
    name: String,
) -> Result<DocumentFolder, String> {
    let name = validate_folder_name(&name)?;
    let connection = lock_connection(&state)?;
    validate_folder_exists(&connection, parent_id)?;
    connection
        .execute(
            "INSERT INTO document_folders (parent_id, name) VALUES (?1, ?2)",
            params![parent_id, name],
        )
        .map_err(folder_write_error)?;
    query_folder(&connection, connection.last_insert_rowid())
}

#[tauri::command]
pub fn update_document_folder(
    state: State<'_, DatabaseState>,
    id: i64,
    name: String,
    parent_id: Option<i64>,
) -> Result<DocumentFolder, String> {
    update_document_folder_inner(&state, id, name, parent_id)
}

fn update_document_folder_inner(
    state: &DatabaseState,
    id: i64,
    name: String,
    parent_id: Option<i64>,
) -> Result<DocumentFolder, String> {
    let name = validate_folder_name(&name)?;
    if parent_id == Some(id) {
        return Err("Una carpeta no puede estar dentro de sí misma.".to_owned());
    }
    let connection = lock_connection(&state)?;
    validate_folder_exists(&connection, Some(id))?;
    validate_folder_exists(&connection, parent_id)?;
    if let Some(parent_id) = parent_id {
        let is_descendant: bool = connection
            .query_row(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM document_folders WHERE parent_id = ?1
                    UNION ALL
                    SELECT folder.id
                    FROM document_folders folder
                    JOIN descendants ON folder.parent_id = descendants.id
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
                params![id, parent_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if is_descendant {
            return Err("No puedes mover una carpeta dentro de una subcarpeta propia.".to_owned());
        }
    }
    connection
        .execute(
            "UPDATE document_folders
             SET name = ?1, parent_id = ?2,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?3",
            params![name, parent_id, id],
        )
        .map_err(folder_write_error)?;
    query_folder(&connection, id)
}

#[tauri::command]
pub fn delete_document_folder(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    delete_document_folder_inner(&state, id)
}

fn delete_document_folder_inner(state: &DatabaseState, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let changed = connection
        .execute("DELETE FROM document_folders WHERE id = ?1", [id])
        .map_err(|error| {
            if error.sqlite_error_code() == Some(ErrorCode::ConstraintViolation) {
                "La carpeta debe estar vacía antes de eliminarla.".to_owned()
            } else {
                database_error(error)
            }
        })?;
    if changed == 0 {
        return Err("La carpeta ya no existe.".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub fn list_documents(state: State<'_, DatabaseState>) -> Result<Vec<DocumentRecord>, String> {
    let connection = lock_connection(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT document.id, document.folder_id, folder.name,
                    document.client_id, client.name, document.display_name,
                    document.extension, document.mime_type, document.size_bytes,
                    document.created_at, document.updated_at
             FROM documents document
             LEFT JOIN document_folders folder ON folder.id = document.folder_id
             LEFT JOIN clients client ON client.id = document.client_id
             ORDER BY document.updated_at DESC, document.display_name COLLATE NOCASE",
        )
        .map_err(database_error)?;
    let documents = statement
        .query_map([], document_from_row)
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    Ok(documents)
}

#[tauri::command]
pub fn import_document(
    state: State<'_, DatabaseState>,
    input: ImportDocumentInput,
) -> Result<DocumentRecord, String> {
    import_document_inner(&state, input)
}

fn import_document_inner(
    state: &DatabaseState,
    input: ImportDocumentInput,
) -> Result<DocumentRecord, String> {
    let source = PathBuf::from(input.source_path);
    let validated = validate_source_document(&source)?;
    let connection = lock_connection(&state)?;
    validate_folder_exists(&connection, input.folder_id)?;
    validate_client_exists(&connection, input.client_id)?;

    fs::create_dir_all(&state.documents_path)
        .map_err(|error| format!("No se pudo preparar la carpeta privada de archivos: {error}"))?;
    let stored_name = generate_stored_name(&state.documents_path, validated.extension);
    let destination = state.documents_path.join(&stored_name);
    let temporary = state
        .documents_path
        .join(format!(".{stored_name}.importing"));
    fs::copy(&source, &temporary)
        .map_err(|error| format!("No se pudo copiar el archivo seleccionado: {error}"))?;
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("No se pudo guardar el archivo localmente: {error}"));
    }

    let insert_result = connection.execute(
        "INSERT INTO documents (
            folder_id, client_id, display_name, stored_name,
            extension, mime_type, size_bytes
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.folder_id,
            input.client_id,
            validated.display_name,
            stored_name,
            validated.extension,
            validated.mime_type,
            validated.size_bytes as i64,
        ],
    );
    if let Err(error) = insert_result {
        let _ = fs::remove_file(&destination);
        return Err(database_error(error));
    }
    query_document(&connection, connection.last_insert_rowid())
}

#[tauri::command]
pub fn update_document(
    state: State<'_, DatabaseState>,
    id: i64,
    input: UpdateDocumentInput,
) -> Result<DocumentRecord, String> {
    update_document_inner(&state, id, input)
}

fn update_document_inner(
    state: &DatabaseState,
    id: i64,
    input: UpdateDocumentInput,
) -> Result<DocumentRecord, String> {
    let connection = lock_connection(&state)?;
    let extension: String = connection
        .query_row(
            "SELECT extension FROM documents WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or_else(|| "El archivo ya no existe.".to_owned())?;
    let display_name = validate_display_name(&input.display_name, &extension)?;
    validate_folder_exists(&connection, input.folder_id)?;
    validate_client_exists(&connection, input.client_id)?;
    connection
        .execute(
            "UPDATE documents
             SET display_name = ?1, folder_id = ?2, client_id = ?3,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?4",
            params![display_name, input.folder_id, input.client_id, id],
        )
        .map_err(database_error)?;
    query_document(&connection, id)
}

#[tauri::command]
pub fn open_document(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    let connection = lock_connection(&state)?;
    let stored_name = query_stored_name(&connection, id)?;
    let path = stored_document_path(&state.documents_path, &stored_name)?;
    if !path.is_file() {
        return Err(
            "El archivo físico ya no está disponible. Restaura un respaldo válido.".to_owned(),
        );
    }
    Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| format!("Windows no pudo abrir el archivo: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_document(
    state: State<'_, DatabaseState>,
    id: i64,
    destination_path: String,
) -> Result<(), String> {
    export_document_inner(&state, id, destination_path)
}

fn export_document_inner(
    state: &DatabaseState,
    id: i64,
    destination_path: String,
) -> Result<(), String> {
    let destination = PathBuf::from(destination_path);
    if !destination.is_absolute() || !destination.parent().is_some_and(Path::is_dir) {
        return Err("Selecciona una ubicación válida para exportar el archivo.".to_owned());
    }
    let connection = lock_connection(&state)?;
    let stored_name = query_stored_name(&connection, id)?;
    let source = stored_document_path(&state.documents_path, &stored_name)?;
    if !source.is_file() {
        return Err(
            "El archivo físico ya no está disponible. Restaura un respaldo válido.".to_owned(),
        );
    }
    fs::copy(source, destination)
        .map_err(|error| format!("No se pudo exportar el archivo: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_document(state: State<'_, DatabaseState>, id: i64) -> Result<(), String> {
    delete_document_inner(&state, id)
}

fn delete_document_inner(state: &DatabaseState, id: i64) -> Result<(), String> {
    let mut connection = lock_connection(&state)?;
    let stored_name = query_stored_name(&connection, id)?;
    let original = stored_document_path(&state.documents_path, &stored_name)?;
    let removed = state
        .documents_path
        .join(format!(".{stored_name}.deleting"));

    if original.exists() {
        fs::rename(&original, &removed)
            .map_err(|error| format!("No se pudo preparar el archivo para eliminarlo: {error}"))?;
    }
    let transaction = connection.transaction().map_err(database_error)?;
    if let Err(error) = transaction.execute("DELETE FROM documents WHERE id = ?1", [id]) {
        if removed.exists() {
            let _ = fs::rename(&removed, &original);
        }
        return Err(database_error(error));
    }
    if let Err(error) = transaction.commit() {
        if removed.exists() {
            let _ = fs::rename(&removed, &original);
        }
        return Err(database_error(error));
    }
    if removed.exists() {
        fs::remove_file(&removed).map_err(|error| {
            format!("El registro se eliminó, pero no se pudo limpiar el archivo físico: {error}")
        })?;
    }
    Ok(())
}

#[derive(Debug)]
struct ValidatedDocument<'a> {
    display_name: String,
    extension: &'a str,
    mime_type: &'a str,
    size_bytes: u64,
}

fn validate_source_document(path: &Path) -> Result<ValidatedDocument<'static>, String> {
    if !path.is_absolute() {
        return Err("Selecciona un archivo válido.".to_owned());
    }
    let metadata = fs::metadata(path)
        .map_err(|_| "El archivo seleccionado ya no existe o no se puede leer.".to_owned())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Selecciona un archivo que no esté vacío.".to_owned());
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("El archivo supera el máximo permitido de 25 MB.".to_owned());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "El archivo no tiene una extensión permitida.".to_owned())?;
    let (extension, mime_type) = supported_type(&extension).ok_or_else(|| {
        "Tipo no permitido. Usa PDF, imágenes, texto, CSV, Word o Excel.".to_owned()
    })?;
    validate_file_signature(path, extension)?;
    let display_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "El nombre del archivo no es válido.".to_owned())?;
    let display_name = validate_display_name(display_name, extension)?;
    Ok(ValidatedDocument {
        display_name,
        extension,
        mime_type,
        size_bytes: metadata.len(),
    })
}

fn supported_type(extension: &str) -> Option<(&'static str, &'static str)> {
    match extension {
        "pdf" => Some(("pdf", "application/pdf")),
        "png" => Some(("png", "image/png")),
        "jpg" | "jpeg" => Some((extension_to_static(extension), "image/jpeg")),
        "webp" => Some(("webp", "image/webp")),
        "txt" => Some(("txt", "text/plain")),
        "csv" => Some(("csv", "text/csv")),
        "docx" => Some((
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )),
        "xlsx" => Some((
            "xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )),
        _ => None,
    }
}

fn extension_to_static(extension: &str) -> &'static str {
    if extension == "jpeg" {
        "jpeg"
    } else {
        "jpg"
    }
}

fn validate_file_signature(path: &Path, extension: &str) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("No se pudo leer el archivo: {error}"))?;
    let mut header = [0_u8; 512];
    let read = file
        .read(&mut header)
        .map_err(|error| format!("No se pudo validar el archivo: {error}"))?;
    let bytes = &header[..read];
    let valid = match extension {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "docx" | "xlsx" => bytes.starts_with(b"PK\x03\x04"),
        "txt" | "csv" => std::str::from_utf8(bytes).is_ok(),
        _ => false,
    };
    if !valid {
        return Err("El contenido del archivo no coincide con su extensión.".to_owned());
    }
    Ok(())
}

fn validate_display_name(value: &str, extension: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 180 {
        return Err("El nombre debe tener entre 1 y 180 caracteres.".to_owned());
    }
    if value.contains(['/', '\\']) || value == "." || value == ".." {
        return Err("El nombre contiene caracteres no permitidos.".to_owned());
    }
    let actual_extension = Path::new(value)
        .extension()
        .and_then(|item| item.to_str())
        .map(str::to_ascii_lowercase);
    if actual_extension.as_deref() != Some(extension) {
        return Err(format!("Conserva la extensión .{extension} en el nombre."));
    }
    Ok(value.to_owned())
}

fn validate_folder_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 100 {
        return Err("El nombre de la carpeta debe tener entre 1 y 100 caracteres.".to_owned());
    }
    if value.contains(['/', '\\']) || value == "." || value == ".." {
        return Err("El nombre de la carpeta contiene caracteres no permitidos.".to_owned());
    }
    Ok(value.to_owned())
}

fn validate_folder_exists(connection: &Connection, id: Option<i64>) -> Result<(), String> {
    if let Some(id) = id {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM document_folders WHERE id = ?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !exists {
            return Err("La carpeta seleccionada ya no existe.".to_owned());
        }
    }
    Ok(())
}

fn validate_client_exists(connection: &Connection, id: Option<i64>) -> Result<(), String> {
    if let Some(id) = id {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM clients WHERE id = ?1 AND is_archived = 0)",
                [id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !exists {
            return Err("El cliente seleccionado no existe o está archivado.".to_owned());
        }
    }
    Ok(())
}

fn query_folder(connection: &Connection, id: i64) -> Result<DocumentFolder, String> {
    connection
        .query_row(
            "SELECT id, parent_id, name, created_at, updated_at
             FROM document_folders WHERE id = ?1",
            [id],
            |row| {
                Ok(DocumentFolder {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .map_err(|_| "La carpeta ya no existe.".to_owned())
}

fn query_document(connection: &Connection, id: i64) -> Result<DocumentRecord, String> {
    connection
        .query_row(
            "SELECT document.id, document.folder_id, folder.name,
                    document.client_id, client.name, document.display_name,
                    document.extension, document.mime_type, document.size_bytes,
                    document.created_at, document.updated_at
             FROM documents document
             LEFT JOIN document_folders folder ON folder.id = document.folder_id
             LEFT JOIN clients client ON client.id = document.client_id
             WHERE document.id = ?1",
            [id],
            document_from_row,
        )
        .map_err(|_| "El archivo ya no existe.".to_owned())
}

fn document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentRecord> {
    Ok(DocumentRecord {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        folder_name: row.get(2)?,
        client_id: row.get(3)?,
        client_name: row.get(4)?,
        display_name: row.get(5)?,
        extension: row.get(6)?,
        mime_type: row.get(7)?,
        size_bytes: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn query_stored_name(connection: &Connection, id: i64) -> Result<String, String> {
    connection
        .query_row(
            "SELECT stored_name FROM documents WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or_else(|| "El archivo ya no existe.".to_owned())
}

fn stored_document_path(directory: &Path, stored_name: &str) -> Result<PathBuf, String> {
    if Path::new(stored_name).components().count() != 1
        || !matches!(
            Path::new(stored_name).components().next(),
            Some(Component::Normal(_))
        )
    {
        return Err("El registro contiene una ruta interna inválida.".to_owned());
    }
    Ok(directory.join(stored_name))
}

fn generate_stored_name(directory: &Path, extension: &str) -> String {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    for attempt in 0..1000_u16 {
        let candidate = format!(
            "document-{}-{seed}-{attempt}.{extension}",
            std::process::id()
        );
        if !directory.join(&candidate).exists() {
            return candidate;
        }
    }
    format!(
        "document-{}-{seed}-fallback.{extension}",
        std::process::id()
    )
}

fn folder_write_error(error: rusqlite::Error) -> String {
    if error.sqlite_error_code() == Some(ErrorCode::ConstraintViolation) {
        "Ya existe una carpeta con ese nombre en esta ubicación.".to_owned()
    } else {
        database_error(error)
    }
}

fn database_error(error: rusqlite::Error) -> String {
    format!("No se pudo actualizar el archivo local: {error}")
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
    use std::sync::Mutex;

    #[test]
    fn completes_folder_and_document_lifecycle() {
        let test_directory = temporary_directory("lifecycle");
        let database_path = test_directory.join("local-crm.sqlite3");
        let documents_path = test_directory.join("documents");
        let source_path = test_directory.join("contrato-ficticio.pdf");
        fs::create_dir_all(&documents_path).expect("documents directory should be created");
        fs::write(&source_path, b"%PDF-1.7\ncontenido ficticio")
            .expect("source fixture should be written");
        let connection = initialize_database(&database_path).expect("database should initialize");
        let state = DatabaseState {
            connection: Mutex::new(connection),
            database_path: database_path.clone(),
            documents_path: documents_path.clone(),
        };

        let contracts = create_document_folder_inner(&state, None, "Contratos".to_owned())
            .expect("root folder should be created");
        let signed =
            create_document_folder_inner(&state, Some(contracts.id), "Firmados".to_owned())
                .expect("child folder should be created");
        assert!(delete_document_folder_inner(&state, contracts.id).is_err());
        let signed = update_document_folder_inner(&state, signed.id, "Revisados".to_owned(), None)
            .expect("folder should be renamed and moved");

        let imported = import_document_inner(
            &state,
            ImportDocumentInput {
                source_path: source_path.to_string_lossy().into_owned(),
                folder_id: Some(contracts.id),
                client_id: None,
            },
        )
        .expect("document should be imported");
        let stored_name: String = state
            .connection
            .lock()
            .expect("database lock should work")
            .query_row(
                "SELECT stored_name FROM documents WHERE id = ?1",
                [imported.id],
                |row| row.get(0),
            )
            .expect("stored name should exist");
        assert!(documents_path.join(&stored_name).is_file());

        let updated = update_document_inner(
            &state,
            imported.id,
            UpdateDocumentInput {
                display_name: "contrato-ficticio-editado.pdf".to_owned(),
                folder_id: Some(signed.id),
                client_id: None,
            },
        )
        .expect("document should be renamed and moved");
        assert_eq!(updated.display_name, "contrato-ficticio-editado.pdf");
        assert_eq!(updated.folder_id, Some(signed.id));

        let exported_path = test_directory.join("copia-exportada.pdf");
        export_document_inner(
            &state,
            imported.id,
            exported_path.to_string_lossy().into_owned(),
        )
        .expect("document should be exported");
        assert_eq!(
            fs::read(&exported_path).expect("exported document should be readable"),
            fs::read(&source_path).expect("source fixture should be readable")
        );

        delete_document_inner(&state, imported.id).expect("document should be deleted");
        assert!(!documents_path.join(stored_name).exists());
        delete_document_folder_inner(&state, contracts.id)
            .expect("empty root folder should be deleted");
        delete_document_folder_inner(&state, signed.id)
            .expect("empty moved folder should be deleted");

        drop(state);
        fs::remove_dir_all(test_directory).expect("test directory should be removable");
    }

    #[test]
    fn accepts_supported_document_signatures() {
        let path = temporary_path("fixture.pdf");
        fs::write(&path, b"%PDF-1.7\ncontenido ficticio").expect("fixture should be written");

        let validated = validate_source_document(&path).expect("PDF should be valid");

        assert_eq!(validated.extension, "pdf");
        assert_eq!(validated.mime_type, "application/pdf");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_an_executable_even_if_it_has_an_allowed_extension() {
        let path = temporary_path("fixture.pdf");
        fs::write(&path, b"MZ executable fixture").expect("fixture should be written");

        let error = validate_source_document(&path).expect_err("invalid signature should fail");

        assert!(error.contains("no coincide"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_path_separators_in_visible_names() {
        assert!(validate_display_name("../contrato.pdf", "pdf").is_err());
        assert!(validate_folder_name("clientes/privados").is_err());
    }

    fn temporary_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("local-crm-{}-{unique}-{name}", std::process::id()))
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("local-crm-{label}-{}-{unique}", std::process::id()))
    }
}
