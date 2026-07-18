# Local CRM — Contexto del proyecto

## Resumen

Local CRM es una aplicación de escritorio modular para Windows, pensada para pequeños negocios que necesitan administrar su operación sin depender obligatoriamente de un servidor externo. Los datos deben permanecer bajo el control del usuario y guardarse localmente.

El proyecto también funciona como una pieza profesional de portafolio. Debe demostrar capacidad para analizar necesidades, diseñar una arquitectura mantenible, crear una interfaz clara, manejar datos locales de forma segura, documentar decisiones y entregar funciones verificadas.

## Objetivos del producto

- Ofrecer una herramienta sencilla para administrar clientes, trabajo pendiente y cotizaciones.
- Funcionar localmente, incluso sin conexión permanente a Internet.
- Evitar que un servidor o servicio externo sea obligatorio para usar las funciones principales.
- Mantener los datos del negocio bajo control del usuario.
- Permitir agregar módulos en el futuro sin rehacer el núcleo de la aplicación.
- Proporcionar respaldos y restauración de datos comprensibles para usuarios no técnicos.
- Mantener una experiencia profesional, limpia y fácil de aprender.
- Servir como implementación de referencia comprensible y extensible para desarrolladores que quieran estudiar o adaptar un CRM local.

## Usuarios previstos

Pequeños negocios de servicios y trabajadores independientes que necesitan organizar su operación desde una computadora con Windows. Algunos ejemplos son técnicos, contratistas, freelancers, consultores, pequeñas agencias y proveedores de servicios a domicilio o para eventos.

El usuario ideal trabaja solo o con un equipo reducido, maneja un volumen pequeño o mediano de clientes y cotizaciones, y no necesita sincronización obligatoria entre dispositivos. La interfaz debe asumir que el usuario no tiene conocimientos técnicos.

El MVP no pretende cubrir todavía negocios con inventario complejo, equipos distribuidos, múltiples sucursales, expedientes clínicos, operación de restaurantes o facturación fiscal especializada.

## Stack propuesto

- **React:** interfaz basada en componentes.
- **TypeScript:** tipado estricto y contratos claros.
- **Vite:** entorno de desarrollo y construcción del frontend.
- **Tauri:** empaquetado como aplicación de escritorio para Windows y acceso controlado a funciones nativas.
- **SQLite:** persistencia local estructurada.
- **Git y GitHub:** control de versiones, documentación y presentación pública del proyecto.

El stack no debe cambiarse sin explicar el problema que se intenta resolver, comparar alternativas y obtener aprobación explícita.

## Alcance del MVP

### Dashboard

- Resumen de información relevante.
- Indicadores simples, como tareas pendientes, clientes recientes y cotizaciones por estado.
- Accesos rápidos a las acciones frecuentes.

### Clientes

- Crear, consultar, editar y archivar clientes.
- Restaurar clientes archivados o eliminarlos definitivamente con confirmación explícita.
- Guardar información de contacto y notas necesarias para la operación.
- Buscar y filtrar registros.
- Validar la información antes de guardarla.

### Tareas

- Crear y organizar tareas relacionadas con la operación o con un cliente.
- Manejar estados pendiente, en progreso y completada.
- Manejar prioridad y fecha y hora programada cuando corresponda.
- Consultar tareas pendientes y completadas.
- Conservar una única fuente de datos para que una futura Agenda pueda consultar y actualizar las mismas tareas sin duplicarlas.

### Cotizaciones

- Crear cotizaciones asociadas a un cliente.
- Agregar conceptos, cantidades, precios e impuestos configurables.
- Calcular subtotales y totales de forma confiable.
- Manejar estados básicos, por ejemplo borrador, enviada, aceptada o rechazada.
- Preparar una salida presentable para compartir o imprimir.

### Configuración del negocio

- Datos generales del negocio usados en la aplicación y en documentos.
- Preferencias básicas, moneda e impuestos cuando corresponda.
- Configuración local comprensible y fácil de modificar.

### Backups

- Exportar un respaldo local de la información.
- Importar y restaurar un respaldo válido.
- Validar formato y versión antes de restaurar.
- Informar claramente qué ocurrirá antes de reemplazar datos.
- Documentar la ubicación y el formato de los datos locales.

## Fuera del alcance inicial

Los siguientes módulos son posibilidades futuras y no forman parte del MVP salvo solicitud explícita:

- Vehículos.
- Inventario.
- Productos.
- Agenda y calendario.
- Facturas.
- Reportes avanzados.
- Catálogo.
- Integraciones con correo electrónico.
- Integraciones con WhatsApp.
- Integraciones con APIs externas.
- Sincronización opcional en la nube o entre dispositivos.

## Principios de arquitectura

- Favorecer soluciones simples, mantenibles y fáciles de explicar.
- Separar la presentación, la lógica de negocio y el acceso a datos.
- Mantener los componentes de interfaz enfocados en una responsabilidad clara.
- Centralizar reglas de negocio importantes para evitar duplicación e inconsistencias.
- Encapsular el acceso a SQLite para que la interfaz no dependa directamente de consultas de base de datos.
- Usar contratos y tipos explícitos entre capas.
- Organizar los módulos por dominio funcional sin crear abstracciones prematuras.
- Mantener dependencias entre módulos claras y reducidas.
- Diseñar migraciones versionadas para cambios futuros de la base de datos.
- Preservar compatibilidad con los datos locales existentes siempre que sea razonable.
- Agregar dependencias solo cuando aporten valor claro y documentado.
- Mantener la documentación sincronizada con la implementación.

