# Local CRM

Aplicación de escritorio local para que pequeños negocios administren clientes, tareas, agenda, cotizaciones, inventario básico y documentos sin depender de un servidor externo para las funciones principales.

## Estado

El proyecto se encuentra en construcción. La base utiliza React, TypeScript, Vite, Tauri y SQLite. El Dashboard reúne tareas vencidas, agenda próxima, alertas, actividad comercial y clientes recientes mediante consultas agregadas, y guía la configuración inicial con una lista de primeros pasos. El módulo de Clientes permite crear, consultar, editar, buscar, archivar, restaurar y eliminar definitivamente registros archivados. Tareas administra actividades internas o asociadas a clientes. Agenda combina esas tareas programadas con citas, reuniones, llamadas y recordatorios propios, sin duplicar los datos. Cotizaciones mantiene un historial por cliente, calcula importes con enteros, controla estados y genera documentos PDF con los datos y el logotipo configurados para el negocio. Inventario administra un catálogo de productos y servicios, precios, existencias y movimientos auditables, y permite reutilizar el catálogo al preparar cotizaciones. Archivos organiza documentos privados en carpetas, permite asociarlos con clientes y abrirlos o exportarlos desde la aplicación. La interfaz agrupa la navegación por contexto, adapta la barra lateral a ventanas angostas y separa claramente los estados vacíos de los errores de carga.

## Primera ejecución y demostración

Al abrir una instalación nueva, un recorrido de cuatro pasos explica el flujo principal, dónde se guardan los datos y cómo funcionan los respaldos. Si la base está completamente vacía, el usuario puede empezar desde cero o cargar un conjunto ficticio relacionado que incluye:

- Un negocio de demostración y tres clientes.
- Tres tareas y dos eventos próximos.
- Cuatro productos o servicios con movimientos de inventario.
- Una cotización enviada con conceptos del catálogo.

Los ejemplos están identificados mediante nombres y notas de demostración y utilizan correos `example.invalid`. La carga se realiza dentro de una transacción de SQLite y se rechaza si ya existe información, por lo que nunca mezcla ejemplos con datos del usuario. No se agregan archivos físicos de demostración.

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

Los datos, eventos, metadatos de archivos y el logotipo se guardan en la base SQLite local. Los documentos importados se copian a la carpeta privada de la aplicación. Los PDF y respaldos se generan sin conexión y el usuario elige su ubicación mediante un diálogo nativo de Windows.

## Datos y respaldos

La base activa se guarda en `%APPDATA%\com.localcrm.desktop\local-crm.sqlite3` y los documentos en `%APPDATA%\com.localcrm.desktop\documents`. Desde **Configuración → Respaldos** se puede exportar toda la información, incluidos esos documentos, a un único archivo `.localcrm` y restaurarla posteriormente.

Antes de restaurar, la aplicación comprueba la firma SQLite, la versión del esquema, las tablas obligatorias, la integridad interna y las relaciones. También muestra un resumen del contenido y solicita confirmación explícita. Inmediatamente antes de reemplazar los datos crea `%APPDATA%\com.localcrm.desktop\local-crm-before-last-restore.localcrm` como copia automática del estado anterior.

Los archivos `.localcrm` son bases SQLite completas que empaquetan temporalmente el contenido binario de los documentos junto con sus metadatos. Tanto la carpeta activa de documentos como los respaldos contienen información privada y actualmente **no están cifrados**, por lo que deben guardarse en una ubicación segura.

Consulta `PROJECT_CONTEXT.md` para el alcance y las decisiones principales del producto, y `ROADMAP_CURSO.md` para el orden de implementación.
