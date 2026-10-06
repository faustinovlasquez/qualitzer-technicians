# Confirmacion de materiales y aviso push: APK 1.0.81 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.80](ACTUALIZACION-1.0.80.md) y corrige:

- **Confirmar recepcion fallaba con "No se pudo confirmar".** Al pedir la ubicacion, el dialogo del sistema saca la app un instante de primer plano y la confirmacion se cancelaba. Ahora espera a que la app vuelva (hasta 3 s) y continua.
- El mensaje de error ahora incluye un codigo (por ejemplo "codigo: UPSTREAM_UNAVAILABLE") para identificar la causa si vuelve a ocurrir.
- El aviso de materiales se abre directamente en la pestana Materiales, tambien desde Mi perfil.

## Backend (requiere desplegar)

- El push de materiales no se enviaba a telefonos registrados antes de existir esa preferencia. Ahora esta activo salvo que el tecnico lo desactive.
- Texto del aviso: "<quien entrega> te pide confirmar N materiales (CE-xxxx). Toca para revisarlos." o un resumen si hay varias entregas.
- El push se calcula cada 2 minutos y solo si la sucursal tiene activas las notificaciones de entregas de inventario.

## Verificacion local

1834 pruebas de la app y del gateway pasadas, typecheck sin errores. Backend: pruebas de notificaciones moviles pasadas (1 fallo previo no relacionado) y 3 nuevas del mensaje.
