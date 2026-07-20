import { invoke } from "@tauri-apps/api/core";
import type { DashboardRangeInput, DashboardSummary } from "./dashboard.types";

export function getDashboardSummary(range: DashboardRangeInput): Promise<DashboardSummary> {
  return invoke<DashboardSummary>("get_dashboard_summary", { range });
}
