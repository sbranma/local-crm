import { invoke } from "@tauri-apps/api/core";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventStatus,
} from "./calendar.types";

export function createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  return invoke<CalendarEvent>("create_calendar_event", { input });
}

export function listCalendarEvents(): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>("list_calendar_events");
}

export function updateCalendarEvent(
  id: number,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  return invoke<CalendarEvent>("update_calendar_event", { id, input });
}

export function setCalendarEventStatus(
  id: number,
  status: CalendarEventStatus,
): Promise<CalendarEvent> {
  return invoke<CalendarEvent>("set_calendar_event_status", { id, status });
}

export function deleteCalendarEvent(id: number): Promise<void> {
  return invoke<void>("delete_calendar_event", { id });
}
