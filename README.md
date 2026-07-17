# Local CRM

Aplicación de escritorio local para que pequeños negocios administren clientes, tareas y cotizaciones sin depender de un servidor externo para las funciones principales.

## Estado

El proyecto se encuentra en construcción. La base utiliza React, TypeScript, Vite, Tauri y persistencia local con SQLite en una fase posterior.

## Desarrollo

Requisitos principales para Windows:

- Node.js LTS y npm.
- Rust con el toolchain estable MSVC.
- Microsoft C++ Build Tools con la carga de trabajo para escritorio.
- Microsoft Edge WebView2.

Comandos:

```powershell
npm.cmd install
npm.cmd run tauri dev
```

Comprobaciones disponibles:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Consulta `PROJECT_CONTEXT.md` para el alcance y las decisiones principales del producto, y `ROADMAP_CURSO.md` para el orden de implementación.
