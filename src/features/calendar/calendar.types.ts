export type CalendarEventType =
  | "appointment"
  | "meeting"
  | "call"
  | "reminder"
  | "other";

export type CalendarEventStatus = "scheduled" | "completed" | "cancelled";

export type CalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  clientId: number | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientIsArchived: boolean;
  eventType: CalendarEventType;
  status: CalendarEventStatus;
  startsAt: string;
  endsAt: string | null;
  isAllDay: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEventInput = {
  title: string;
  description: string | null;
  clientId: number | null;
  eventType: CalendarEventType;
  status: CalendarEventStatus;
  startsAt: string;
  endsAt: string | null;
  isAllDay: boolean;
};
