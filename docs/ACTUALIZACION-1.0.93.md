# Agenda sin recargas completas: APK 1.0.93 / gateway 1.0.37

Mantiene todo lo de la [actualizacion 1.0.92](ACTUALIZACION-1.0.92.md) y mejora la carga de la Agenda y Mi jornada:

- **Copia local primero.** Al entrar o cambiar de semana/mes, los días descargados hace menos de 5 minutos se muestran desde el teléfono sin consultar al servidor. Solo se piden los días que faltan o están viejos, el día seleccionado primero.
- **Descarga en segundo plano con avance.** Mientras baja la agenda se ve "Descargando agenda · N de M días" con una barra, en vez del círculo de carga y del aviso "días no descargados". La agenda se puede seguir navegando; cambiar de semana cancela la descarga en curso y lo ya bajado queda guardado.
- **Disponible sin conexión.** Cada día descargado queda guardado y se usa si no hay conexión.
- **Cuándo se consulta todo igualmente:** al deslizar hacia abajo para actualizar, al guardar un cambio propio, al sincronizar la cola y al tocar un aviso.

## Servidor

Sin cambios respecto a la 1.0.89 (backend y gateway 1.0.37).

## Verificacion local

1856 pruebas de la app y del gateway pasadas (1 omitida solo en POSIX), typecheck sin errores.
