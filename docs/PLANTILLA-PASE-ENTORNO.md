# Ficha de instalación y pase de entorno — Qualitzer técnicos

Copiar esta ficha por instalación. **No contiene ni debe contener secretos.** Guía: [manual completo](MANUAL-INSTALACION-PRODUCCION.md).

## 1. Decisión y responsables

| Campo | Completar |
| --- | --- |
| Entorno / fecha / ticket | PENDIENTE |
| Primera instalación / actualización / traslado | PENDIENTE |
| Coexistirá con la app anterior | PENDIENTE |
| Propietario y aprobador final | PENDIENTE |
| Operador backend / DB / frontend | PENDIENTE |
| Custodio de firma / Expo / Firebase | PENDIENTE |
| Técnico y supervisor piloto | PENDIENTE |
| Ventana y criterio de reversión | PENDIENTE |

## 2. Identificadores públicos y destinos

| Campo | Completar |
| --- | --- |
| URL API con `/api` | PENDIENTE |
| URL APK con `/mobile` | PENDIENTE |
| Dominio/origen portal por tenant | PENDIENTE |
| Proceso API / usuario Linux / cwd / puerto interno | PENDIENTE |
| Proceso Next / cwd / puerto interno | PENDIENTE |
| IPs proxy comprobadas / topología TLS | PENDIENTE |
| Directorio privado persistente de sesiones | PENDIENTE |
| Master / conjunto tenant / piloto | PENDIENTE — información interna |
| Número de empresas activas y límite de catálogo validado | PENDIENTE |
| Paquete Android / esquema / versión / versionCode | PENDIENTE |
| Huella pública del certificado de firma | PENDIENTE |
| Organización / slug / UUID Expo | PENDIENTE |
| Proyecto Firebase / sender ID / app ID | PENDIENTE |
| Canal y URL HTTPS de descarga | PENDIENTE |

Para secretos, anotar **referencia de custodia y responsable**, nunca valor: DB, JWT, S3/AWS, SMTP, cifrado push, clave/snapshot gateway, firma APK, cuenta de servicio FCM y token Expo opcional.

## 3. Autorizaciones separadas para la IA

| Acción | Alcance aprobado | Persona/fecha | Estado |
| --- | --- | --- | --- |
| Inspección de fuentes y configuración pública | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Editar configuración/código propuesto | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Instalar dependencias/herramientas | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Consultar estado DB sin escribir | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Aplicar migraciones concretas a bases enumeradas | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Alta de datos/roles/correo piloto | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Asociar credencial FCM al proyecto/paquete | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Compilar/probar/publicar APK y portal | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Reiniciar procesos/modificar proxy | PENDIENTE | PENDIENTE | NO AUTORIZADO |
| Enviar prueba push al dispositivo identificado | PENDIENTE | PENDIENTE | NO AUTORIZADO |

## 4. Evidencia por etapa

| Etapa | Esperado / observado | Enlace a evidencia saneada | Aprobado / bloqueado |
| --- | --- | --- | --- |
| Revisión/lock/paquete gateway | PENDIENTE | PENDIENTE | PENDIENTE |
| Respaldo y restauración aislada | PENDIENTE | PENDIENTE | PENDIENTE |
| Migraciones por base, columnas e índices | PENDIENTE | PENDIENTE | PENDIENTE |
| Variables pasarela/push por proveedor, sin valores secretos | PENDIENTE | PENDIENTE | PENDIENTE |
| HTTPS, catálogo, health y 401 esperado | PENDIENTE | PENDIENTE | PENDIENTE |
| Frontend, API pública, CORS y Socket.IO | PENDIENTE | PENDIENTE | PENDIENTE |
| Sucursal, rol, colaborador y trabajo piloto | PENDIENTE | PENDIENTE | PENDIENTE |
| Expo/Firebase cliente y FCM v1 asociado | PENDIENTE | PENDIENTE | PENDIENTE |
| Firma, paquete, versión, permisos y SHA APK | PENDIENTE | PENDIENTE | PENDIENTE |
| Descarga completa y actualización sin borrar datos | PENDIENTE | PENDIENTE | PENDIENTE |
| Agenda/checklist/archivos/comentarios móvil↔web | PENDIENTE | PENDIENTE | PENDIENTE |
| Offline/reconexión/recibos sin duplicados | PENDIENTE | PENDIENTE | PENDIENTE |
| Permiso Android, registro y recepción push | PENDIENTE | PENDIENTE | PENDIENTE |
| Operación con datos móviles sin PC | PENDIENTE | PENDIENTE | PENDIENTE |

## 5. Cierre

- Fecha/hora y zona de cierre: PENDIENTE.
- Versiones/revisiones Backend, Frontend y Mobile: PENDIENTE.
- APK publicado, tamaño y SHA-256: PENDIENTE.
- Gateway publicado, versión y SHA-256: PENDIENTE.
- Pruebas realmente ejecutadas, simuladas y no ejecutadas: PENDIENTE.
- Incidencias, responsable y plazo: PENDIENTE.
- Reversión aprobada y compatibilidad con esquema/datos: PENDIENTE.
- Aprobación nominal para uso productivo: **PENDIENTE**.

Una firma de aceptación no debe contener tokens, claves, contraseñas, contenido de cuentas de servicio o URLs firmadas de adjuntos.