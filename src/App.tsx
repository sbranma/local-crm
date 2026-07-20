import { useState } from "react";
import { CalendarPage } from "./features/calendar/CalendarPage";
import { ClientsPage } from "./features/clients/ClientsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { InventoryPage } from "./features/inventory/InventoryPage";
import { QuotesPage } from "./features/quotes/QuotesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TasksPage } from "./features/tasks/TasksPage";
import "./App.css";

const navigationItems = ["Dashboard", "Clientes", "Tareas", "Agenda", "Cotizaciones", "Inventario"] as const;

type AppSection = (typeof navigationItems)[number] | "Configuración";

function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("Dashboard");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">LC</span>
          <div>
            <strong>Local CRM</strong>
            <span>Gestión del negocio</span>
          </div>
        </div>

        <nav className="main-navigation" aria-label="Navegación principal">
          {navigationItems.map((item) => (
            <button
              className={item === activeSection ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={item === activeSection ? "page" : undefined}
              onClick={() => setActiveSection(item)}
              key={item}
            >
              <span className="nav-indicator" aria-hidden="true" />
              {item}
            </button>
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
          <span className="nav-indicator" aria-hidden="true" />
          Configuración
        </button>
      </aside>

      <main className="main-content">
        {activeSection === "Dashboard" && <DashboardPage onNavigate={setActiveSection} />}
        {activeSection === "Clientes" && <ClientsPage />}
        {activeSection === "Tareas" && <TasksPage />}
        {activeSection === "Agenda" && <CalendarPage />}
        {activeSection === "Cotizaciones" && <QuotesPage />}
        {activeSection === "Inventario" && <InventoryPage />}
        {activeSection === "Configuración" && <SettingsPage />}
      </main>
    </div>
  );
}

export default App;
