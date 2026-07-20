import { invoke } from "@tauri-apps/api/core";
import type { BackupInfo, RestoreResult } from "./backup.types";

export function exportBackup(destinationPath: string): Promise<BackupInfo> {
  return invoke<BackupInfo>("export_backup", { destinationPath });
}

export function inspectBackup(sourcePath: string): Promise<BackupInfo> {
  return invoke<BackupInfo>("inspect_backup", { sourcePath });
}

export function restoreBackup(sourcePath: string): Promise<RestoreResult> {
  return invoke<RestoreResult>("restore_backup", {
    sourcePath,
    confirmed: true,
  });
}
