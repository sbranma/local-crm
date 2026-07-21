import { useEffect, useMemo, useState } from "react";
import type { QuoteStatus } from "../quotes/quote.types";
import { UiIcon } from "../../components/UiIcon";
import { getDashboardSummary } from "./dashboard.api";
import type {
  DashboardAlert,
  DashboardQuoteStatus,
  DashboardScheduleItem,
  DashboardSummary,
} from "./dashboard.types";

export type DashboardDestination =
  | "Clientes"
  | "Tareas"
  | "Agenda"
  | "Cotizaciones"
  | "Inventario"
  | "Configuración";

type DashboardPageProps = {
  onNavigate: (destination: DashboardDestination) => void;
};

const quoteStatusLabels: Record<QuoteStatus, string> = {
  draft: "Borradores",
  sent: "Enviadas",
  accepted: "Aceptadas",
  rejected: "Rechazadas",
  expired: "Vencidas",
};

const quoteStatusOrder: QuoteStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
];

const itemTypeLabels: Record<DashboardScheduleItem["itemType"], string> = {
  task: "Tarea",
  appointment: "Cita",
  meeting: "Reunión",
  call: "Llamada",
  reminder: "Recordatorio",
  other: "Evento",
};

const priorityLabels: Record<NonNullable<DashboardScheduleItem["priority"]>, string> = {
  low: "Prioridad baja",
  normal: "Prioridad normal",
  high: "Prioridad alta",
};