Una separación conceptual esperada es:

1. **UI:** pantallas, componentes, navegación y presentación de estados.
2. **Aplicación y dominio:** casos de uso, validaciones y reglas de negocio.
3. **Datos e infraestructura:** repositorios, SQLite, migraciones, backups e integración con Tauri.

Esta división es una guía, no una invitación a crear complejidad innecesaria.

## Datos, privacidad y seguridad

- Tratar toda información de clientes y negocios como privada.
- No incluir datos reales de clientes, contraseñas, tokens, credenciales ni secretos en el repositorio.
- Usar datos ficticios claramente identificados para demostraciones y pruebas.
- Usar variables de entorno o mecanismos seguros apropiados para cualquier secreto futuro.
- Validar y normalizar entradas antes de guardarlas.
- Usar operaciones parametrizadas para acceder a SQLite.
- Limitar los comandos nativos de Tauri a los permisos estrictamente necesarios.
- Validar archivos de respaldo antes de leerlos o restaurarlos.
- Evitar que una restauración sobrescriba datos sin confirmación clara.
- Manejar errores esperados con mensajes útiles que no expongan información sensible.
- Definir una estrategia de respaldo, restauración y migración antes de considerar el producto listo para uso real.
- No afirmar que la aplicación ofrece cifrado, autenticación o protección que aún no haya sido implementada y comprobada.

## Experiencia de usuario

- Diseñar para usuarios no técnicos.
- Usar lenguaje directo, acciones previsibles y estados visibles.
- Proporcionar confirmación para acciones destructivas.
- Mostrar validaciones cerca del dato que debe corregirse.
- Incluir estados de carga, vacío, éxito y error cuando sean relevantes.
- Mantener navegación, estilos y patrones de interacción consistentes.
- Procurar accesibilidad mediante contraste, foco visible, etiquetas y navegación por teclado.
- Adaptar la interfaz a distintos tamaños de ventana dentro de la aplicación de escritorio.

## Flujo de trabajo

El desarrollo debe avanzar en fases pequeñas. No se debe intentar construir toda la aplicación de una sola vez.

Para cada cambio sustancial:

1. Leer este archivo y la documentación relacionada.
2. Revisar la implementación existente antes de proponer cambios.
3. Confirmar el alcance y explicar las decisiones importantes.
4. Implementar la versión completa más pequeña que aporte valor.
5. Validar entradas, errores y estados relevantes.
6. Ejecutar las comprobaciones disponibles, como formato, lint, tipos, pruebas y construcción.
7. Revisar manualmente la función cuando corresponda.
8. Actualizar la documentación afectada.
9. Informar qué cambió, qué pruebas se ejecutaron y qué limitaciones quedan.

No se debe afirmar que una prueba pasó si no se ejecutó realmente. Si una comprobación no puede ejecutarse, debe indicarse el motivo.

## Control de alcance y decisiones

- Construir primero el MVP documentado.
- No agregar funciones futuras por anticipado sin una necesidad concreta.
- Registrar decisiones arquitectónicas importantes y sus consecuencias.
- Evitar refactorizaciones amplias no relacionadas con la tarea actual.
- Mantener cambios y commits enfocados en una sola intención lógica.
- Consultar antes de realizar cambios que afecten el producto, el stack o el formato de los datos.

## Calidad esperada

- TypeScript en modo estricto.
- Evitar `any`; cualquier excepción debe justificarse.
- Nombres coherentes y responsabilidades claras.
- Validación antes de persistir datos.
- Manejo explícito de errores esperados.
- Pruebas centradas en reglas de negocio y flujos importantes.
- Código entendible por un desarrollador junior que deba explicarlo en una entrevista.
- Comentarios solo cuando aclaren decisiones que el código no puede expresar por sí mismo.

## Objetivo profesional

El repositorio debe servir como evidencia de habilidades aplicables a puestos como:

- Junior Frontend Developer.
- Web Developer.
- Junior Full-Stack Developer, según avance el alcance.
- Implementation Specialist.
- Technical Support Engineer con enfoque en producto.

La presentación del proyecto debe permitir explicar con claridad:

- Qué problema resuelve el producto y para quién.
- Cómo se definió y controló el alcance del MVP.
- Por qué se eligió cada tecnología.
- Cómo se separan interfaz, reglas de negocio y persistencia.
- Cómo se protegen los datos locales y se gestionan los respaldos.
- Cómo se manejan validaciones, errores, pruebas y cambios de esquema.
- Qué decisiones se tomaron, qué alternativas se consideraron y qué mejoras quedan pendientes.

Usar asistencia de IA es compatible con este objetivo siempre que el propietario del proyecto comprenda la implementación, pueda explicar las decisiones, revise los resultados y sea capaz de mantener el código.

## Criterio general de éxito

El MVP tendrá éxito cuando un pequeño negocio pueda instalar la aplicación en Windows, configurar sus datos, administrar clientes y tareas, crear cotizaciones y realizar o restaurar respaldos de manera confiable, sin depender de un servidor externo para las funciones principales.
