# Qualitzer técnicos 1.0.3 — accesos y checklist

## Instalar

Actualizar sobre la app existente; misma firma y paquete `com.qualitzer.field`, código Android **4**. **No desinstalar ni borrar datos, caché, sesiones o pendientes.** La API pública no cambia y esta actualización no necesita un paquete nuevo de servidor ni migraciones.

## Cambios

- El acceso de la empresa abre directamente la app sin el aviso «Comprueba la empresa al ingresar». Se conserva el formato de los accesos anteriores. La app restaura su sesión normalmente; el acceso no autentica, cambia de empresa ni reenvía tokens o URLs.
- Tras establecer una sesión real verificada online y preparar la marca, se solicita automáticamente el acceso de empresa. **Android exige confirmarlo** y el lanzador debe soportarlo. Un acceso existente se reutiliza. La solicitud automática se hace una sola vez por empresa e instalación; cancelar no causa avisos repetidos. Para reintentar, usar **Mi perfil → Añadir empresa a pantalla de inicio**. El icono principal instalado sigue siendo Qualitzer técnicos.
- Tarjeta y detalle calculan el progreso con las mismas respuestas y evidencias confirmadas, incluidos los checklists complementarios. Borradores y pendientes de sincronización no incrementan el progreso. Las fichas antiguas no reemplazan respuestas más recientes.
- El formulario muestra la pregunta primero, sin códigos internos ni encabezados repetidos. Progreso resumido arriba, navegación y guardado fijos abajo; comentarios e historial se abren cuando se necesitan. Se conservan evidencia obligatoria, archivos, errores, estados y requisitos.
- **Guardar y seguir** guarda y avanza. Las flechas y el resumen permiten navegar sin enviar y conservan los borradores. Al cambiar de paso se vuelve al inicio de la pregunta. Preguntas largas, muchas opciones/evidencias o letra ampliada pueden requerir scroll dentro del paso; no se ocultan requisitos para forzar que todo quepa.

## Cómo interpretar el contador

«Paso 9 de 47» es la posición de navegación. «7/46 requisitos confirmados» cuenta los pasos computables, excluyendo informativos u opcionales según el contrato. Una respuesta sin su evidencia obligatoria confirmada sigue incompleta. Este porcentaje mide llenado, no aprobación técnica ni tiempo de trabajo.

## Verificación

- Suite conjunta: **859 aprobadas, 1 omitida por plataforma, cero fallos**. Tipos app/servidor y app incluyendo pruebas: cero diagnósticos. La corrección del fixture antiguo se verificó con sus seis pruebas, sin cambiar runtime.
- Branding: 30 JS, 15 JVM y cuatro pruebas de actividad Kotlin con dobles Android; compilación nativa release exitosa. Son subconjuntos, no se suman a la suite como casos únicos.
- UI: 17 escenarios aislados a 320/360/390 px y altura reducida, además de contratos estructurales y regresión de colores de RefreshControl.
- APK release en emulador Android 16/API 36: arranque frío mediante actividad del acceso sin el aviso; navegación por Agenda; checklist compacto; dos respuestas demo guardadas; detalle y tarjeta coinciden en **2/4**. Mismo proceso sin errores fatales nuevos en los registros revisados.
- Comentario escrito dentro de la app con Gboard flotante y guardado desde el pie. **No acredita el comportamiento de teclado acoplado/adjustResize ni del teclado Samsung.**

La prueba nativa usa datos de demostración, no la cuenta real. No se verificaron en un teléfono físico la confirmación automática del acceso, cámara, firmas ni todos los lanzadores. Las pruebas anteriores de Agenda/recuperación de red se conservan; no se afirma que eliminen cualquier posible fallo de producción.

## Servidor y marca

Las capturas recibidas ya muestran nombre y logo de la sucursal dentro de la app. Estos cambios no requieren volver a instalar el gateway. El paquete **1.0.1** de la entrega anterior sigue siendo el necesario para instalaciones que aún no reciben branding de sucursal; no se generó otro paquete ni se desplegó el servidor durante esta actualización.

Referencias: [checklist compacto](CHECKLIST-COMPACTO.md), [progreso](CHECKLIST-PROGRESS.md), [acceso Android](ANDROID-COMPANY-BRANDING.md), [validación conjunta](../artifacts/logs/release-1.0.3-validation/SUMMARY.md) y [evidencia nativa](../artifacts/logs/native-release-1.0.3/compact-native/SUMMARY.md).