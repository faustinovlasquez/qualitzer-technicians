# Trabajo offline sin bloqueos: APK 1.0.77 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.76](ACTUALIZACION-1.0.76.md) y corrige los casos en que el trabajo hecho sin conexion quedaba trabado al volver la red:

- **Cronometro y entrega en "Conflicto · revisar".** El servidor rechazaba un inicio, pausa o entrega offline si el trabajo habia cambiado por cualquier motivo (comentarios, archivos, edicion web, incluso las propias operaciones offline sincronizadas antes). Ahora solo es conflicto un cambio real de estado del cronometro. *Requiere el backend actualizado.*
- **Resolucion automatica.** Si igual llega un conflicto de estado, la app relee el estado real del trabajo y reenvia la accion sobre ese estado conservando la hora en que se toco el boton. Lo que el servidor ya refleja se da por resuelto y se liberan las acciones siguientes. Tambien se puede forzar desde el centro offline con "Reintentar".
- **Pausar o terminar despues de un conflicto.** Antes un conflicto impedia registrar cualquier nueva accion del cronometro; ahora se resuelve y se puede continuar.
- **Entrega trabada por una evidencia con problema.** Una foto, respuesta o comentario que requiere revision ya no impide registrar ni enviar la entrega; el servidor sigue validando lo obligatorio.
- **OT que desaparecian offline.** "Preparar semana" podia expulsar de la memoria local la agenda del dia al guardar archivos y comentarios. La agenda ya no se expulsa, y nunca la de un dia con cambios pendientes.
- **Corregir una respuesta offline.** Responder un paso y luego corregirlo ya no genera conflicto con la propia respuesta anterior.
- **Subidas lentas.** Una foto cortada por tiempo en el gateway vuelve a la cola y se reintenta sola con el mismo identificador.
- **Errores momentaneos del servidor** (bloqueos o caidas de base de datos) ya no dejan la operacion en revision permanente: se reintenta sola. *Requiere el backend actualizado.*

Actualizar la APK sin desinstalar la anterior; la cola local se conserva.

## Verificacion local

Pruebas de la app y del gateway pasadas, typecheck sin errores. Backend: 272 pruebas de sincronizacion movil pasadas y typecheck sin errores.
