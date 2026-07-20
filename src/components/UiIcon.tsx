import type { ReactNode } from "react";

export type UiIconName =
  | "brand"
  | "dashboard"
  | "clients"
  | "tasks"
  | "calendar"
  | "quotes"
  | "inventory"
  | "files"
  | "settings"
  | "more"
  | "refresh"
  | "check";

type UiIconProps = {
  name: UiIconName;
  size?: number;
};

const paths: Record<UiIconName, ReactNode> = {
  brand: <><path fill="currentColor" stroke="none" d="M9 5.5h6v2H9zM5.5 9h2v6h-2zM16.5 9h2v6h-2zM9 16.5h6v2H9z" /><rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor" stroke="none" /><rect x="14" y="3" width="7" height="7" rx="2" fill="currentColor" stroke="none" /><rect x="3" y="14" width="7" height="7" rx="2" fill="currentColor" stroke="none" /><rect x="14" y="14" width="7" height="7" rx="2" fill="currentColor" stroke="none" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  tasks: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  quotes: <><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  inventory: <><path d="M21 8l-9 5-9-5 9-5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></>,
  files: <><path d="M3 7h7l2 2h9v11H3z" /><path d="M3 7V4h7l2 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.08a1.7 1.7 0 0 0-1.1-1.52 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.08A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.08A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.28.35.49.75.6 1 .1.32.1.66.1 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15z" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0 2 5" /><path d="M20 4v7h-7" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
};

export function UiIcon({ name, size = 20 }: UiIconProps) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
