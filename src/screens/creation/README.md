# Integración de creación nativa

Archivos nuevos solamente. No se modifica App, hooks, dominio, autenticación, gateway, backend, frontend ni dependencias.

## Exports

- `CreationScreen`: props `kind`, `user`, `tenant`, `companyBranchId`, `initialDate`, `data`, `mode`, `busy?`, `storageKey`, `onBack`, `onLoadOptions`, `onSubmit`, `onCreated?`.
- Tipos de contrato reexportados desde `../../domain/creation`: `CreationKind`, `CreationOptionsQuery`, `CreationOptions`, `CreationInput`, `CreationResult`.
- `CreationQuickMenu`: `onCreate(kind: CreationKind): void`, `disabled?: boolean`.
- `clearCreationDrafts(storagePrefix: string): Promise<void>` para el cierre de sesión.

## Responsabilidades del padre

1. Instalar `expo-crypto` compatible con SDK 57 (se usa `Crypto.randomUUID()`). La instalación queda en manos del coordinador, junto a sus dependencias de notificaciones. Se reutilizan AsyncStorage y safe-area-context ya presentes.
2. Montar el menú solo en la raíz de jornada/agenda, fuera del ScrollView, dentro del área de contenido de Application (no sobre el contenedor externo reservado para el QR de escritorio). No montarlo en detalle, perfil o creación. Su dock reserva 96 px de base para navegación; en desarrollo 164 px para no superponer la píldora QR existente de 96–144 px. Notificaciones deben permanecer en la cabecera. Revisar visualmente al integrar; no se proporcionó una captura en esta subtarea.
3. `onCreate` selecciona un kind y abre CreationScreen; `initialDate` viene de la fecha seleccionada de la agenda, no del reloj UTC.
4. `onLoadOptions(query)` devuelve las opciones del backend para la sesión y sucursal actuales. Query usa `kind: equipment | specialties`, página base cero. El componente no hace fetch directo ni consulta costos.
5. `onSubmit(input)` debe devolver el resultado canónico o **rechazar**. No capturar errores devolviendo undefined ni mezclar un fallo de refresh con un fallo de POST. No modificar el cuerpo ni regenerar el UUID. Demo debe simular en su repositorio, nunca llamar POST real.
6. Después del POST, la pantalla marca y persiste `confirmed` antes de cualquier callback del padre. Muestra el resultado y llama `onCreated(result)` solo al pulsar **Ver en mi agenda**. El padre navega/recarga `result.schedule.date` en `result.companyBranchId`. Un refresh fallido no habilita otro POST. `onBack` conserva el borrador o la confirmación.
7. Para mantenimiento, `result.workId` identifica maintenance_works, no el espejo works. La pantalla muestra IDs reales; no inventa código OT ni equipo.
8. `storageKey` debe ser el namespace completo ya aislado de sesión/tenant/gateway/usuario/sucursal. Cada clave comienza literalmente por storageKey y agrega `:creation:v1:` y contexto. Al logout, desmontar la UI y **await clearCreationDrafts(namespace)** para cada prefijo de sesión correspondiente. No limpiar AsyncStorage global. El store invalida escrituras tardías de instancias cerradas.

## Seguridad de reintento y borrador

- Solo formularios validados, IDs de catálogo y el cuerpo/resultado canónico; no se almacenan objetos User, Tenant, sesión, token, costos ni credenciales. Los textos del formulario se guardan localmente: la UI pide no incluir información sensible. AsyncStorage no es una bóveda cifrada.
- UUID nuevo al confirmar un nuevo payload lógico. Antes de POST se persiste el cuerpo exacto. Si persistir falla, no se envía.
- Cualquier resultado incierto bloquea campos y conserva cuerpo/UUID, también después de reabrir. **Reintentar creación** envía ese cuerpo sin reconstruirlo.
- **Editar como nueva creación** requiere advertencia explícita de posible duplicado. La interfaz no presenta la creación como una solicitud de aprobación.
- Confirmación en memoria antes de persistencia: un error local de disco o del callback no permite reenviar. Si se recupera un pending tras fallo de disco, el replay conserva el UUID original.
- Borradores corruptos bloquean creación hasta descarte explícito; nunca se pierde silenciosamente un UUID incierto.
- El calendario es un selector accesible React Native compartido por web/iOS/Android, sin paquete adicional de fechas. También admite texto YYYY-MM-DD; horas HH:mm de 24 horas.
- Las advertencias usan `buildWeeklySchedule` únicamente si los snapshots cargados incluyen la fecha en `queryDates`. `Assignments` no contiene rango global: sin cobertura explícita (incluidas agendas vacías) se informa revisión incompleta, no se infiere cobertura desde generatedAt o fechas planificadas. No afirma que el servidor haya validado conflictos.

## Verificación

Se añadieron pruebas puras en `tests/creation-form.test.ts` para variantes, fechas/horas, borradores estrictos, replay/confirmación y advertencias. No se ejecutaron tests, lint ni build. Diagnósticos de editor revisados; integración de UI y pruebas nativas pendientes del coordinador.