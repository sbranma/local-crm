import { invoke } from "@tauri-apps/api/core";
import type { SystemInfo } from "./system.types";

export function getSystemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>("get_system_info");
}

export function openDataDirectory(): Promise<void> {
  return invoke<void>("open_data_directory");
}
