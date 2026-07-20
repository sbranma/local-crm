import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ActionMenu } from "../../components/ActionMenu";
import { LoadErrorState } from "../../components/LoadErrorState";
import { ModalDialog } from "../../components/ModalDialog";
import { listClients } from "../clients/client.api";
import type { Client } from "../clients/client.types";
import {
  createDocumentFolder,
  deleteDocumentFolder,
  deleteStoredDocument,
  exportStoredDocument,
  importDocument,
  listDocumentFolders,
  listDocuments,
  openStoredDocument,
  updateDocumentFolder,
  updateDocument,
} from "./document.api";
import type { DocumentFolder, StoredDocument } from "./document.types";

type FileTypeFilter = "all" | "pdf" | "image" | "office" | "text";
type FolderFormMode = { type: "create" } | { type: "edit"; folder: DocumentFolder };
type PendingDelete =
  | { type: "document"; item: StoredDocument }
  | { type: "folder"; item: DocumentFolder };

const fileFilters = [
  { name: "Documentos admitidos", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "txt", "csv", "docx", "xlsx"] },
];

export function DocumentsPage() {
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>("all");
  const [folderMode, setFolderMode] = useState<FolderFormMode | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState<number | null>(null);
  const [editingDocument, setEditingDocument] = useState<StoredDocument | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentFolderId, setDocumentFolderId] = useState<number | null>(null);
  const [documentClientId, setDocumentClientId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, [reloadKey]);

  async function loadData() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [loadedFolders, loadedDocuments, loadedClients] = await Promise.all([
        listDocumentFolders(),
        listDocuments(),
        listClients(),
      ]);
      setFolders(loadedFolders);
      setDocuments(loadedDocuments);
      setClients(loadedClients.filter((client) => !client.isArchived));
    } catch (error: unknown) {
      setLoadError(getErrorMessage(error, "No se pudieron cargar los archivos."));
    } finally {
      setIsLoading(false);
    }
  }

  const currentFolders = useMemo(
    () => folders.filter((folder) => folder.parentId === currentFolderId),
    [folders, currentFolderId],
  );
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(folders, currentFolderId),
    [folders, currentFolderId],
  );
  const visibleDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es");
    return documents.filter((document) => {
      const inFolder = document.folderId === currentFolderId;
      const matchesSearch = !normalizedSearch
        || `${document.displayName} ${document.clientName ?? ""}`
          .toLocaleLowerCase("es")
          .includes(normalizedSearch);
      const matchesClient = clientFilter === "all"
        || (clientFilter === "none" ? document.clientId === null : document.clientId === Number(clientFilter));
      const matchesType = typeFilter === "all" || fileCategory(document.extension) === typeFilter;
      return inFolder && matchesSearch && matchesClient && matchesType;
    });
  }, [documents, currentFolderId, search, clientFilter, typeFilter]);

  function openCreateFolder() {
    setFolderName("");
    setFolderParentId(currentFolderId);
    setFolderMode({ type: "create" });
  }

  function openEditFolder(folder: DocumentFolder) {
    setFolderName(folder.name);
    setFolderParentId(folder.parentId);
    setFolderMode({ type: "edit", folder });
  }

  async function handleFolderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderMode) return;
    if (!folderName.trim()) {
      setPageError("Escribe un nombre para la carpeta.");
      return;
    }
    setIsWorking(true);
    setPageError(null);
    try {
      if (folderMode.type === "create") {
        await createDocumentFolder(folderParentId, folderName.trim());
        setSuccessMessage("Carpeta creada correctamente.");
      } else {
        await updateDocumentFolder(folderMode.folder.id, folderName.trim(), folderParentId);
        setSuccessMessage("Carpeta actualizada correctamente.");
      }
      setFolderMode(null);
      await loadData();
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar la carpeta."));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleImport() {
    const selected = await open({ multiple: true, directory: false, filters: fileFilters });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setIsWorking(true);
    setPageError(null);
    setSuccessMessage(null);
    let imported = 0;
    try {
      for (const sourcePath of paths) {
        await importDocument({ sourcePath, folderId: currentFolderId, clientId: null });
        imported += 1;
      }
      setSuccessMessage(`${imported} ${imported === 1 ? "archivo importado" : "archivos importados"} correctamente.`);
      await loadData();
    } catch (error: unknown) {
      const message = `${imported ? `${imported} archivo(s) sí se guardaron. ` : ""}${getErrorMessage(error, "No se pudo importar el archivo.")}`;
      await loadData();
      setPageError(message);
    } finally {
      setIsWorking(false);
    }
  }

  function openDocumentEditor(document: StoredDocument) {
    setEditingDocument(document);
    setDocumentName(document.displayName);
    setDocumentFolderId(document.folderId);
    setDocumentClientId(document.clientId);
  }

  async function handleDocumentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDocument) return;
    setIsWorking(true);
    setPageError(null);
    try {
      await updateDocument(editingDocument.id, {
        displayName: documentName.trim(),
        folderId: documentFolderId,
        clientId: documentClientId,
      });
      setEditingDocument(null);
      setSuccessMessage("Archivo actualizado correctamente.");
      await loadData();
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo actualizar el archivo."));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleOpen(document: StoredDocument) {
    setPageError(null);
    try {
      await openStoredDocument(document.id);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo abrir el archivo."));
    }
  }

  async function handleExport(document: StoredDocument) {
    const destinationPath = await save({ defaultPath: document.displayName });
    if (!destinationPath) return;
    setIsWorking(true);
    setPageError(null);
    try {
      await exportStoredDocument(document.id, destinationPath);
      setSuccessMessage("Copia exportada correctamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo exportar el archivo."));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!pendingDelete) return;
    setIsWorking(true);
    setPageError(null);
    try {
      if (pendingDelete.type === "document") {
        await deleteStoredDocument(pendingDelete.item.id);
        setSuccessMessage("Archivo eliminado definitivamente.");
      } else {
        await deleteDocumentFolder(pendingDelete.item.id);
        setSuccessMessage("Carpeta eliminada.");
      }
      setPendingDelete(null);
      await loadData();
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar el elemento."));
      setPendingDelete(null);
    } finally {
      setIsWorking(false);
    }
  }

  const totalSize = documents.reduce((total, document) => total + document.sizeBytes, 0);
  const unavailableFolderIds = folderMode?.type === "edit"
    ? descendantFolderIds(folders, folderMode.folder.id)
    : new Set<number>();

  return (
    <section className="documents-page">
      <header className="page-header documents-header">
        <div>
          <p className="eyebrow">Documentación privada</p>
          <h1>Archivos</h1>
          <p className="page-description">Organiza contratos, comprobantes y documentos del negocio sin subirlos a internet.</p>
        </div>
        <div className="page-header-actions">
          <span className="local-storage-badge">Solo en este equipo</span>
          <button className="secondary-button" type="button" disabled={Boolean(loadError)} onClick={openCreateFolder}>Nueva carpeta</button>
          <button className="primary-button" type="button" disabled={isWorking || Boolean(loadError)} onClick={() => void handleImport()}>
            {isWorking ? "Procesando..." : "Importar archivos"}
          </button>
        </div>
      </header>

      {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}
      {successMessage && <div className="feedback-banner success" role="status">{successMessage}</div>}
      {loadError && <LoadErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!loadError && <section className="documents-summary" aria-label="Resumen de archivos">
        <div><span>Archivos guardados</span><strong>{documents.length}</strong></div>
        <div><span>Carpetas</span><strong>{folders.length}</strong></div>
        <div><span>Espacio utilizado</span><strong>{formatFileSize(totalSize)}</strong></div>
      </section>}

      {!loadError && <nav className="documents-breadcrumbs" aria-label="Ruta actual">
        <button type="button" className={currentFolderId === null ? "active" : undefined} onClick={() => setCurrentFolderId(null)}>Archivos</button>
        {breadcrumbs.map((folder) => (
          <span key={folder.id}>
            <span aria-hidden="true">/</span>
            <button type="button" className={folder.id === currentFolderId ? "active" : undefined} onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button>
          </span>
        ))}
      </nav>}

      {!loadError && <section className="documents-toolbar" aria-label="Filtros de archivos">
        <label className="search-field"><span>Buscar</span><input type="search" placeholder="Nombre o cliente..." value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
        <label><span>Cliente</span><select value={clientFilter} onChange={(event) => setClientFilter(event.currentTarget.value)}><option value="all">Todos</option><option value="none">Sin cliente</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label>
        <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as FileTypeFilter)}><option value="all">Todos</option><option value="pdf">PDF</option><option value="image">Imágenes</option><option value="office">Word y Excel</option><option value="text">Texto y CSV</option></select></label>
        {(search || clientFilter !== "all" || typeFilter !== "all") && <button className="filter-reset-button" type="button" onClick={() => { setSearch(""); setClientFilter("all"); setTypeFilter("all"); }}>Limpiar filtros</button>}
      </section>}

      {isLoading && <div className="loading-state">Cargando archivos...</div>}

      {!isLoading && !loadError && currentFolders.length > 0 && (
        <section className="folder-grid" aria-label="Carpetas">
          {currentFolders.map((folder) => {
            const fileCount = documents.filter((document) => document.folderId === folder.id).length;
            return (
              <article className="folder-card" key={folder.id}>
                <button className="folder-open-button" type="button" onClick={() => setCurrentFolderId(folder.id)}>
                  <span className="folder-icon" aria-hidden="true">▰</span>
                  <span><strong>{folder.name}</strong><small>{fileCount} {fileCount === 1 ? "archivo" : "archivos"}</small></span>
                </button>
                <ActionMenu label={`Acciones de ${folder.name}`}><button type="button" onClick={() => openEditFolder(folder)}>Editar carpeta</button><button className="danger-text" type="button" onClick={() => setPendingDelete({ type: "folder", item: folder })}>Eliminar carpeta</button></ActionMenu>
              </article>
            );
          })}
        </section>
      )}

      {!isLoading && !loadError && currentFolders.length === 0 && visibleDocuments.length === 0 && (
        <section className="empty-state clients-empty-state documents-empty-state">
          <div className="empty-state-icon" aria-hidden="true">+</div>
          <p className="eyebrow">Carpeta vacía</p>
          <h2>Guarda tu primer documento</h2>
          <p>Admite PDF, PNG, JPG, WebP, TXT, CSV, DOCX y XLSX de hasta 25 MB.</p>
          <button className="primary-button" type="button" onClick={() => void handleImport()}>Importar archivo</button>
        </section>
      )}

      {!isLoading && !loadError && visibleDocuments.length > 0 && (
        <div className="clients-table-card documents-table-card">
          <table className="clients-table documents-table">
            <thead><tr><th>Archivo</th><th>Cliente</th><th>Tamaño</th><th>Actualizado</th><th className="actions-column">Acciones</th></tr></thead>
            <tbody>{visibleDocuments.map((document) => (
              <tr key={document.id}>
                <td><div className="document-name-cell"><span className={`document-type-icon ${fileCategory(document.extension)}`}>{document.extension.toUpperCase()}</span><div><strong className="client-name">{document.displayName}</strong><span className="client-secondary">{document.folderName ?? "Archivos"}</span></div></div></td>
                <td>{document.clientName ?? <span className="client-secondary">Sin cliente</span>}</td>
                <td>{formatFileSize(document.sizeBytes)}</td>
                <td>{dateFormatter.format(new Date(document.updatedAt))}</td>
                <td><div className="row-actions document-row-actions compact-row-actions"><button className="text-button" type="button" onClick={() => void handleOpen(document)}>Abrir</button><ActionMenu><button type="button" onClick={() => openDocumentEditor(document)}>Editar datos</button><button type="button" onClick={() => void handleExport(document)}>Exportar copia</button><button className="danger-text" type="button" onClick={() => setPendingDelete({ type: "document", item: document })}>Eliminar archivo</button></ActionMenu></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {folderMode && (
        <ModalDialog className="form-modal document-folder-modal" labelledBy="document-folder-title" onRequestClose={() => { if (!isWorking) setFolderMode(null); }}>
          <section className="client-form-card" aria-labelledby="document-folder-title">
            <div className="client-form-header"><div><p className="eyebrow">Organización</p><h2 id="document-folder-title">{folderMode.type === "create" ? "Nueva carpeta" : "Editar carpeta"}</h2></div><button className="secondary-button" type="button" onClick={() => setFolderMode(null)}>Cancelar</button></div>
            <form onSubmit={(event) => void handleFolderSubmit(event)}>
              <div className="client-form-grid">
                <label className="form-field"><span>Nombre <small>Obligatorio</small></span><input autoFocus maxLength={100} value={folderName} onChange={(event) => setFolderName(event.currentTarget.value)} /></label>
                <label className="form-field"><span>Ubicación</span><select value={folderParentId ?? "root"} onChange={(event) => setFolderParentId(event.currentTarget.value === "root" ? null : Number(event.currentTarget.value))}><option value="root">Archivos</option>{folders.filter((folder) => !unavailableFolderIds.has(folder.id) && folder.id !== (folderMode.type === "edit" ? folderMode.folder.id : -1)).map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folders, folder.id)}</option>)}</select></label>
              </div>
              <div className="client-form-actions"><button className="secondary-button" type="button" onClick={() => setFolderMode(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={isWorking}>{isWorking ? "Guardando..." : "Guardar carpeta"}</button></div>
            </form>
          </section>
        </ModalDialog>
      )}

      {editingDocument && (
        <ModalDialog className="form-modal document-edit-modal" labelledBy="document-edit-title" onRequestClose={() => { if (!isWorking) setEditingDocument(null); }}>
          <section className="client-form-card" aria-labelledby="document-edit-title">
            <div className="client-form-header"><div><p className="eyebrow">Metadatos</p><h2 id="document-edit-title">Editar archivo</h2></div><button className="secondary-button" type="button" onClick={() => setEditingDocument(null)}>Cancelar</button></div>
            <form onSubmit={(event) => void handleDocumentSubmit(event)}>
              <div className="client-form-grid">
                <label className="form-field form-field-wide"><span>Nombre <small>Conserva .{editingDocument.extension}</small></span><input autoFocus maxLength={180} value={documentName} onChange={(event) => setDocumentName(event.currentTarget.value)} /></label>
                <label className="form-field"><span>Carpeta</span><select value={documentFolderId ?? "root"} onChange={(event) => setDocumentFolderId(event.currentTarget.value === "root" ? null : Number(event.currentTarget.value))}><option value="root">Archivos</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folderPath(folders, folder.id)}</option>)}</select></label>
                <label className="form-field"><span>Cliente relacionado</span><select value={documentClientId ?? "none"} onChange={(event) => setDocumentClientId(event.currentTarget.value === "none" ? null : Number(event.currentTarget.value))}><option value="none">Sin cliente</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label>
              </div>
              <div className="client-form-actions"><button className="secondary-button" type="button" onClick={() => setEditingDocument(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={isWorking}>{isWorking ? "Guardando..." : "Guardar cambios"}</button></div>
            </form>
          </section>
        </ModalDialog>
      )}

      {pendingDelete && (
        <ModalDialog className="confirmation-modal" labelledBy="document-delete-title" onRequestClose={() => { if (!isWorking) setPendingDelete(null); }}>
          <section className="archive-confirmation" aria-labelledby="document-delete-title"><div><h2 id="document-delete-title">¿Eliminar “{pendingDelete.type === "folder" ? pendingDelete.item.name : pendingDelete.item.displayName}”?</h2><p>{pendingDelete.type === "folder" ? "Solo se eliminará si está completamente vacía." : "El archivo físico y su registro se eliminarán definitivamente."}</p></div><div className="confirmation-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>Cancelar</button><button className="danger-button" type="button" disabled={isWorking} onClick={() => void handleDeleteConfirmed()}>{isWorking ? "Eliminando..." : "Eliminar definitivamente"}</button></div></section>
        </ModalDialog>
      )}
    </section>
  );
}

const dateFormatter = new Intl.DateTimeFormat("es-CR", { dateStyle: "medium" });

function buildBreadcrumbs(folders: DocumentFolder[], id: number | null): DocumentFolder[] {
  const result: DocumentFolder[] = [];
  const visited = new Set<number>();
  let currentId = id;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = folders.find((item) => item.id === currentId);
    if (!folder) break;
    result.unshift(folder);
    currentId = folder.parentId;
  }
  return result;
}

function folderPath(folders: DocumentFolder[], id: number): string {
  return buildBreadcrumbs(folders, id).map((folder) => folder.name).join(" / ");
}

function descendantFolderIds(folders: DocumentFolder[], id: number): Set<number> {
  const ids = new Set<number>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

function fileCategory(extension: string): Exclude<FileTypeFilter, "all"> {
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (["docx", "xlsx"].includes(extension)) return "office";
  return "text";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
