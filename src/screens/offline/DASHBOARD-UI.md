# Contrato de UI offline de jornada y agenda

- `DashboardScreenProps`: añadir desde el padre `offline?: OfflineSnapshot | null` y `companyBranchId?: number` de la sucursal activa. `undefined` conserva compatibilidad online; `null` significa recuperación pendiente, no cola vacía. Sin sucursal explícita no se atribuye cobertura de otra sucursal.
- `WeeklyScheduleProps`: `unavailableDates?: string[]`, por defecto `[]`; Dashboard ya lo deriva y conecta. El padre no necesita pasarlo directamente.
- `OfflineStatusBarProps` sin cambios: `snapshot: OfflineSnapshot | null`, `onOpen: () => void`, `onSync: () => Promise<void>`.
- `AssignmentWorkCardProps` existentes: Dashboard conecta `online` y `staleReadOnly`; sesión bloqueada, snapshot nulo o trabajo sin ficha canónica no habilitan ejecución ni avance simulado.

## Casos de UX

- Barra compacta de 44 px mínimos, texto ajustable a dos líneas a 390 px; resumen completo abre centro offline, icono de sincronización con área de 44 px. No añade padding inferior de navegación/safe area; permanece responsabilidad del contenedor padre.
- Con conexión y sin pendientes: disponibilidad offline únicamente si hay cobertura real. `cachedAt` sin cobertura no basta. Hora mostrada corresponde a la cobertura más reciente, sin afirmar cobertura de toda la semana.
- Rango offline: fechas faltantes = rango visible menos cobertura de sucursal. No se utiliza `snapshot.missingDates`, que puede pertenecer a una descarga en segundo plano. Online no se interpreta una caché incompleta como respuesta incompleta del servidor.
- Días desconocidos: «Sin copia», sin cero horas ni mensaje de agenda vacía. Totales «parcial». Día sin copia ni bloques deshabilitado; horario enfoca el primer día consultable si la selección no está disponible. No modifica el rango ni la fecha de autorización de los bloques.
- Creación local en día sin descarga: «solo local», fecha y bloques accesibles, «Guardado local · pendiente» y sin código TR ficticio. Bloques existentes no se mutan ni se eliminan.
- Sin copia en ningún día: mantiene encabezado «Sin copia · no disponible» y aviso «no es carga cero».
- `RunningTimersNotice` no modificado; conserva tiempos del snapshot, sin introducir reloj nuevo.

## Validación

Pruebas puras añadidas en `tests/offline-dashboard-ui.test.ts`; no ejecutadas para evitar interferir con terminales del coordinador. Validación limitada a diagnósticos de editor. App, hooks, dominio, servidor, paquetes y SQL fuera de alcance. Vista real 390 px pendiente de validación por el coordinador.