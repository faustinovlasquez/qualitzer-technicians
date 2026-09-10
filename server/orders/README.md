# Ciclo de vida de OT de mantenimiento

`createOrderRouter(upstream)` se exporta desde [routes.ts](routes.ts) y **ya está integrado** en [../app.ts](../app.ts). La UI de detalle de OT conecta consulta, inicio y entrega; no es sólo un router aislado. La autenticación previa se conserva. El alcance coordinado de recursos backend/frontend se documenta aparte en [../../docs/PANEL-TECNICO.md](../../docs/PANEL-TECNICO.md).

## Montaje y parsers actuales

La aplicación monta el router **por tenant**, antes de panel y asignaciones. El montaje exterior es `/api/assignments`, **después de `context.middleware()`**, seleccionando exclusivamente `context.get(req).session.tenantId`. No usa un JWT backend enviado por el cliente ni selecciona upstream desde headers/query del cliente.

El parser global conserva **32 KiB**. Su única excepción es `POST /api/assignments/maintenance-<id numérico>/deliver` (slash final opcional); no cualquier `:groupId`, método o ruta parecida. Esa solicitud alcanza el parser estricto de **3 MiB después de sesión y validación de alcance**, para recibir las firmas. No se elevó el límite global ni se parsean firmas antes de autenticar. `ORDER_DELIVERY_JSON_LIMIT_BYTES = 3145728` se define en [validation.ts](validation.ts).

El router contiene parser JSON estricto, sin descompresión: entrega 3 MiB, inicio 1 KiB. Un parser anterior que ya haya consumido el cuerpo impone su propio límite. Mantener los middlewares actuales de CORS, limitación de solicitudes, sesión y errores.

La captura PNG está implementada en web y nativo. La UI presenta revisión/confirmación antes del envío y vuelve a consultar el contexto; una firma dibujada en demo no acredita identidad ni valida el flujo en un teléfono real.

## Rutas públicas

Todas exigen query estricta:

`?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&companyBranchId=<entero positivo>`

Fechas reales, rango ascendente de menos de 31 días, sin parámetros extra ni repetidos. Usar el **día de consulta canónica de la OT**, no sustituirlo por una fecha de un trabajo. El backend agrega asignaciones centradas en `startDate`.

`groupId` siempre es el identificador completo recibido de asignaciones, por ejemplo `maintenance-50`; no un ID de trabajo. IDs de otras fuentes nunca se reinterpretan como mantenimiento.

| Gateway bajo `/api/assignments` | JSON | Upstream real |
| --- | --- | --- |
| `GET /:groupId/maintenance-delivery` | Sin cuerpo | GET assignments + `GET /maintenances/:id` |
| `POST /:groupId/start` | Exactamente `{}` | `POST /maintenances/:id/start-repair`, exactamente `{}` |
| `POST /:groupId/deliver` | Contrato siguiente | `POST /maintenances/:id/finalize` |

Ambas mutaciones responden HTTP 200 `{ "success": true }` **solo después** de comprobar el éxito upstream. No devuelven una OT inventada ni un estado local supuesto. Tras éxito, refrescar asignaciones y contexto de entrega. Todas las respuestas del router usan `Cache-Control: no-store`.

### JSON de entrega

```ts
interface OrderDeliveryInput {
  technicianSignature: string;
  note?: string | null;
  durationMinutes?: number | null;
  faultType?: "operative" | "wear" | "undetermined" | null;
  receivedByName?: string | null;
  clientSignature?: string | null;
}
```

