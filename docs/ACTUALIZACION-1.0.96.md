# Cronómetros activos: desplazar, pausar y abrir con indicador: APK 1.0.96 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.95](ACTUALIZACION-1.0.95.md) y mejora el aviso de cronómetros activos:

- **Con muchos cronómetros la lista se puede desplazar.** Al expandir "Ver los N", la lista tiene un alto máximo y se desplaza dentro del aviso hasta el último.
- **"Ver" muestra que está abriendo.** El botón cambia a un indicador y la fila dice "Abriendo el trabajo…" mientras se busca el trabajo (puede ser de otra fecha).
- **Pausar desde el aviso.** Cada fila tiene un botón de pausa: pausa el trabajo sin abrirlo y la fila desaparece con una transición. Si no se puede pausar, se muestra el motivo arriba y el cronómetro sigue visible. Sin conexión, la pausa queda en la cola y también sale de la lista.
- Expandir y contraer la lista también es animado.

## Servidor

Sin cambios (backend y gateway 1.0.37; el despliegue del backend de la 1.0.95 sigue pendiente).

## Verificacion local

1858 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
