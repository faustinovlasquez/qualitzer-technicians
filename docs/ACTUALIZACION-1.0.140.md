# Actualización 1.0.140 (gateway 1.0.50) — servidor de desarrollo

## Qué trae
- **Aviso «Configura tu firma»**: al entrar sin firma guardada, la app saluda («Hola, …») y explica para qué sirve la firma (entregas, recepciones en taller y documentos). «Configurar mi firma» abre el formulario; «Ahora no» no vuelve a insistir hasta reabrir la app.
- **Formulario de firma igual a la web** (también en Perfil › Firmas): 1) dibujar o cargar la firma, 2) nombre, correo y teléfono (con +56 por defecto), 3) «Todas las sucursales» (marcado por defecto) o «Solo algunas».
- **Recepción del ingreso (paso 3)**: el «Técnico que recibe» es un usuario de la sucursal, con foto o iniciales en su color, correo y la marca «Tú»; se propone al usuario en sesión. Su firma se elige sola (la predeterminada o la única) y se muestran sus datos sin editar («No registrado» si faltan). Si no tiene firma, «Agregar firma» abre el mismo formulario y la deja guardada en su perfil. Sigue disponible «Firmar a mano en su lugar».

- **Ficha del ingreso**: «Ver firma» abre el paso 3 aunque el ingreso ya esté firmado (para verla o reemplazarla), y «Editar ingreso» recorre los 3 pasos (datos → inspección → firma) como en la web; antes, una vez firmado, no había forma de llegar a la firma.

## Para publicar en desarrollo
1. Backend `development` con la migración `20261028140000-Add-UserId-To-OperationAreaEntrySignatures` y la ruta `PUT /user_signatures/users/:userId` (ya subidos). Correr las migraciones de la base de desarrollo.
2. Gateway 1.0.50 incluido en el backend (`infrastructure/mobile-gateway`): desplegar el backend con el tgz nuevo.
3. App: rama `desarrollo`, APK 1.0.140 apuntando a https://api-dev-qz-v2.qualitzer.com/api. Instalar encima de la 1.0.139 sin desinstalar ni borrar datos.