- `technicianSignature`: obligatoria, `data:image/png;base64,...` canónico; máximo **1 MiB decodificado por firma**. También se comprueban cabecera PNG, estructura de chunks hasta IEND sin bytes sobrantes, presencia de IDAT y dimensiones positivas de hasta 4096 por eje / 4194304 píxeles. No se aceptan URLs, SVG, JPEG, base64 sin prefijo, saltos de línea, cuerpos vacíos o estructuras truncadas. No se verifica la identidad biométrica, el trazo ni se decodifican los píxeles/CRC.
- `note`: hasta 10000 caracteres; nullable. No se altera el texto ingresado.
- `durationMinutes`: entero 0..525600 o null; cero se envía como null, igual que la web. El usuario puede ajustar duración como en el diálogo web, independientemente del permiso de edición de horas de **trabajos hijos**.
- `faultType`: allowlist del dominio backend, **no es un ID de catálogo dinámico**. No se inventó una ruta de catálogo. La web permite estos tipos definidos en `FaultType`.
- `receivedByName`: hasta 200 caracteres, normalizado con trim, sin caracteres de control.
- Para `correctivo` y `detencion`, el tipo de falla, nombre no vacío del receptor y firma del cliente son obligatorios. La necesidad se deriva del detalle backend, nunca del cliente.
- Para `preventivo`, `rutinario` y `checklist`, esos tres campos deben omitirse o ser null, como el payload del diálogo web. No se aceptan campos de recepción extra para estas clases.
- Campos opcionales omitidos se envían como null. No se reenvía el body arbitrario.
- **No admitidos:** `finalizedAt`, IDs de usuario/trabajador/mantenimiento, `signedBy`, `signedByName`, tenant/sucursal, `actor`, fuente, permisos, estado, identificadores de catálogo ni campos desconocidos. La fecha de finalización y autor de firma técnica los fija el backend mediante sesión. El `signedBy` persistido es `req.user.id`, no `workerId`.

### Respuesta de contexto para UI / dominio

`OrderDeliveryContext` extiende el `MaintenanceDeliveryContext` móvil existente. Campos:

```ts
interface OrderDeliveryContext {
  groupId: string;
  maintenanceId: number;
  companyBranchId: number;
  generatedAt: string;
  status: "pending" | "in_progress" | "paused" | "completed" | "delivered";
  maintenanceType: "detencion" | "preventivo" | "correctivo" | "rutinario" | "checklist";
  finalizationNote: string | null;
  damageType: "operacional" | "desgaste" | null;
  durationMinutes: number | null;
  startedAt: string | null;
  finalizedAt: string | null;
  incompleteChecklists: string[];
  suggestedDurationMinutes: number;
  canStart: boolean;
  canDeliver: boolean;
  requiresClientSignature: boolean;
  faultTypes: Array<"operative" | "wear" | "undetermined">;
  maxSignatureBytes: number;
  technician: { userId: number; workerId: number; name: string };
  signatures: Array<{
    id: number;
    role: "technician" | "manager" | "client";
    signedBy: number | null;
    signedByName: string;
    signedAt: string | null;
    hasSignature: boolean;
  }>;
}
```

- Nombre e identidad de `technician`: GET `/auth/me` fresco. `signatures`: solo metadatos persistidos del detalle autorizado; no se reenvían imágenes/URLs de firmas, información financiera, contactos, notas internas ni el detalle completo.
- `startedAt` es null si el detalle upstream no lo expone, como ocurre en el contrato actual. No se inventa a partir de `scheduledDate`, `updatedAt` ni del inicio de un hijo.
- `suggestedDurationMinutes` reproduce el diálogo web sobre trabajos de la asignación: máximo entre tiempo registrado y cronómetro para activos/pausados; tiempo registrado para terminados/entregados; cero para pendientes; redondeo a minutos. Excluye contenedores de productos. Si `durationMinutes > 0`, la UI debe preferir ese valor guardado.
- `damageType` precarga `operative` para `operacional` y `wear` para `desgaste`, igual que la web. Mostrar el catálogo estático `faultTypes`.
- `canDeliver` significa que el padre no está cerrado y los checklists comprobados permiten abrir entrega. Aún requiere los campos y firmas del formulario y la validación final backend. Ninguna bandera recibida de la UI autoriza la operación.
- `signatures` es historial informativo, **no** autorización para aprobar, firmar como otro usuario ni ejecutar `supervisor-finalize`. Esas acciones no pertenecen al panel técnico.

## Autorización y paridad verificadas

1. Reutiliza `AssignmentAuthorization.snapshot`: sesión verificada por el montaje, `/auth/me` fresco, trabajador vinculado, sucursal habilitada/no eliminada y `assignments.technician.id === user.workerId`.
2. La OT debe existir **una sola vez** en el snapshot fresco y tener fuente `internal_maintenance` con ID coherente. No filtra de nuevo por responsables de hijos ni usa `canManage`, `isResponsible`, `canExecute` o `missingRequiredInfo` como autorización de padre. La ausencia de campos estructurales requeridos en el contrato de asignaciones sigue fallando cerrada.
3. Consulta `/maintenances/:id` exclusivamente después de autorizar el grupo; valida ID, sucursal exacta, tipo/estado coincidentes, referencias de hijos/checklists/firmas y ausencia de IDs duplicados. Todos los hijos del detalle se inspeccionan, aunque no estén en el subconjunto visible al técnico.
4. Inicio: padre pendiente (`por_planificar` o `planificada`). No exige checklists completos ni hijos ejecutables/terminados.
5. Entrega: padre no entregado/finalizado/archivado. **No exige hijos completados**: el backend finaliza sus estados durante la entrega.
  El padre entregado no impone por sí solo `readOnly` a un hijo: se usa el estado fresco del hijo para sus respuestas/estados. Comentarios y documentos genéricos siguen disponibles tras el cierre, con autorización canónica. Si la entrega cambia el estado del hijo, ese nuevo estado sí se respeta.