const fullDateFormatter = new Intl.DateTimeFormat("es-CR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("es-CR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("es-CR", {
  hour: "numeric",
  minute: "2-digit",
});

const clientDateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    let isCurrent = true;

    async function loadSummary() {
      setIsLoading(true);
      setPageError(null);
      try {
        const storedSummary = await getDashboardSummary(dashboardRange(new Date()));
        if (isCurrent) setSummary(storedSummary);
      } catch (error: unknown) {
        if (isCurrent) {
          setPageError(getErrorMessage(error, "No se pudo cargar el resumen del negocio."));
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadSummary();
    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  const quoteStatuses = useMemo(
    () => completeQuoteStatuses(summary?.quoteStatuses ?? []),
    [summary],
  );
  const sentQuotes = quoteStatuses.find((item) => item.status === "sent") as DashboardQuoteStatus;
  const acceptedQuotes = quoteStatuses.find(
    (item) => item.status === "accepted",
  ) as DashboardQuoteStatus;
  const totalQuotes = quoteStatuses.reduce((total, item) => total + item.count, 0);
  const nextItem = summary?.upcomingItems.find(
    (item) => new Date(item.startsAt).getTime() >= Date.now(),
  );

  return (
    <section className="dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">{greeting(today)}</p>
          <h1>{summary?.businessName ?? "Dashboard"}</h1>
          <p className="page-description">{capitalize(fullDateFormatter.format(today))}</p>
        </div>
        <button
          className="local-badge local-badge-button"
          type="button"
          onClick={() => onNavigate("Configuración")}
        >
          Datos locales
        </button>
      </header>

      <nav className="dashboard-shortcuts" aria-label="Accesos rápidos">
        <span>Ir directamente a</span>
        <button type="button" onClick={() => onNavigate("Clientes")}>Clientes</button>
        <button type="button" onClick={() => onNavigate("Tareas")}>Tareas</button>
        <button type="button" onClick={() => onNavigate("Agenda")}>Agenda</button>
        <button type="button" onClick={() => onNavigate("Cotizaciones")}>Cotizaciones</button>
      </nav>

      {pageError && (
        <div className="feedback-banner error dashboard-error" role="alert">
          <span>{pageError}</span>
          <button className="text-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            Reintentar
          </button>
        </div>
      )}

      {isLoading && <div className="loading-state">Preparando el resumen del negocio...</div>}

      {!isLoading && summary && (
        <>
          {(!summary.businessName || summary.activeClientCount === 0 || totalQuotes === 0) && (
            <section className="dashboard-onboarding" aria-labelledby="onboarding-title">
              <div className="onboarding-intro">
                <p className="eyebrow">Primeros pasos</p>
                <h2 id="onboarding-title">Deja tu CRM listo para trabajar</h2>
                <p>Completa esta base una sola vez y el resto del flujo será mucho más rápido.</p>
              </div>
              <div className="onboarding-steps">
                <OnboardingStep complete={Boolean(summary.businessName)} label="Configura tu negocio" onClick={() => onNavigate("Configuración")} />
                <OnboardingStep complete={summary.activeClientCount > 0} label="Agrega un cliente" onClick={() => onNavigate("Clientes")} />
                <OnboardingStep complete={totalQuotes > 0} label="Crea tu primera cotización" onClick={() => onNavigate("Cotizaciones")} />
              </div>
            </section>
          )}
          <section className="dashboard-metrics" aria-label="Indicadores principales">
            <MetricCard
              label="Tareas abiertas"
              value={summary.openTaskCount}
              hint={summary.overdueTaskCount > 0 ? `${summary.overdueTaskCount} vencidas` : "Sin tareas vencidas"}
              tone={summary.overdueTaskCount > 0 ? "danger" : "normal"}
              onClick={() => onNavigate("Tareas")}
            />
            <MetricCard
              label="Agenda de hoy"
              value={summary.todayItemCount}
              hint={nextItem ? `Próximo: ${scheduleTime(nextItem)}` : "Sin próximos compromisos"}
              onClick={() => onNavigate("Agenda")}
            />
            <MetricCard
              label="Cotizaciones enviadas"
              value={sentQuotes.count}
              hint={formatMoney(sentQuotes.totalMinor, summary.currency)}
              onClick={() => onNavigate("Cotizaciones")}
            />
            <MetricCard
              label="Productos con bajo stock"
              value={summary.lowStockCount}
              hint={summary.lowStockCount > 0 ? "Requieren revisión" : "Existencias bajo control"}
              tone={summary.lowStockCount > 0 ? "warning" : "normal"}
              onClick={() => onNavigate("Inventario")}
            />
          </section>

          <section className="dashboard-workspace">
            <DashboardPanel
              className="dashboard-upcoming-panel"
              eyebrow="Planificación"
              title="Hoy y próximos 7 días"
              actionLabel="Abrir Agenda"
              onAction={() => onNavigate("Agenda")}
            >
              {summary.upcomingItems.length === 0 ? (
                <PanelEmpty title="Sin compromisos próximos" message="La agenda está libre durante los próximos días." />
              ) : (
                <div className="dashboard-list">
                  {summary.upcomingItems.map((item) => (
                    <button
                      className="dashboard-list-row schedule-row"
                      type="button"
                      onClick={() => onNavigate(item.source === "task" ? "Tareas" : "Agenda")}
                      key={`${item.source}-${item.recordId}`}
                    >
                      <span className={`dashboard-item-mark ${item.source}`} aria-hidden="true" />
                      <span className="dashboard-row-main">
                        <strong>{item.title}</strong>
                        <small>{item.clientName ?? "Sin cliente"}</small>
                      </span>
                      <span className="dashboard-row-meta">
                        <strong>{formatScheduleDate(item)}</strong>
                        <small>{itemTypeLabels[item.itemType]}{item.priority ? ` · ${priorityLabels[item.priority]}` : ""}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel
              className="dashboard-alerts-panel"
              eyebrow="Prioridades"
              title="Requiere atención"
            >
              {summary.alerts.length === 0 ? (
                <PanelEmpty title="Todo está bajo control" message="No hay tareas vencidas, cotizaciones vencidas ni productos con bajo stock." positive />
              ) : (
                <div className="dashboard-alert-list">
                  {summary.alerts.map((alert) => (
                    <button
                      className={`dashboard-alert ${alert.alertType}`}
                      type="button"
                      onClick={() => onNavigate(alertDestination(alert))}
                      key={`${alert.alertType}-${alert.recordId}`}
                    >
                      <span className="dashboard-alert-symbol" aria-hidden="true">!</span>
                      <span>
                        <strong>{alertTitle(alert)}</strong>
                        <small>{alertDetail(alert)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel
              className="dashboard-commercial-panel"
              eyebrow="Cotizaciones"
              title="Estado comercial"
              actionLabel="Ver historial"
              onAction={() => onNavigate("Cotizaciones")}
            >
              <div className="dashboard-quote-statuses">
                {quoteStatuses.map((item) => (
                  <button type="button" onClick={() => onNavigate("Cotizaciones")} key={item.status}>
                    <span className={`quote-status-dot ${item.status}`} aria-hidden="true" />
                    <span>{quoteStatusLabels[item.status]}</span>
                    <strong>{item.count}</strong>
                    <small>{formatMoney(item.totalMinor, summary.currency)}</small>
                  </button>
                ))}
              </div>
              <div className="dashboard-commercial-note">
                <span>Valor cotizado aceptado</span>
                <strong>{formatMoney(acceptedQuotes.totalMinor, summary.currency)}</strong>
                <small>No representa pagos ni ingresos recibidos.</small>
              </div>
            </DashboardPanel>

            <DashboardPanel
              className="dashboard-clients-panel"
              eyebrow={`${summary.activeClientCount} clientes activos`}
              title="Clientes recientes"
              actionLabel="Ver clientes"
              onAction={() => onNavigate("Clientes")}
            >
              {summary.recentClients.length === 0 ? (
                <PanelEmpty title="Todavía no hay clientes" message="Agrega el primero desde el módulo de Clientes." />
              ) : (
                <div className="dashboard-client-list">
                  {summary.recentClients.map((client) => (
                    <button type="button" onClick={() => onNavigate("Clientes")} key={client.id}>
                      <span className="dashboard-client-avatar" aria-hidden="true">{clientInitials(client.name)}</span>
                      <span>
                        <strong>{client.name}</strong>
                        <small>{client.phone ?? client.email ?? "Sin contacto registrado"}</small>
                      </span>
                      <time dateTime={client.createdAt}>{formatClientDate(client.createdAt)}</time>
                    </button>
                  ))}
                </div>
              )}
            </DashboardPanel>
          </section>
        </>
      )}
    </section>
  );
}

function OnboardingStep({ complete, label, onClick }: { complete: boolean; label: string; onClick: () => void }) {
  return (
    <button className={complete ? "onboarding-step complete" : "onboarding-step"} type="button" onClick={onClick}>
      <span className="onboarding-step-icon" aria-hidden="true">{complete ? <UiIcon name="check" size={16} /> : null}</span>
      <span>{label}</span>
      <small>{complete ? "Listo" : "Completar"}</small>
    </button>
  );
}

function MetricCard({ label, value, hint, tone = "normal", onClick }: { label: string; value: number; hint: string; tone?: "normal" | "warning" | "danger"; onClick: () => void }) {
  return (
    <button className={`dashboard-metric-card ${tone}`} type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </button>
  );
}

function DashboardPanel({ eyebrow, title, actionLabel, onAction, className = "", children }: { eyebrow: string; title: string; actionLabel?: string; onAction?: () => void; className?: string; children: React.ReactNode }) {
  return (
    <section className={`dashboard-panel ${className}`.trim()}>
      <header>
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        {actionLabel && onAction && <button className="text-button" type="button" onClick={onAction}>{actionLabel}</button>}
      </header>
      {children}
    </section>
  );
}

function PanelEmpty({ title, message, positive = false }: { title: string; message: string; positive?: boolean }) {
  return <div className={`dashboard-panel-empty${positive ? " positive" : ""}`}><strong>{title}</strong><p>{message}</p></div>;
}

function completeQuoteStatuses(statuses: DashboardQuoteStatus[]): DashboardQuoteStatus[] {
  return quoteStatusOrder.map((status) =>
    statuses.find((item) => item.status === status) ?? { status, count: 0, totalMinor: 0 },
  );
}

function dashboardRange(now: Date) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = addDays(todayStart, 1);
  return {
    now: now.toISOString(),
    todayStart: todayStart.toISOString(),
    todayEnd: todayEnd.toISOString(),
    upcomingEnd: addDays(todayStart, 8).toISOString(),
  };
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function greeting(date: Date): string {
  if (date.getHours() < 12) return "Buenos días";
  if (date.getHours() < 18) return "Buenas tardes";
  return "Buenas noches";
}

function formatScheduleDate(item: DashboardScheduleItem): string {
  const date = new Date(item.startsAt);
  if (item.isAllDay) return capitalize(shortDateFormatter.format(date));
  return `${capitalize(shortDateFormatter.format(date))} · ${timeFormatter.format(date)}`;
}

function scheduleTime(item: DashboardScheduleItem): string {
  return item.isAllDay ? "todo el día" : timeFormatter.format(new Date(item.startsAt));
}

function alertDestination(alert: DashboardAlert): DashboardDestination {
  if (alert.alertType === "overdue_task") return "Tareas";
  if (alert.alertType === "expired_quote") return "Cotizaciones";
  return "Inventario";
}

function alertTitle(alert: DashboardAlert): string {
  if (alert.alertType === "overdue_task") return `Tarea vencida: ${alert.title}`;
  if (alert.alertType === "expired_quote") return `Cotización vencida: ${alert.title}`;
  return `Bajo stock: ${alert.title}`;
}

function alertDetail(alert: DashboardAlert): string {
  if (alert.alertType === "low_stock") {
    return `${formatQuantity(alert.currentStockMillis)} disponibles · mínimo ${formatQuantity(alert.minimumStockMillis)}`;
  }
  const context = alert.context ? `${alert.context} · ` : "";
  return `${context}${alert.dateValue ? formatAlertDate(alert.dateValue) : "Revisión pendiente"}`;
}

function formatAlertDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const localDate = new Date(year, month - 1, day);
    return Number.isNaN(localDate.getTime())
      ? value
      : capitalize(shortDateFormatter.format(localDate));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : capitalize(shortDateFormatter.format(date));
}

function formatClientDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : clientDateFormatter.format(date);
}

function formatQuantity(value: number | null): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format((value ?? 0) / 1_000);
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "CRC" ? 0 : 2,
    maximumFractionDigits: currency === "CRC" ? 0 : 2,
  }).format(minor / 100);
}

function clientInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "C";
}

function capitalize(value: string): string {
  return value ? value[0].toLocaleUpperCase("es") + value.slice(1) : value;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
