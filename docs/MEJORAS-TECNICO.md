# Mejoras del técnico

**09-09-2026 · Implementación integrada, no validación productiva completa.** Backend/frontend en `app-mobile`; esta mejora no modifica frontend. La ampliación backend reutiliza la proyección canónica y añade repositorios con inyección manual, sin cambios de autenticación. Esta actualización sólo documenta el alcance.

Único destino de API: `BACKEND_URL`. No se configura `TENANT_ORIGIN` ni una URL frontend; el backend resuelve la empresa. Ocultar el portal no cambia la configuración de conexión ni los datos locales.

## Qué cambia

| Área | Comportamiento vigente |
| --- | --- |
| Trabajos duplicados | `CanonicalAssignmentWorks` omite el espejo estándar de mantenimiento sólo con `maintenanceWork.workId` válido y el hijo asignado presente. No fusiona trabajos por título/equipo ni elimina un espejo sin verificar esa relación. Proyección backend compartida por web/móvil. |
| Tarjetas | Trabajos muestra tarjetas planas por fecha, con referencia OT dentro, sin repetir cabeceras de OT; OTs conserva su pestaña independiente. |
| Cabecera | Empresa/sucursal de la sesión visibles; URL del portal eliminada de texto y accesibilidad. La sesión observada es Heavytech. `portalOrigin` sigue en identidad/namespaces: no se borra, no cambia autenticación ni se configura como destino frontend. |
| Conexión | Diferencia comprobación, conexión a Qualitzer, falta de red, pasarela inaccesible, fallo del servidor y sesión requerida. Tener Wi-Fi o agenda cacheada no prueba acceso al backend. |
| Sincronización | Automática en primer plano al reconectar/volver. Web conecta `focus`, `pageshow` y `visibilitychange`; los despertares conservan el lease y la validación de identidad, sin perderse durante un envío. No se garantiza con la app cerrada. |
| Pendientes | Comentarios/fotos esperan confirmación de su creación padre e IDs canónicos. El centro muestra el motivo humano y datos del padre; IDs/JSON están contraídos. No son nuevas tarjetas de trabajo por cada adjunto. |

### Conexión y despliegue: sin borrar datos

`OfflineSnapshot.connection` es opcional por compatibilidad; el motor actual publica `OfflineConnection` con `status`, `networkConnected`, `foreground`, `checkedAt` y `errorCode`. Estados: `checking`, `ready`, `offline`, `unreachable`, `service_error`, `auth_required`. `networkConnected` admite `null`; sólo `false` significa **Sin red**. Fallo de transporte muestra **Sin acceso a Qualitzer**; un backend que falla no se presenta como ausencia de red. Primer plano y cobertura de caché son datos separados.

- Sólo `MOBILE_CREATION_SCHEMA_NOT_READY`, `MOBILE_SYNC_SCHEMA_NOT_READY` y `OFFLINE_SYNC_ROUTE_NOT_FOUND` esperan despliegue con reintento automático de **al menos 60 segundos** y el mismo UUID/payload/bytes.
- Los bloqueos/conflictos antiguos de creación sin recibo/resultado y con código exacto `MOBILE_CREATION_SCHEMA_NOT_READY` pueden recuperarse, incluidos los antiguos 409 de esquema. No se reinician conflictos genéricos, rechazos ni `needs_review`; `MOBILE_SYNC_OPERATION_REUSED` sigue en revisión.
- Volver a la app reinicia esperas de transporte, **no** el plazo de despliegue. El motor no crea tablas ni habilita rutas. Las tres migraciones tenant originales no se ejecutaron automáticamente; se desconoce si el usuario ya las aplicó. No se diagnostica una tabla faltante sin verificar el entorno.
- No borrar almacenamiento, cambiar UUID ni recrear una solicitud incierta. Una respuesta perdida se recupera con replay idéntico y recibos, no con otra operación.

Guía de recuperación: [OFFLINE.md](OFFLINE.md).

## Equipo por número interno

