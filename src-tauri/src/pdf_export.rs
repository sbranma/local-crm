use std::{fs, path::Path};

const PDF_MAX_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub fn save_quote_pdf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let destination = Path::new(&path);
    let is_pdf = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));

    if !is_pdf {
        return Err("Selecciona un archivo con extensión .pdf.".to_owned());
    }

    if bytes.is_empty() || bytes.len() > PDF_MAX_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("El documento PDF generado no es válido.".to_owned());
    }

    fs::write(destination, bytes).map_err(|error| format!("No se pudo guardar el PDF: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_pdf_extension_case_insensitively() {
        assert!(Path::new("cotizacion.PDF")
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf")));
    }
}
