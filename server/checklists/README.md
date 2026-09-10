# Asociación de checklists existentes

## Rutas montadas

`createChecklistRouter(upstream)` está montado por tenant en [../app.ts](../app.ts), bajo `/api/assignments`, después de `SessionContext.middleware()` y antes del router genérico de asignaciones.

- GET `/api/assignments/:groupId/works/:workId/checklists/options?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&companyBranchId=N&search=texto&page=0`
- POST `/api/assignments/:groupId/works/:workId/checklists?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&companyBranchId=N`, JSON exclusivamente `{ checklistId: number }`.

El gateway traduce al prefijo `/technician-dashboard/panel/:groupId/works/:workId/checklists`, añadiendo `groupType` obtenido del snapshot fresco. El router del módulo backend ya registra esas rutas; no requiere otra entrada global. La ampliación usa inyección manual y repositorios del módulo, sin cambios de autenticación.

Catálogo empresarial de maestros activos con pasos habilitados: `{ items: [{ id, name, code, description, alreadyAssigned }], page, pageSize: 20, hasMore }`. Página base cero, máximo 1000, búsqueda de nombre/código máximo 120 caracteres. No selecciona automáticamente. Campos ajenos a esta lista, incluidos precios, se eliminan al cruzar el gateway.

Asociación: `{ checklistId, alreadyAssigned }`, HTTP 201 si crea, 200 si ya estaba. No reemplaza el conjunto de checklists ni modifica las respuestas existentes. La repetición del mismo ID es una comprobación aditiva; no hay recibo offline ni clave de operación.

## Integración vigente de UI/offline

[../../App.tsx](../../App.tsx) y [../../src/application/useTechnicianApp.ts](../../src/application/useTechnicianApp.ts) conectan `loadChecklistOptions` y `attachChecklist` al detalle canónico actual. `HttpTechnicianRepository`, `DemoTechnicianRepository` y el wrapper `OfflineTechnicianRepository` implementan:

- `checklistOptions(scope: WorkScope, query: ChecklistCatalogQuery): Promise<ChecklistCatalogPage>`
- `attachChecklist(scope: WorkScope, checklistId: number): Promise<ChecklistAssignmentResult>`

`TechnicianRepository` expone `Partial<ChecklistAssignmentPort>` como capacidad opcional. El wrapper delega ambos métodos **sólo online**, comprobando namespace/actor/sucursal y alcance canónico. No usa catálogo de otro tenant, no convierte fallos del servidor en resultados offline y **no encola** asociaciones ni las fabrica para `local-*`.

[../../src/screens/workDetail/checklist/ChecklistAssociationPanel.tsx](../../src/screens/workDetail/checklist/ChecklistAssociationPanel.tsx) está montado encima del asistente, también con `work.checklists` vacío. **Checklists de la empresa → Agregar checklist** ofrece búsqueda, paginación, selección manual y confirmación explícita.

- `storageKey`, grupo y trabajo canónicos aíslan selección/peticiones. `pendingLocalWork` y `readOnly` impiden usar creaciones sin confirmar, snapshots obsoletos o sesión bloqueada.
- Offline y trabajo cerrado/entregado bloquean la acción; el estado del padre no la bloquea por sí solo. Se descartan respuestas tardías del catálogo.
- `onAttached` refresca asignaciones/detalle conservando la identidad local del borrador y respuestas existentes, sin abrir automáticamente otra lista. Si falla ese refresco, **Actualizar detalle** no repite el POST.
- La copia empieza con respuestas en blanco y sin evidencias. El panel no crea maestros, no quita asociaciones, no escribe en la cola ni reemplaza borradores.

## Autoridad y persistencia

- Gateway: sesión/tenant existente, `auth/me` fresco, worker y sucursal autorizados, snapshot canónico con una única pareja grupo/trabajo.
- Backend: sesión, worker y pertenencia a sucursal, nuevo snapshot antes de transacción y después de obtener bloqueo del trabajo, tipo/grupo y FK reales; maestro empresarial activo y pasos habilitados leídos dentro de la transacción.
- Paridad web: el diálogo de checklist recibe `readOnly` por estado terminal **del hijo**. No exige `canEditDefinition`, que el panel canónico marca falso, ni aplica un bloqueo por estado del padre. `canExecute` controla ejecución, no la asociación en el diálogo web.
- Catálogo por tenant/empresa, intencionalmente sin filtro de sucursal del maestro: los checklists son branchless en el repositorio web actual. La sucursal sí limita el trabajo objetivo.
- Estándar: `ActivitiesModel` con `__WORK_CHECKLIST__:` y `ActivityChecklistStepsModel`; mantenimiento: `MaintenanceWorkChecklistStepModel.maintenanceWorkId`, nunca el ID del espejo. Nuevos pasos preservan tipo/opciones/alertas/requisito de archivos y empiezan sin respuestas, finalización ni adjuntos. Nuevo checklist complementario (`isRequired: false`), como la selección web por defecto.
- Bloqueo SQL del trabajo serializa asociaciones concurrentes por estas rutas; bloqueo del maestro y pasos impide copiar una definición desactivada durante la operación. Relectura de asociaciones mediante bloqueo evita duplicados entre estas solicitudes. No se añade migración.
- Los endpoints PATCH legacy de conjunto completo no fueron modificados: no se afirma unicidad global frente a escritores externos que no toman el mismo bloqueo. No se ha probado concurrencia real MySQL.
- Se añadió lectura de actividades-checklist para trabajos no productivos en el snapshot canónico, antes siempre vacío; así aparecen tras refrescar y usan el mismo mapper que los productivos.

## Validación

- **E2E integrado PASS** en demo y pasarela ficticia a 390×844: catálogo, asociación a trabajo existente, respuestas vacías y repetición deshabilitada. Fixture 8788 detenida; [../../tests/e2e/README.md](../../tests/e2e/README.md).
- Hubo login real autorizado y lecturas. Los cuatro trabajos reales consultados eran terminales y no permitían asociar; no se modificaron para forzar éxito. La persistencia y concurrencia MySQL de esta operación siguen sin validación real.
- Última batería móvil comunicada: **588 casos, 587 aprobados, 1 omitido, 0 fallidos**. Nulabilidad del código del checklist corregida; confirmación final de tipos app pendiente. No se ejecutan pruebas/lint/build ni migraciones en esta edición documental.

Resumen funcional, evidencia y límites: [../../docs/MEJORAS-TECNICO.md](../../docs/MEJORAS-TECNICO.md).