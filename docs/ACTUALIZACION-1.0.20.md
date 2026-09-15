# Qualitzer tecnicos 1.0.20

- El boton de mas opciones abre las secciones del trabajo. Salir a mis asignaciones es una opcion explicita del menu.
- Tarjetas de actividades compactas, con nombre, minutos, casilla de estado y acciones de archivos, editar y eliminar.
- Editar cambia nombre y minutos sin recrear la actividad ni cambiar sus archivos. Los borradores de edicion son independientes de la actividad nueva.
- La casilla permite marcar Lista y devolver a Pendiente. Solo para trabajos abiertos y con permiso vigente.
- Reanudar y Entregar no aparecen al responder checklist, manejar archivos del trabajo o abrir el panel de una actividad.
- El lote de adjuntos continua durante su propio bloqueo de operacion. Conserva el ID de actividad y los pendientes; no reenvia archivos ya confirmados.
- La subida usa creacion individual del archivo en backend y devuelve su ID confirmado tras terminar la transaccion. La app y gateway no aceptan una respuesta sin ese ID como guardado.

## Despliegue

Actualizar Backend (PanelWorkActions y rutas) y gateway 1.0.8 antes de instalar APK 1.0.20/codigo 21. El gateway anterior no admite desmarcar ni editar, y el backend anterior no devuelve ID del archivo.

Sin migracion nueva, variables nuevas ni cambios de Firebase. Conservar la firma, claves, sesiones, datos y pendientes. Instalar sobre la app existente, sin desinstalar ni borrar datos.

APK verificada: 69765023 bytes, SHA-256 `e63ae7d06bf92d1b0d4b3f4d0639103735fa5c952b35b0670a874985565d43c1`. Gateway 1.0.8: 586441 bytes, SHA-256 `f02562722c884db9046b54009a77dcbb8e06bd168246360e23fb248f4b8bbe85`. Misma firma Android que 1.0.19; la APK anterior se conserva.

## Validacion

268 pruebas moviles enfocadas aprobadas y cero errores de tipos en el alcance revisado. Seis flujos visuales con 230 aserciones y 54 capturas: 360, 390 y 1280 px, texto 100/200 %. Incluyen menu, editar, marcar/desmarcar, adjuntos, relectura y pie contextual. Backend: pruebas de autorizacion y persistencia añadidas como fuente, sin ejecutarlas por las reglas del repositorio. Sin SQL ni migraciones ejecutadas.

Las pruebas usan puertos de sistema y servicios simulados; no acreditan una subida en el telefono fisico o servidor desplegado. Ante perdida de respuesta de una creacion/subida, verificar el resultado antes de repetirla: las actividades no usan los recibos idempotentes de la cola offline.