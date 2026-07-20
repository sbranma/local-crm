export type DocumentFolder = {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredDocument = {
  id: number;
  folderId: number | null;
  folderName: string | null;
  clientId: number | null;
  clientName: string | null;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type ImportDocumentInput = {
  sourcePath: string;
  folderId: number | null;
  clientId: number | null;
};

export type UpdateDocumentInput = {
  displayName: string;
  folderId: number | null;
  clientId: number | null;
};
