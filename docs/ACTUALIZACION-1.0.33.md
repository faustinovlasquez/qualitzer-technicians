# Creaciones consecutivas sin bloqueo

APK 1.0.33, codigo Android 34. Se mantiene gateway 1.0.12.

## Correccion

El formulario restauraba una solicitud con estado queued y no ofrecía Crear otro. Ademas, esa pantalla conservaba el estado del momento de encolar, aunque la operacion ya estuviera aplicada y el indicador superior no mostrara pendientes. No depende del dia ni de tener otros trabajos asignados.

- Crear otro abre un formulario vacio con la fecha seleccionada al entrar. La solicitud anterior sigue en la cola; no se elimina ni se reenvia.
- Cada nuevo envio confirmado por el usuario genera su propio UUID. Abrir el formulario o revisar datos no envia ninguna creacion.
- Se consulta la operacion exacta por UUID, tipo, sucursal, payload e identificadores locales. Solo applied con resultado valido coincidente cambia la pantalla a Creacion confirmada.
- Los estados que requieren revision o autenticacion se distinguen de pendiente. Si no se puede comprobar el estado, se informa sin inventar confirmacion a partir del contador global.
- El formulario nuevo se guarda antes de retirar la referencia en memoria al anterior. Si falla la escritura, el formulario anterior se conserva y puede recuperarse. No se borra primero el almacenamiento.

Instalar como actualizacion, sin desinstalar ni borrar datos, colas, recibos o borradores. Este arreglo no requiere cambios adicionales de backend, gateway ni migraciones. Conserva los requisitos de las funciones anteriores.

## Verificacion local

43 pruebas enfocadas de formulario/recuperacion: creaciones consecutivas de trabajo, mantenimiento y tiempo no productivo, UUID distintos, fallos de disco, restauracion, sesion bloqueada y rechazo de resultados ajenos. 18 recorridos RN Web con 1607 aserciones y 60 capturas a 360/390/1280 px y texto 100/200 %. Incluyen la pantalla antigua guardada, dos creaciones nuevas y transicion de pendiente a confirmada sin envio adicional. Tipos del grafo de interfaz sin errores.

API, cola y sistema operativo simulados en las pruebas de pantalla. No se crearon registros reales ni se accedio al telefono del usuario; el estado concreto de su solicitud debe comprobarse desde la app actualizada. No se ejecutaron pruebas/build/lint/SQL del backend.