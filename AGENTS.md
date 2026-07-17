# Instrucciones para Codex

## Contexto obligatorio

Antes de proponer, planificar o implementar cualquier cambio, lee por completo `PROJECT_CONTEXT.md`. Ese archivo es la fuente principal de verdad para el objetivo, alcance, arquitectura y prioridades del producto.

Si una solicitud entra en conflicto con el contexto documentado, señala el conflicto y pide confirmación antes de cambiar el alcance, la arquitectura o el formato de los datos.

## Stack establecido

El stack propuesto es:

- React.
- TypeScript.
- Vite.
- Tauri.
- SQLite.

No sustituyas estas tecnologías ni agregues una alternativa equivalente sin justificar la necesidad, explicar las consecuencias y obtener aprobación explícita. Evita dependencias innecesarias.

## Principios de implementación

- Mantén las soluciones simples, mantenibles y fáciles de explicar en una entrevista.
- Implementa el cambio completo más pequeño que resuelva la tarea.
- Usa TypeScript en modo estricto.
- Evita `any`; si fuera inevitable, documenta el motivo y limita su alcance.
- Separa claramente la interfaz, la lógica de negocio y el acceso a datos.
- Evita que los componentes de React consulten SQLite directamente.
- Mantén las reglas de negocio fuera de los detalles visuales.
- Usa nombres consistentes, tipos explícitos y responsabilidades enfocadas.
- Valida la información antes de guardarla.
- Maneja errores esperados con mensajes útiles para usuarios no técnicos.
- No introduzcas abstracciones, módulos futuros ni refactorizaciones amplias sin una necesidad actual.
- Conserva compatibilidad con datos locales existentes cuando sea razonable.
- Mantén la documentación actualizada cuando cambien el comportamiento o las decisiones técnicas.

## Datos y seguridad

- Trata los datos de clientes y negocios como información privada.
- No uses ni agregues datos reales de clientes.
- No guardes contraseñas, tokens, credenciales, claves ni otros secretos en el repositorio.
- Usa datos ficticios claramente identificados en ejemplos y pruebas.
- Usa consultas u operaciones parametrizadas para SQLite.
- Valida archivos importados y respaldos antes de procesarlos.
- No sobrescribas datos locales mediante restauración sin una confirmación clara.
- No afirmes que existe una medida de seguridad hasta que esté implementada y verificada.

## Flujo de trabajo

Para cada tarea sustancial:

1. Lee `PROJECT_CONTEXT.md` y los documentos relacionados.
2. Inspecciona los archivos relevantes y respeta el trabajo existente.
3. Explica brevemente el cambio previsto y cualquier decisión importante.
4. Implementa solo el alcance solicitado.
5. Ejecuta las comprobaciones disponibles que correspondan: formato, lint, tipos, pruebas y construcción.
6. Revisa manualmente los flujos afectados cuando sea pertinente.
7. Reporta los archivos y comportamientos modificados.
8. Reporta exactamente qué pruebas o comprobaciones ejecutaste y sus resultados.
9. Informa limitaciones, riesgos o trabajo pendiente.

Nunca afirmes que una prueba o comprobación pasó si no fue ejecutada. Si no puedes ejecutarla, indícalo claramente junto con el motivo.

## Límites de alcance

El MVP se limita a Dashboard, Clientes, Tareas, Cotizaciones, Configuración del negocio y backups. No implementes módulos futuros descritos en `PROJECT_CONTEXT.md` salvo petición explícita.

No cambies silenciosamente requisitos establecidos. Consulta antes de realizar una decisión que altere el producto, el stack, la arquitectura general, la seguridad o el formato persistido de los datos.