1. En el nuevo borrador de trabajo/mantenimiento, buscar número interno **exacto**, recortando extremos y pasando a minúsculas. No es prefijo ni conversión numérica: `001` y `1` son distintos.
2. Seleccionar manualmente el resultado verificado, incluso si sólo hay uno. Buscar otro número no sustituye el equipo ya elegido.
3. El borrador/revisión conserva el ID; se envía como `work.rentalEquipmentId` o `maintenance.equipmentId`. El número interno no se usa como ID.

Offline sólo cubre consultas cacheadas con metadatos coincidentes, no todo el catálogo ni disponibilidad actual del servidor. **No añade equipo retroactivamente a un payload ya encolado sin equipo**: su cuerpo es inmutable y una nueva operación sería distinta, no una reparación automática.

## Checklists de la empresa

En el detalle canónico, **Checklists de la empresa → Agregar checklist** está sobre el asistente, incluso sin checklists previos. Catálogo de maestros activos por nombre/código, páginas de **20**, selección y confirmación manuales.

- Sólo online sobre un trabajo existente canónico, no local ni cerrado/entregado. El cierre del padre no bloquea por sí solo a un hijo vigente; mandan asignación, estado y permisos actuales.
- Asociación **aditiva**: respuestas nuevas en blanco, sin copiar evidencias ni sobrescribir listas, respuestas o borradores anteriores. Repetir el maestro informa que ya está asociado.
- No crea/edita maestros ni quita checklists. No hay cola offline ni migración nueva para esta asociación. Un fallo de refresco posterior permite actualizar sin repetir el POST.

Contrato: [../server/checklists/README.md](../server/checklists/README.md). La edición administrativa de trabajos/materiales/responsables y creación preventiva/rutinaria/checklist siguen fuera del alcance móvil.

## Evidencia y límites

- Validación final: **591 casos, 590 aprobados, 1 omitido por plataforma, 0 fallidos**. TypeScript app/pasarela sin errores y exportación Android/iOS/web completada. SQLite, NetInfo y FileSystem resueltos en nativo; web con IndexedDB y sin SQLite/WASM.
- **Offline E2E PASS**: cuatro operaciones aplicadas, un efecto por tipo, recargas y respuesta de documento perdida recuperada con payload/bytes idénticos; reconexiones sin duplicados.
- **Checklist/equipo E2E PASS** en demo y pasarela ficticia, navegador 390×844: selección exacta/manual, borrador y solicitud conservados, asociación en blanco y repetición bloqueada; cabecera sin URL del portal ni desbordamiento. Fixture 8788 detenida. Detalles en [../tests/e2e/README.md](../tests/e2e/README.md).
- Acceso real autorizado a Heavytech: asignaciones devuelve una tarea de mantenimiento sin espejo duplicado; búsqueda `1644051` devuelve equipo ID 1 y catálogo de checklists devuelve «Revision carro». Cabecera sin URL y estado «Conectado a Qualitzer · 0 pendientes». No se hicieron mutaciones operativas reales; asociaciones verificadas en demo/fixture.
- **La cola concreta del usuario no se verificó:** IndexedDB compartido sólo tenía seis operaciones ya `applied`, sin los padres `local-94…` de sus capturas. No se afirma que esos pendientes se hayan resuelto; revisar el mismo dispositivo/perfil/ámbito conservando los datos.
- Se modificó código móvil/backend dentro del alcance y se validó la app/pasarela. No se ejecutaron tests/lint/build globales backend/frontend, migraciones ni escrituras SQL de validación, ni se cambiaron políticas de permisos de VS Code. Faltan SQL concurrente autorizado, teléfonos físicos, SQLite nativo, firmas, APK/IPA y push real. El E2E mantiene disponible el cliente web: no acredita PWA ni apertura web totalmente offline.

Más cobertura: [PANEL-TECNICO.md](PANEL-TECNICO.md). Creación y requisitos originales de despliegue/avisos: [PLANIFICACION-Y-AVISOS.md](PLANIFICACION-Y-AVISOS.md).