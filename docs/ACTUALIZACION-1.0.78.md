# Cronometro offline visible, privacidad y salida del demo: APK 1.0.78 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.77](ACTUALIZACION-1.0.77.md) y agrega:

- **Cronometro offline en la tarjeta.** Al iniciar un trabajo sin conexion, la tarjeta muestra "En curso" y el reloj avanza segundo a segundo desde la hora en que se toco Iniciar. Antes quedaba en 00:00:00 y "Pendiente" hasta que el servidor confirmaba. Una accion local que requiere revision no se muestra como estado vigente.
- **Politica de privacidad** accesible desde el inicio de sesion y desde Mi perfil. La direccion se configura con `PRIVACY_POLICY_URL` en el .env (por defecto https://qualitzer.com/politica-de-privacidad).
- **Salir del modo demostracion** con el boton "Salir" de la franja amarilla.

Actualizar la APK sin desinstalar la anterior; la cola local se conserva.

## Verificacion local

1831 pruebas de la app y del gateway pasadas, typecheck sin errores.