6. Checklists: todos los obligatorios de todos los hijos, además de las restricciones de la asignación fresca. Misma heurística web: respuesta negativa/no aplica cuenta; texto no bloquea; selección/aprobación/multiselección y evidencia obligatoria se comprueban. Checklists opcionales/vacíos no bloquean. Se excluyen los contenedores `Productos (supervisor)` y `Productos utilizados`, como `getVisibleWorks` en la web.
7. Antes de cada POST vuelve a obtener usuario, asignaciones y detalle, compara identidad y repite validaciones. Serializa inicio/entrega por mantenimiento dentro de cada router por tenant; ninguna escritura se reintenta automáticamente.

El backend conserva la última validación: su `finalize` consulta todos los checklists y puede rechazar divergencias con la heurística web (por ejemplo, texto vacío). El gateway **no** finge éxito ni sortea un rechazo. `Upstream` conserva su política existente de errores sanitizados, por lo que un error backend puede aparecer como `UPSTREAM_REJECTED`; los bloqueos detectados antes tienen códigos específicos y contexto recuperable con GET.

### Límites de garantía existentes

Las rutas backend originales de inicio/finalización solo llevan `verifySession`, no una autorización atómica por recurso; no son transacciones condicionales. Las relecturas y el bloqueo del gateway reducen carreras, pero **no** son una garantía atómica frente a cambios simultáneos desde la web/otros procesos o solicitudes directas al backend. El bloqueo tampoco coordina rutas de hijos. No exponer el backend operativo directamente a clientes no confiables; los recursos nuevos del panel no equivalen a endurecer globalmente estas rutas.

Ante pérdida de conexión o respuesta inválida, actualizar antes de repetir: la escritura pudo haberse confirmado upstream.

## Contratos investigados y pruebas

- Web: [TechnicianDashboardPreview.tsx](../../../Qualitzer2.0-Frontend/src/modules/TechnicianDashboard/components/Preview/TechnicianDashboardPreview.tsx) contiene `handleStartMaintenance` y `handleDeliverMaintenance`; abre [MaintenanceDeliveryDialog.tsx](../../../Qualitzer2.0-Frontend/src/modules/TechnicianDashboard/components/Preview/MaintenanceDeliveryDialog.tsx), cuyo `handleFinalize` construye el payload.
- Hooks: `useStartMaintenanceRepair` y `useFinalizeMaintenance`; invalidan asignaciones/detalle tras éxito. `MaintenanceService` usa `/start-repair` y `/finalize`.
- Backend: `Maintenance.routes.ts`, `Maintenance.controller.ts`, `MaintenanceUseCase.ts`, `MaintenanceSequelize.repository.ts` y `IMaintenance.ts`, inspeccionados en solo lectura.
- Las **21 pruebas aisladas de OT** fueron una comprobación anterior con servidores/tenants simulados en [../tests/order-lifecycle.test.ts](../tests/order-lifecycle.test.ts). El último resultado comunicado de la batería móvil completa es **270 casos: 269 aprobados, 1 omitido por plataforma Windows y 0 fallidos**; no se suman ambos recuentos.
- Demo operativa en navegador y capturas: entrega del hijo y entrega de OT con firma dibujada, además de checklist, comentarios, PNG y pausa/reanudación. No constituye entrega real ni verificación de ambos dispositivos nativos.
- TypeScript pasó antes del último cambio multifecha; nueva ejecución y exportación final pendientes del integrador. La exportación Expo anterior no acredita esta revisión. No se probó una cuenta real proporcionada, no hubo mutaciones reales de validación ni APK/IPA firmado/dispositivo físico probado. Sin lint/tests/build globales del backend/frontend; esta tarea es sólo documental.