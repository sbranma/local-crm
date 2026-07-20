# Local CRM

Aplicación de escritorio local para que pequeños negocios administren clientes, tareas, agenda, cotizaciones e inventario básico sin depender de un servidor externo para las funciones principales.

## Estado

El proyecto se encuentra en construcción. La base utiliza React, TypeScript, Vite, Tauri y SQLite. El Dashboard reúne tareas vencidas, agenda próxima, alertas, actividad comercial y clientes recientes mediante consultas agregadas. El módulo de Clientes permite crear, consultar, editar, buscar, archivar, restaurar y eliminar definitivamente registros archivados. Tareas administra actividades internas o asociadas a clientes. Agenda combina esas tareas programadas con citas, reuniones, llamadas y recordatorios propios, sin duplicar los datos. Cotizaciones mantiene un historial por cliente, calcula importes con enteros, controla estados y genera documentos PDF con los datos y el logotipo configurados para el negocio. Inventario administra un catálogo de productos y servicios, precios, existencias y movimientos auditables, y permite reutilizar el catálogo al preparar cotizaciones.

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

Los datos, eventos y el logotipo se guardan en la base SQLite local de la aplicación. Los PDF y respaldos se generan sin conexión y el usuario elige su ubicación mediante un diálogo nativo de Windows.

## Datos y respaldos

La base activa se guarda en `%APPDATA%\com.localcrm.desktop\local-crm.sqlite3`. Desde **Configuración → Respaldos** se puede exportar toda la información a un archivo `.localcrm` y restaurarla posteriormente.

Antes de restaurar, la aplicación comprueba la firma SQLite, la versión del esquema, las tablas obligatorias, la integridad interna y las relaciones. También muestra un resumen del contenido y solicita confirmación explícita. Inmediatamente antes de reemplazar los datos crea `%APPDATA%\com.localcrm.desktop\local-crm-before-last-restore.localcrm` como copia automática del estado anterior.

Los archivos `.localcrm` son bases SQLite completas. Contienen información privada del negocio y actualmente **no están cifrados**, por lo que deben guardarse en una ubicación segura.

Consulta `PROJECT_CONTEXT.md` para el alcance y las decisiones principales del producto, y `ROADMAP_CURSO.md` para el orden de implementación.
