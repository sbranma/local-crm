# Local CRM — Hoja de ruta de ejecución acelerada

## Propósito de esta ruta

Esta hoja de ruta organiza el desarrollo rápido de Local CRM con apoyo directo de Codex. La prioridad es entregar un MVP funcional, comprobado y mantenible. Las explicaciones detalladas se darán cuando el propietario las solicite o cuando una decisión necesite su criterio.

El propietario aporta el criterio del negocio, revisa los resultados y ayuda a pulir la lógica y la experiencia. Codex inspecciona el proyecto, propone el siguiente cambio concreto, implementa en los archivos compartidos, ejecuta las comprobaciones disponibles y documenta el resultado.

## Método de trabajo acelerado

Cada bloque de trabajo seguirá este ciclo:

1. **Objetivo:** acordar el resultado inmediato y los criterios importantes del negocio.
2. **Implementación:** Codex realiza el cambio completo más pequeño directamente en el repositorio.
3. **Comprobación:** ejecutar revisión visual, tipos, lint, pruebas o construcción, según corresponda.
4. **Revisión del propietario:** confirmar comportamiento, textos, reglas y experiencia de uso.
5. **Ajuste:** corregir o pulir lo detectado.
6. **Registro:** actualizar documentación y preparar un commit enfocado cuando el cambio esté listo.

No se requiere convertir cada bloque en una clase ni realizar ejercicios artificiales. Si algo no se entiende, se explica en ese momento con el nivel de detalle necesario. El avance depende de que el resultado funcione y cumpla el criterio acordado.

## División de responsabilidades

### Propietario del proyecto

- Define o valida las reglas del negocio.
- Revisa que los flujos tengan sentido para el usuario final.
- Decide cuando existan alternativas importantes de producto.
- Señala dudas o partes que desea comprender mejor.
- Aprueba cambios de alcance, arquitectura general o formato de datos.

### Codex

- Lee el contexto y revisa el trabajo existente antes de cambiarlo.
- Implementa directamente en los archivos compartidos.
- Mantiene los cambios pequeños, enfocados y compatibles con el alcance.
- Ejecuta y reporta comprobaciones reales.
- Explica decisiones importantes y cualquier riesgo o limitación.
- Mantiene la documentación sincronizada.

El propietario no necesita copiar y pegar código cuando Codex tiene acceso al repositorio. Solo se solicitarán acciones manuales cuando requieran una interfaz, permiso o decisión que Codex no pueda realizar de forma segura.

## Estrategia de construcción

Usaremos **rebanadas verticales**. Esto significa terminar una función pequeña atravesando las capas necesarias:

- interfaz;
- validación y reglas de negocio;
- acceso a datos;
- estados de éxito y error;
- pruebas relevantes.

Por ejemplo, en lugar de diseñar todas las pantallas y después toda la base de datos, completaremos primero el flujo mínimo de “crear y consultar un cliente”. Luego ampliaremos ese módulo de forma controlada.

## Fase 0 — Comprender el producto

### Objetivo

Entender el problema antes de escribir código.

### Temas

- Qué es un CRM y qué problema resuelve.
- Quién utilizará Local CRM.
- Diferencia entre MVP y funciones futuras.
- Qué significa que una aplicación sea local-first.
- Recorrido principal del usuario.
- Datos privados y responsabilidades básicas de seguridad.

### Resultado

- Contexto del proyecto revisado.
- Alcance del MVP expresado con claridad.
- Lista inicial de historias de usuario y criterios de aceptación.
- Glosario breve de conceptos del negocio.

### Criterio para avanzar

Puedes explicar en pocas palabras quién utilizará Local CRM, qué podrá hacer en el MVP y qué queda fuera.

## Fase 1 — Preparar el entorno y Git

### Objetivo

Instalar solamente lo necesario para crear, ejecutar y versionar el proyecto.

### Temas

- Terminal y estructura básica de carpetas.
- Git, repositorio local y GitHub.
- Commit, rama, historial y archivo `.gitignore`.
- Node.js y administración de paquetes.
- Rust y requisitos de Tauri para Windows.
- Diferencia entre React, TypeScript, Vite, Tauri y SQLite.
- Comandos de desarrollo, comprobación y construcción.

### Orden de trabajo

1. Comprobar qué herramientas ya están instaladas.
2. Instalar únicamente las que falten.
3. Inicializar Git.
4. Crear el proyecto con React, TypeScript y Vite.
5. Confirmar que la aplicación web de desarrollo funciona.
6. Integrar Tauri y confirmar que abre una ventana de escritorio.
7. Crear los primeros comandos documentados del proyecto.

Las versiones y los requisitos se verificarán en la documentación oficial cuando realicemos esta fase, en lugar de fijar instrucciones que puedan quedar obsoletas.

