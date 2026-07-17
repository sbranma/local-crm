import "./App.css";

const navigationItems = [
  "Dashboard",
  "Clientes",
  "Tareas",
  "Cotizaciones",
] as const;

function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            LC
          </span>
          <div>
            <strong>Local CRM</strong>
            <span>Gestión del negocio</span>
          </div>
        </div>

        <nav className="main-navigation" aria-label="Navegación principal">
          {navigationItems.map((item) => (
            <button
              className={item === "Dashboard" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={item === "Dashboard" ? "page" : undefined}
              key={item}
            >
              <span className="nav-indicator" aria-hidden="true" />
              {item}
            </button>
          ))}
        </nav>

        <button className="nav-item settings-link" type="button">
          <span className="nav-indicator" aria-hidden="true" />
          Configuración
        </button>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Vista general</p>
            <h1>Dashboard</h1>
            <p className="page-description">
              La información importante del negocio aparecerá aquí.
            </p>
          </div>
          <span className="local-badge">Datos locales</span>
        </header>

        <section className="summary-grid" aria-label="Resumen del negocio">
          <article className="summary-card">
            <span>Tareas pendientes</span>
            <strong>0</strong>
            <small>Sin tareas registradas</small>
          </article>
          <article className="summary-card">
            <span>Clientes</span>
            <strong>0</strong>
            <small>Sin clientes registrados</small>
          </article>
          <article className="summary-card">
            <span>Cotizaciones activas</span>
            <strong>0</strong>
            <small>Sin cotizaciones registradas</small>
          </article>
        </section>

        <section className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            +
          </div>
          <p className="eyebrow">Base preparada</p>
          <h2>Local CRM está listo para empezar</h2>
          <p>
            El primer flujo funcional será crear, consultar y editar clientes.
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
