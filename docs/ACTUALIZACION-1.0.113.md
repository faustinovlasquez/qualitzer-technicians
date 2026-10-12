# Devoluciones con cantidad: APK 1.0.113 / gateway 1.0.41

Mantiene todo lo de la [actualizacion 1.0.112](ACTUALIZACION-1.0.112.md) y agrega:

- **Devolver pregunta cuánto se devuelve**: ventana con botones − / + o la cantidad escrita (hasta lo recibido) y una nota opcional para bodega.
- **Confirmación con resumen** antes de enviar: qué se devuelve, que bodega recibe aviso y correo, que el material sigue a cargo del técnico hasta que bodega lo reciba y que lo no devuelto se considera utilizado.
- **Estado de la solicitud en cada material**: pendiente en bodega (con cantidad y nota), rechazada con el motivo de bodega (el técnico vuelve a decidir) o devuelta a bodega con la cantidad recibida.
- Con la solicitud pendiente, **Cambiar** edita la cantidad o la nota y **Utilizado** la cancela.

## Despliegue

Backend y gateway 1.0.41 juntos. Sin migraciones. Con un gateway anterior la APK sigue funcionando, pero solo puede devolver todo lo recibido y sin nota (lo indica con un mensaje).

## Verificacion local

1877 pruebas de la app y del gateway pasadas, typecheck sin errores; 424 pruebas del módulo de entregas del backend.
