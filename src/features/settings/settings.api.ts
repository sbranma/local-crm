import { invoke } from "@tauri-apps/api/core";
import type {
  BusinessSettings,
  BusinessSettingsInput,
} from "./settings.types";

export function getBusinessSettings(): Promise<BusinessSettings> {
  return invoke<BusinessSettings>("get_business_settings");
}

export function updateBusinessSettings(
  input: BusinessSettingsInput,
): Promise<BusinessSettings> {
  return invoke<BusinessSettings>("update_business_settings", { input });
}
