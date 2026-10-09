# Pausar desde el aviso sin error: APK 1.0.98

Mantiene todo lo de la [actualizacion 1.0.97](ACTUALIZACION-1.0.97.md) y corrige:

- **Pausar varios cronómetros mostraba OFFLINE_TIMER_INVALID_TRANSITION.** Ocurría con cronómetros que el servidor informaba en curso pero que la jornada del teléfono mostraba pendientes. Ahora, si el trabajo no está en curso en la jornada, se quita del aviso con una explicación en vez de fallar.
- Los códigos de la cola sin conexión (cronómetro no en curso, trabajo terminado, hora del teléfono cambiada) se muestran como mensajes en español.

## Servidor

El backend corrige el origen de esas alertas falsas: un cronómetro solo se informa en curso si ninguna planificación del trabajo se actualizó después con otro estado (commit 4de6ab904 en development). Hay que desplegarlo.

## Verificacion local

1858 pruebas de la app y del gateway pasadas (1 omitida), typecheck sin errores.
