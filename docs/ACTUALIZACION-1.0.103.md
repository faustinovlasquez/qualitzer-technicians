# Agenda sin descargas repetidas y filtro de estados: APK 1.0.103

Mantiene todo lo de la [actualizacion 1.0.102](ACTUALIZACION-1.0.102.md) y agrega:

- **La agenda no se vuelve a descargar entera.** Cada día guardado envía su huella; si el servidor confirma que no cambió se muestra la copia local. Solo se descargan los días con cambios. Requiere el gateway 1.0.38 en el servidor; con un gateway anterior funciona como antes.
- **Filtro de estados con chips pequeños** y punto de color (pendientes, en curso, completados); "Todos" como texto que limpia el filtro. Las pestañas Trabajos / Mantenimientos / OTs usan línea inferior.
- **Botón recargar** junto a la campana; se oculta al escribir en el buscador.
- **Pausar varios cronómetros desde el aviso** ya no los hace reaparecer.

## Verificacion local

1864 pruebas de la app y del gateway pasadas (1 omitida), typecheck sin errores.