### Resultado

- Repositorio Git funcional.
- Proyecto base ejecutándose como aplicación de escritorio.
- TypeScript en modo estricto.
- Scripts de desarrollo y comprobación documentados.
- Primer commit técnico limpio.

### Criterio para avanzar

Puedes abrir el proyecto, ejecutar la aplicación, detenerla, revisar el estado de Git y explicar para qué sirve cada tecnología del stack.

## Fase 2 — Diseñar el esqueleto de la aplicación

### Objetivo

Crear una interfaz navegable sin implementar todavía las funciones completas.

### Temas

- Componentes de React.
- Props, estado y composición.
- HTML semántico y CSS.
- Navegación principal.
- Diseño adaptable al tamaño de la ventana.
- Accesibilidad: etiquetas, teclado, contraste y foco visible.
- Estados de carga, vacío, éxito y error.

### Construcción

- Estructura visual principal.
- Navegación para Dashboard, Clientes, Tareas, Cotizaciones y Configuración.
- Componentes visuales básicos reutilizables solo cuando exista una necesidad real.
- Pantallas vacías coherentes con el producto.
- Datos ficticios claramente identificados para validar el diseño.

### Resultado

Una aplicación navegable que comunica la estructura del MVP, aunque todavía no persista información.

### Criterio para avanzar

La navegación se entiende sin explicación técnica, funciona con teclado y se adapta razonablemente a distintos tamaños de ventana.

## Fase 3 — Arquitectura y persistencia local

### Objetivo

Preparar el camino seguro entre la interfaz, las reglas de negocio y SQLite.

### Temas

- Separación entre UI, aplicación/dominio e infraestructura.
- Tipos y contratos de TypeScript.
- Comandos controlados de Tauri.
- Tablas, claves e índices básicos de SQLite.
- Consultas parametrizadas.
- Migraciones versionadas.
- Validación antes de persistir.
- Errores técnicos frente a mensajes útiles para el usuario.

### Construcción

- Estructura mínima por responsabilidades.
- Inicialización de la base de datos.
- Primera migración versionada.
- Patrón sencillo de repositorio para evitar consultas SQLite desde React.
- Prueba de conexión mediante una operación pequeña y controlada.

### Resultado

La aplicación puede guardar y recuperar un dato de prueba mediante límites claros entre las capas.

### Criterio para avanzar

Puedes dibujar el recorrido de un dato desde un formulario hasta SQLite y explicar por qué React no consulta la base de datos directamente.

## Fase 4 — Módulo de Clientes

### Objetivo

Construir la primera función completa del producto y usarla como referencia para los demás módulos.

### Orden de implementación

1. Modelo y reglas mínimas de cliente.
2. Listado y estado vacío.
3. Crear un cliente.
4. Ver el detalle.
5. Editar un cliente.
6. Archivar y recuperar cuando corresponda.
7. Buscar y filtrar.
8. Manejar validaciones, errores y confirmaciones.
9. Probar reglas y recorridos importantes.

### Aprendizajes

- Formularios controlados.
- Validación y normalización.
- Operaciones CRUD.
- Consultas parametrizadas.
- Sincronización del estado de interfaz.
- Diseño de estados vacíos y errores.
- Pruebas de reglas de negocio.

### Resultado

Un usuario puede administrar clientes localmente de forma clara y confiable.

### Criterio para avanzar

El flujo completo funciona, los datos sobreviven al reinicio de la aplicación y los casos inválidos producen mensajes comprensibles.

## Fase 5 — Módulo de Tareas

### Objetivo

Administrar trabajo pendiente y relacionarlo opcionalmente con clientes.

### Construcción

- Crear y editar tareas.
- Estados pendiente y completada.
- Prioridad y fecha límite opcional.
- Asociación opcional con un cliente.
- Vistas o filtros útiles para pendientes y completadas.
- Manejo de fechas y casos límite.

### Aprendizajes

- Relaciones entre entidades.
- Estados y transiciones válidas.
- Fechas locales.
- Filtros combinados.
- Reutilización prudente de patrones del módulo de Clientes.

### Criterio para avanzar

Las tareas pueden administrarse sin inconsistencias y la relación con clientes no elimina ni altera datos accidentalmente.

## Fase 6 — Módulo de Cotizaciones

### Objetivo

Construir el módulo con mayor concentración de reglas de negocio del MVP.

### Construcción

- Crear una cotización para un cliente.
- Agregar, editar y eliminar conceptos.
- Manejar cantidades, precios e impuestos configurables.
- Calcular subtotal, impuestos y total.
- Estados: borrador, enviada, aceptada y rechazada.
- Vista presentable para compartir o imprimir.

