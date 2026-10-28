# Actualización 1.0.141 (gateway 1.0.50, sin cambios) — servidor de desarrollo

## Qué trae
- **Recepción del ingreso igual a la web**: Técnico que recibe → **Firma** (selector con «+» para agregar otra firma) → **Datos de la firma** (solo lectura) → **Firma de quien recibe** (vista previa con nombre, teléfono y correo). Sigue «Firmar a mano en su lugar».
- **Sin firma**: aparece la tarjeta «No tienes una firma configurada» con «Agregar firma» (antes pasaba directo a firmar a mano).

## Para publicar en desarrollo
1. Backend `development` actualizado (una firma nueva toma solo sucursales libres; ya no choca con la existente).
2. Web `development` actualizada (botón «+» junto a la firma en la recepción).
3. App: rama `desarrollo`, APK 1.0.141 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.140.
