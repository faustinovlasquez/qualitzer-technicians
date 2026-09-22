# 1.0.41: entrada en Mi jornada

La apertura normal inicia en Mi jornada del dia, tanto con conexion como al restaurar una sesion offline. Antes, una semana completa descargada o una copia de dias anteriores podia seleccionar Agenda automaticamente. Si hoy no esta descargado, se muestra la falta de cobertura; los dias anteriores siguen accesibles desde el selector o Agenda, sin borrar datos ni pendientes.

En Mi jornada quedan seleccionados Pendientes y En curso. En curso incluye trabajos pausados. Completados y entregados permanecen ocultos hasta seleccionarlos o pulsar Todos. Los filtros admiten combinaciones; quitar el ultimo o seleccionar los tres estados equivale a Todos. Al entrar en Agenda se conservan sus valores iniciales sin restriccion de estado. Abrir una notificacion sigue dirigiendo al recurso solicitado.

No modifica cronometros, entregas, ubicacion, almacenamiento ni sincronizacion. No requiere cambios backend, gateway ni migraciones. Gateway 1.0.19 se conserva sin regenerar. Instalar como actualizacion sobre 1.0.40, sin desinstalar ni borrar datos.

Validacion: pruebas del hook de navegacion y restauracion, reinicio con SQLite local y datos sinteticos, filtros del componente real y seis recorridos RN Web (360/390/1024 px, texto normal/ampliado). No usa cuenta/API productiva ni acredita una prueba en telefono fisico.