### Aprendizajes

- Cálculos monetarios confiables.
- Entidades padre e hijos.
- Reglas centralizadas y comprobables.
- Transacciones de base de datos.
- Pruebas de cálculos y cambios de estado.
- Presentación impresa.

### Criterio para avanzar

Los totales son reproducibles, están probados y permanecen correctos al guardar y volver a abrir la cotización.

## Fase 7 — Dashboard y configuración

### Objetivo

Convertir los datos existentes en información útil y permitir configurar el negocio.

### Construcción

- Datos generales del negocio.
- Moneda e impuestos aplicables.
- Indicadores simples del Dashboard.
- Clientes recientes.
- Tareas pendientes.
- Cotizaciones agrupadas por estado.
- Accesos rápidos a acciones frecuentes.

### Aprendizajes

- Preferencias persistentes.
- Consultas de resumen.
- Derivación de datos.
- Jerarquía visual de información.
- Diferencia entre métricas útiles y adornos visuales.

### Criterio para avanzar

El Dashboard ayuda a decidir qué hacer a continuación y la configuración afecta correctamente los flujos correspondientes.

## Fase 8 — Backups, restauración y migraciones

### Objetivo

Dar al usuario control comprensible sobre sus datos locales.

### Construcción

- Crear un respaldo local.
- Documentar ubicación, contenido y versión del formato.
- Seleccionar e inspeccionar un respaldo.
- Validar antes de restaurar.
- Mostrar qué ocurrirá y pedir confirmación.
- Manejar archivos inválidos y versiones incompatibles.
- Restaurar sin dejar la aplicación en un estado parcial.

### Aprendizajes

- Operaciones de archivos mediante Tauri.
- Versionado de datos.
- Validación defensiva.
- Acciones destructivas y confirmaciones.
- Recuperación ante errores.
- Pruebas de integridad.

### Criterio para avanzar

Se puede respaldar, modificar y restaurar un conjunto de datos ficticios comprobando que la información recuperada coincide con la original.

## Fase 9 — Calidad, accesibilidad y entrega

### Objetivo

Preparar un MVP demostrable, instalable y defendible profesionalmente.

### Temas y tareas

- Revisión de recorridos completos.
- Lint, tipos, pruebas y construcción.
- Accesibilidad y navegación por teclado.
- Mensajes de error y casos vacíos.
- Rendimiento con volúmenes razonables de datos ficticios.
- Revisión de permisos de Tauri.
- Instalador para Windows.
- README orientado a usuarios y reclutadores.
- Capturas o demostración del producto.
- Decisiones técnicas y limitaciones conocidas.
- Guion breve para explicar el proyecto en una entrevista.

### Criterio de finalización del MVP

Un pequeño negocio puede instalar Local CRM, configurar sus datos, administrar clientes y tareas, crear cotizaciones y realizar o restaurar respaldos sin depender de un servidor externo.

## Orden resumido de entregas

1. Definición del producto.
2. Entorno, Git y aplicación base.
3. Esqueleto visual navegable.
4. Persistencia y arquitectura mínima.
5. Clientes.
6. Tareas.
7. Cotizaciones.
8. Dashboard y configuración.
9. Backups y restauración.
10. Calidad, instalador y presentación profesional.

## Reglas para no perdernos

- No comenzar varios módulos funcionales al mismo tiempo.
- No instalar una dependencia sin entender qué problema resuelve.
- No crear abstracciones para necesidades hipotéticas.
- No usar datos reales de clientes o negocios.
- No marcar una tarea como terminada sin comprobarla.
- No avanzar dejando errores de tipos, lint o construcción conocidos sin documentar.
- No cambiar el stack, la arquitectura general o el formato persistido sin discutirlo primero.
- Mantener cada cambio suficientemente pequeño para comprenderlo y explicarlo.

## Registro de progreso

Al iniciar cada fase se dividirá únicamente en bloques de implementación necesarios. Para cada bloque registraremos:

- objetivo;
- archivos modificados;
- comprobaciones ejecutadas;
- dudas pendientes;
- siguiente paso.

Esta hoja de ruta define la dirección general. No existe una cantidad fija de sesiones: avanzaremos por entregables funcionales y podremos completar varios bloques en una misma jornada.

## Próximo bloque recomendado

**Bloque 0 — Aterrizar el flujo principal del MVP**

Definiremos rápidamente cómo una persona utilizará Local CRM desde que abre la aplicación por primera vez hasta que crea su primera cotización. De ese recorrido saldrán las reglas que afectarán el modelo de datos y los criterios de aceptación iniciales.

Después realizaremos una **auditoría del entorno**, instalaremos únicamente lo que falte e inicializaremos la aplicación base.
