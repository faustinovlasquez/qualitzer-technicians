# Pausar varios cronómetros seguidos: APK 1.0.97 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.96](ACTUALIZACION-1.0.96.md) y acelera el aviso de cronómetros activos:

- **Pausas sin esperar.** Se pueden tocar varias pausas seguidas: cada fila muestra "Pausando…" y la app las envía en orden. Antes había que esperar a que terminara una para tocar la siguiente.
- **Pausa más rápida.** Si el trabajo está en la jornada cargada, se pausa directamente; si no, se ubica con la copia local reciente antes de consultar al servidor. La jornada se recarga una sola vez al terminar todas las pausas, no después de cada una.
- **"Ver" inmediato** cuando el trabajo ya está en la jornada cargada.

## Servidor

Sin cambios (backend y gateway 1.0.37; el despliegue del backend de la 1.0.95 sigue pendiente).

## Verificacion local

1858 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
