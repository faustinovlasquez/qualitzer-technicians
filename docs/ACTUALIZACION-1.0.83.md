# Nuevo diseño de Materiales: APK 1.0.83 / gateway 1.0.34

Mantiene todo lo de la [actualizacion 1.0.82](ACTUALIZACION-1.0.82.md) y rediseña la pestaña Materiales:

- Pestañas **Por confirmar** y **Confirmadas** con contador, buscador (OT, equipo, código o material), selector de bodega y filtro por origen (OT, mantenimiento u otras).
- Cada entrega es una tarjeta plegable con estado, código CE, fecha, hora y tiempo transcurrido, número de OT y equipo, quién entrega, bodega, destino, cliente y nota.
- Cada material muestra foto (o ícono), código, nombre, descripción con "Leer más", precio unitario y cantidad. Desde el cuarto material se agrupan en "Ver N materiales más".
- Las casillas sirven para revisar lo recibido. "Confirmar todo" registra la recepción de la entrega completa y, si falta marcar algún material, pide confirmarlo antes.
- En **Confirmadas** cada material se marca como **Utilizado** o **Devolver** durante 7 días desde la confirmación. Al vencer el plazo, lo no devuelto queda como utilizado. Bodega ve las solicitudes de devolución en el historial del comprobante y las registra con la devolución normal, que repone stock.

## Servidor

Requiere el backend con `GET /inventory_consumptions_v2/my-receipts?status=CONFIRMED` y `POST /inventory_consumptions_v2/my-receipts/:id/dispositions`, más el gateway 1.0.34. Sin migraciones: la marca se guarda en el documento de la entrega.

## Verificacion local

1840 pruebas de la app y del gateway pasadas, typecheck sin errores. Backend: 8 pruebas nuevas de Utilizado/Devolver y tsc sin errores.
