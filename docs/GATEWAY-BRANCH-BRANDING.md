# Marca de sucursal: gateway móvil

## Contrato

- `GET /api/auth/me?companyBranchId=N` conserva las dos lecturas frescas de `/auth/me`, la pertenencia habilitada/no eliminada a N y la igualdad de usuario/trabajador. Solo después consulta `GET /branches/N` con el bearer upstream y el Origin del tenant de sesión.
- El adaptador backend existente `processBranchData` devuelve el detalle plano: `id` numérico, `name` y `logo` nullable construido como URL de almacenamiento. No se utiliza el listado de sucursales ni se exponen contactos, bancos, integraciones u otros campos del detalle.
- La respuesta mantiene el usuario y `tenant`. Parte de `context.tenants.display` y sobrescribe únicamente `tenant.name` y, si es aceptado, `tenant.logo`. No cambia `id`, `portalOrigin`, `environment`, descripción, tokens, sesiones persistidas o namespaces.
- Nombre: detalle de la sucursal (trim, 1–120 caracteres), después nombre de la misma sucursal en el usuario fresco, después empresa. No se inventa ni utiliza un alias.
- Logo nulo, ausente o rechazado: conserva el logo general de empresa, nunca el de una sucursal vista anteriormente.
- Campo adicional `branchBranding`: `{ companyBranchId: N, status: "APPLIED" }` cuando el detalle tiene el ID exacto. APPLIED significa detalle aceptado, no descarga o visualización del logo verificada; los campos ausentes conservan los fallbacks descritos.
- Si el ID no coincide o el cuerpo no cumple el esquema: marca general intacta y `{ companyBranchId: N, status: "FALLBACK", error: "BRANCH_BRANDING_INVALID_RESPONSE" }`. Errores de transporte, HTTP no autenticación o JSON ilegible: `BRANCH_BRANDING_UNAVAILABLE`. No se exponen cuerpos de error.
- **401/403 del detalle se propagan**, sin respuesta operativa de fallback. La marca no concede acceso a sucursales no autorizadas.
- `/me` sin sucursal sigue mostrando la empresa, sin `branchBranding`. El helper operativo `currentUser` no consulta marcas.

## Seguridad y coste

Una lectura protegida adicional por `/me` con sucursal válida; timeout de 2,5 segundos, sin reintento ni seguimiento de redirects. No hay caché de marcas de sucursal; cada consulta vuelve a partir de la marca general (su caché existente conserva TTL de cinco minutos). No se realizan peticiones a logos ni se crea un endpoint backend.

El logo de sucursal pasa por `sanitizeLogo` y la política DNS pública existente: solo HTTPS, sin credenciales, IP literales, hosts locales/reservados conocidos, puertos no estándar, fragmentos, controles o barras invertidas. Se conserva el query de URLs firmadas. Esta validación es sintáctica, **no certifica resolución DNS pública ni protege una futura descarga frente a DNS rebinding/redirecciones**. Cualquier descargador posterior necesita su propia política y límites; el gateway no realiza esa descarga.

## Cliente y despliegue

El cliente consume `tenant.name`/`tenant.logo` para la UI. El icono principal instalado sigue siendo Qualitzer. Desde el APK **1.0.2 / código 3**, el módulo nativo del acceso fijado/Recientes admite data URIs válidas y logos HTTPS: comprueba DNS público y TLS, no sigue redirecciones ni envía cookies/autorización y limita tiempo, bytes y dimensiones. Si una imagen no cumple la política o falla su descarga, usa el icono Qualitzer y lo informa. El acceso empresarial requiere la acción del usuario en Mi perfil y confirmación Android; no reemplaza el icono principal.

El paquete **@qualitzer/mobile-gateway 1.0.1** ya está generado en [../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz](../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.1.tgz), sin sobrescribir el histórico 1.0.0 ni modificar la rama de trabajo del backend. Su instalación en el servidor sigue pendiente del responsable del despliegue. El APK 1.0.2 también está compilado y firmado; esta corrección de presentación necesita ambos componentes. Pasos de actualización sin borrar sesiones ni datos: [ACTUALIZACION-1.0.2.md](ACTUALIZACION-1.0.2.md).

## Validación aislada

Las 20 pruebas nuevas de `server/tests/branch-branding.test.ts` cubren contrato HTTP, ID exacto, guardas de sesión/pertenencia/frescura, 401/403, fallback, timeout, redirects, logos/nombres, A→B→A, aislamiento de tenants, namespace inalterado y ausencia de descarga de imágenes.

Resultado verificado: **132/132 pruebas, cero fallos y cero omitidas** en nueve archivos: branch-branding, branding, gateway, multitenant, web-session, login-discovery, client-tenant, creation-routes y checklist-assignment. Comprobación TypeScript del grafo de los cinco archivos de código/pruebas editados: cero diagnósticos. Solo servidores simulados locales; no credenciales reales, validación global del backend, build, despliegue ni prueba física del pin.