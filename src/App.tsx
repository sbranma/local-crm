import { useState } from "react";
import { UiIcon } from "./components/UiIcon";
import type { UiIconName } from "./components/UiIcon";
import { CalendarPage } from "./features/calendar/CalendarPage";
import { ClientsPage } from "./features/clients/ClientsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { DocumentsPage } from "./features/documents/DocumentsPage";
import { InventoryPage } from "./features/inventory/InventoryPage";
import { FirstRunTour } from "./features/onboarding/FirstRunTour";
import { QuotesPage } from "./features/quotes/QuotesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TasksPage } from "./features/tasks/TasksPage";
import "./App.css";

const navigationGroups = [
  { label: "General", items: [{ label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Operación",
    items: [
      { label: "Clientes", icon: "clients" },
      { label: "Tareas", icon: "tasks" },
      { label: "Agenda", icon: "calendar" },
    ],
  },
  {
    label: "Negocio",
    items: [
      { label: "Cotizaciones", icon: "quotes" },
      { label: "Inventario", icon: "inventory" },
      { label: "Archivos", icon: "files" },
    ],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  items: ReadonlyArray<{ label: string; icon: UiIconName }>;
}>;

export type AppSection = (typeof navigationGroups)[number]["items"][number]["label"] | "Configuración";

function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("Dashboard");
  const [dataRevision, setDataRevision] = useState(0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><UiIcon name="brand" size={21} /></span>
          <div>
            <strong>Local CRM</strong>
            <span>Gestión del negocio</span>
          </div>
        </div>

        <nav className="main-navigation" aria-label="Navegación principal">
          {navigationGroups.map((group) => (
            <div className="navigation-group" key={group.label}>
              <span className="navigation-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  className={item.label === activeSection ? "nav-item active" : "nav-item"}
                  type="button"
                  title={item.label}
                  aria-current={item.label === activeSection ? "page" : undefined}
                  onClick={() => setActiveSection(item.label)}
                  key={item.label}
                >
                  <UiIcon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button
          className={
            activeSection === "Configuración"
              ? "nav-item settings-link active"
              : "nav-item settings-link"
          }
          type="button"
          aria-current={activeSection === "Configuración" ? "page" : undefined}
          onClick={() => setActiveSection("Configuración")}
        >
          <UiIcon name="settings" />
          <span className="nav-label">Configuración</span>
        </button>
      </aside>

      <main className="main-content" key={dataRevision}>
        {activeSection === "Dashboard" && <DashboardPage onNavigate={setActiveSection} />}
        {activeSection === "Clientes" && <ClientsPage />}
        {activeSection === "Tareas" && <TasksPage />}
        {activeSection === "Agenda" && <CalendarPage />}
        {activeSection === "Cotizaciones" && <QuotesPage onNavigate={setActiveSection} />}
        {activeSection === "Inventario" && <InventoryPage />}
        {activeSection === "Archivos" && <DocumentsPage />}
        {activeSection === "Configuración" && <SettingsPage />}
      </main>
      <FirstRunTour
        onComplete={(demoDataCreated) => {
          setActiveSection("Dashboard");
          if (demoDataCreated) setDataRevision((revision) => revision + 1);
        }}
      />
    </div>
  );
}

export default App;
