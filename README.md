# Local CRM

Aplicación de escritorio local para que pequeños negocios de servicios administren clientes, tareas y cotizaciones sin depender de un servidor externo para las funciones principales.

## Estado

El proyecto se encuentra en construcción. La base utiliza React, TypeScript, Vite, Tauri y SQLite. El módulo de Clientes permite crear, consultar, editar, buscar, archivar, restaurar y eliminar definitivamente registros archivados.

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
