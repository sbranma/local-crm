import type { QuoteStatus } from "../quotes/quote.types";

export type DashboardRangeInput = {
  now: string;
  todayStart: string;
  todayEnd: string;
  upcomingEnd: string;
};

export type DashboardScheduleItem = {
  source: "task" | "event";
  recordId: number;
  title: string;
  clientName: string | null;
  startsAt: string;
  isAllDay: boolean;
  itemType: "task" | "appointment" | "meeting" | "call" | "reminder" | "other";
  priority: "low" | "normal" | "high" | null;
};

export type DashboardAlert = {
  alertType: "overdue_task" | "expired_quote" | "low_stock";
  recordId: number;
  title: string;
  context: string | null;
  dateValue: string | null;
  currentStockMillis: number | null;
  minimumStockMillis: number | null;
};

export type DashboardQuoteStatus = {
  status: QuoteStatus;
  count: number;
  totalMinor: number;
};

export type DashboardRecentClient = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
};

export type DashboardSummary = {
  businessName: string | null;
  currency: string;
  activeClientCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  todayItemCount: number;
  lowStockCount: number;
  upcomingItems: DashboardScheduleItem[];
  alerts: DashboardAlert[];
  quoteStatuses: DashboardQuoteStatus[];
  recentClients: DashboardRecentClient[];
};
