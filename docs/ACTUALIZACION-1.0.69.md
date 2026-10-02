# Logo de sucursal y Mi jornada mas compacta: APK 1.0.69 / gateway 1.0.31

Incluye todo lo de la [actualizacion 1.0.68](ACTUALIZACION-1.0.68.md).

- Cabecera: se muestra solo el logo de la sucursal (mas grande, sin nombre). Si la sucursal no tiene logo o no carga, se muestra su nombre.
- Mi perfil, Empresa actual: ya no muestra el icono generico de Qualitzer cuando la sucursal no tiene logo.
- Mi jornada: se quitan la fila "Mi jornada / Hola" y la fila "Mis asignaciones / N trabajos". La pantalla empieza en los indicadores.

## Logo de la sucursal

Antes el gateway leia el logo con `/branches/:id`, una consulta pesada con 2,5 s de limite; si tardaba o la URL tenia espacios, se usaba el logo de la empresa sin aviso. Ahora el backend informa en `/auth/me` la URL publica del logo de cada sucursal (`accessBranchs[].logoUrl`, codificada) y el gateway 1.0.31 la usa primero.

## Publicacion

Backend: publicar `src/auth/application/AuthUseCase.ts` (campo `logoUrl` por sucursal). Sin migraciones.

Detener y drenar primero la unica instancia del backend. Desde su raiz:

```bash
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.31.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. El logo se actualiza al volver a validar la sesion (al abrir la app con conexion). Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1816 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck de app, gateway y backend sin errores. Pruebas nuevas: logo informado por `/auth/me` aplicado sin consultar `/branches/:id`, y respaldo cuando no es utilizable.
