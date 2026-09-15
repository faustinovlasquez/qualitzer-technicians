# Qualitzer tecnicos 1.0.17

- Mantenimientos y OTs asignados visibles aunque aun no tengan trabajos.
- Apertura del mantenimiento completo desde su aviso, sin inventar un trabajo hijo.
- Filtros de fecha, estado y busqueda para ordenes vacias, manteniendo cero trabajos.
- El backend permite heredar los trabajos desde la responsabilidad del mantenimiento y prepara el aviso con el titulo y autor verificable. Sin autor registrado, utiliza texto neutro.

Requiere Backend de asignaciones completas y gateway 1.0.6. No requiere migraciones nuevas ni reconfigurar Firebase. La bandeja mantiene la referencia del recurso; el texto personalizado corresponde al aviso del telefono.

Instalar como actualizacion sobre la app anterior. Conservar datos, pendientes y credenciales. La firma, identificador Android y URL de API no cambian.

Validacion local: 179 pruebas enfocadas, tipos de los archivos afectados sin errores y 8 escenarios visuales con componentes reales a 360/1024 px y texto 100/200 %. Esto no acredita entrega push real ni despliegue del servidor. Las pruebas Backend no se ejecutaron por las reglas del repositorio.