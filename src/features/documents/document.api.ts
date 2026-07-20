import { invoke } from "@tauri-apps/api/core";
import type {
  DocumentFolder,
  ImportDocumentInput,
  StoredDocument,
  UpdateDocumentInput,
} from "./document.types";

export function listDocumentFolders(): Promise<DocumentFolder[]> {
  return invoke<DocumentFolder[]>("list_document_folders");
}

export function createDocumentFolder(
  parentId: number | null,
  name: string,
): Promise<DocumentFolder> {
  return invoke<DocumentFolder>("create_document_folder", { parentId, name });
}

export function updateDocumentFolder(
  id: number,
  name: string,
  parentId: number | null,
): Promise<DocumentFolder> {
  return invoke<DocumentFolder>("update_document_folder", { id, name, parentId });
}

export function deleteDocumentFolder(id: number): Promise<void> {
  return invoke<void>("delete_document_folder", { id });
}

export function listDocuments(): Promise<StoredDocument[]> {
  return invoke<StoredDocument[]>("list_documents");
}

export function importDocument(input: ImportDocumentInput): Promise<StoredDocument> {
  return invoke<StoredDocument>("import_document", { input });
}

export function updateDocument(
  id: number,
  input: UpdateDocumentInput,
): Promise<StoredDocument> {
  return invoke<StoredDocument>("update_document", { id, input });
}

export function openStoredDocument(id: number): Promise<void> {
  return invoke<void>("open_document", { id });
}

export function exportStoredDocument(id: number, destinationPath: string): Promise<void> {
  return invoke<void>("export_document", { id, destinationPath });
}

export function deleteStoredDocument(id: number): Promise<void> {
  return invoke<void>("delete_document", { id });
}
