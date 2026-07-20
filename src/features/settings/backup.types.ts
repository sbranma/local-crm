export type BackupInfo = {
  fileName: string;
  sizeBytes: number;
  schemaVersion: number;
  businessName: string | null;
  clientCount: number;
  taskCount: number;
  quoteCount: number;
  calendarEventCount: number;
  inventoryItemCount: number;
};

export type RestoreResult = {
  restoredBackup: BackupInfo;
  safetyBackupPath: string;
};

export type RestoreCandidate = {
  path: string;
  info: BackupInfo;
};
