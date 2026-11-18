# Actualización 1.0.157 (gateway 1.0.53) — producción y Google Play

- "Nuevo mantenimiento" permite los cinco tipos: correctivo, detención, **preventivo, rutinario y checklist**.
  - Preventivo y rutinario usan los mismos datos que un correctivo, como en la web.
  - Checklist pide de 1 a 10 listas y un tipo de lista opcional (Rutinaria, Despacho, Devolución). Las listas quedan
    en el trabajo creado, sin responder.
- En un mantenimiento preventivo, la pestaña Trabajo muestra **"Pauta del equipo"**: se marcan ítems (o "Marcar
  faltantes" por grupo) y se agregan como trabajos con su repuesto. Solo con conexión.
- Servidor: un mantenimiento creado en la app con más trabajos se muestra en varias tarjetas; actividades, listas,
  archivos, equipo del trabajo, ubicación, eliminar, cronómetro, respuestas y entrega ya no responden "trabajo no
  encontrado" en ese caso.
- Servidor: se puede quitar de un trabajo a un responsable de toda la mantención; queda asignado a los demás trabajos.

## Notas de la versión para Google Play

<es-419>
Crea mantenimientos preventivos, rutinarios y de checklist desde la app.
En un preventivo, agrega los ítems de la pauta del equipo como trabajos.
Ahora puedes quitar a un técnico de un trabajo aunque sea responsable de toda la mantención.
</es-419>

## Orden para publicar

1. Respaldo de la base de producción (rutina habitual; esta versión no tiene migraciones).
2. Verificar que exista la columna `maintenances.checklistCategory` (migración `20261030120000-Add-ChecklistCategory-To-Maintenances`).
3. Desplegar el backend, que incluye la pasarela 1.0.53 (`infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.53.tgz`).
4. Revisar `https://api-qz-v2.qualitzer.com/mobile/health`.
5. Distribuir la APK 1.0.157 y subir `artifacts/play/qualitzer-operaciones-1.0.157.aab` a Play Console.

Si la APK llega antes que el servidor, los tipos nuevos y la pauta muestran un aviso pidiendo crearlos en la web; no se rompe nada.
