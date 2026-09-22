# 1.0.39: ubicacion laboral

## Uso

Mi perfil > Ubicacion laboral. Desactivado inicialmente. El tecnico acepta el aviso y concede ubicacion durante el uso y en segundo plano. Horario inicial 08:00 a 18:00, todos los dias; puede cambiar horas y dias. Se usa la zona horaria que informa la sesion de Qualitzer, mostrada en el panel. No admite turnos que crucen medianoche.

Recorrido automatico con precision equilibrada, intervalo minimo cinco minutos y desplazamiento minimo 100 m. Los puntos con precision peor que 100 m se descartan. No es una posicion exacta cada cinco minutos ni un seguimiento de navegacion. La notificacion Android indica el seguimiento activo.

Al iniciar/reanudar un trabajo se registra un evento ligado al UUID de su operacion offline; al iniciar una orden completa se registra otro evento despues de la confirmacion. Si no se obtiene GPS en diez segundos, el evento indica ubicacion no disponible. No bloquea la operacion de trabajo. No se inventan puntos perdidos si el proceso muere durante la captura.

## Offline y limites

- Historial durable SQLite, separado por empresa, usuario, trabajador y sucursal. No se guarda en la cola de documentos ni se somete a su politica de expulsion de cache.
- Hasta 5000 puntos pendientes por perfil, sin borrar pendientes al alcanzar el limite; el panel avisa y se detiene el registro adicional.
- Subida por lotes de 50 al abrir/mantener la app conectada, con reintentos progresivos hasta cinco minutos. No se promete subida con la app cerrada. Solo se retiran los IDs confirmados por el servidor.
- La captura de fondo necesita permisos y una sesion verificada en las ultimas 24 horas. Cambiar de cuenta/sucursal o revocar la sesion detiene el contexto anterior. Los pendientes quedan en el perfil original.
- Se filtra cada punto por consentimiento y horario. Cambiar el horario no reescribe el horario historico de los puntos ya guardados.
- Android/iOS pueden retrasar el inicio diario o interrumpir el servicio por ahorro de bateria, permisos, reinicio o cierre forzado. Abrir la app vuelve a comprobar el horario. No se garantiza inicio puntual a las 08:00 ni historial continuo.
- El panel permite apagar el seguimiento, revisar pendientes y consultar el historial sincronizado del dia. Los eventos son datos del dispositivo, no prueba certificada de asistencia ni de aplicacion de un trabajo offline.

## Servidor

Requiere el modulo backend `workerLocations`, registro de rutas, la migracion tenant `20260921200000-Create-WorkerLocationHistory.js` y gateway 1.0.17. La migracion NO fue ejecutada aqui. Primero desplegar servidor; despues actualizar el APK sin desinstalar ni borrar datos.

La tabla conserva coordenadas, precision, fecha UTC/local, consentimiento, horario y referencias para reportes futuros. La API actual solo permite historial propio. El reporte de supervisores y una politica de conservacion/eliminacion autorizada quedan fuera de esta entrega; no hay purga automatica. La empresa debe informar el uso y plazo de conservacion antes de activar el seguimiento con empleados.

## Verificacion

Pruebas enfocadas de horario/DST, almacenamiento/ack, identidad, permisos y gateway con servicios simulados. Panel RN Web en 360/390/1280 px y texto 100/200%, sin errores de navegador. No equivalen a una prueba de GPS, bateria, SQLite nativo o sincronizacion contra MySQL productivo. Los tests backend se prepararon pero no se ejecutaron.