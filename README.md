# Roboticlab · Gestión

Aplicación privada de facturación, finanzas y gestión de clases. Next.js, React y Supabase. Desplegada en https://gestionrl.apps.agdpanel.es sobre el VPS 185.2.101.52; se conserva la configuración original de Render como referencia. La interfaz está en español e incluye modo claro y oscuro.

La actualización de octubre de 2026 y las instrucciones del VPS están en [docs/VPS.md](docs/VPS.md). No vuelvas a ejecutar la importación original sobre una instalación en uso.

## Instalación

1. Abre el proyecto `qbiqnlhzdovdrglihttg` en Supabase y entra en **SQL Editor**. Los archivos para importar desde el navegador están en `deliverables/sql-por-partes` y en `deliverables/sql-por-partes.zip`.
2. Copia y ejecuta el contenido completo de los **29 archivos SQL numerados**, en orden desde `001_estructura_y_datos.sql` hasta `029_verificar_importacion.sql`. Sustituye todo el contenido del editor en cada paso; no acumules archivos en una misma consulta. Cada parte es una transacción independiente y muestra su confirmación. Si hay un error, detente y repite esa parte después de resolverlo. El último debe mostrar **IMPORTACION COMPLETADA**. Se incluyen tablas, permisos, funciones, administrador, datos importados, PDFs y el Excel original. No uses la aplicación hasta terminar todas las partes.
3. Ejecuta también **`migrations/030_clientes_y_hoja.sql`** (hay una copia en `deliverables`). Añade recuperación de clientes de las facturas y guardado de varias filas de la hoja. Si ya importaste los 29 archivos, ejecuta solamente esta actualización pequeña. Después descomprime `roboticlab-aplicacion.zip` y sube su contenido a un repositorio **privado** de GitHub. `package.json` y `render.yaml` deben estar en la raíz.
4. En Render, selecciona **New → Blueprint**, conecta el repositorio y utiliza el `render.yaml` incluido. Render instalará, compilará y arrancará la aplicación. El YAML por sí solo necesita el repositorio con el código.
5. Entra en la URL que asigne Render. Usuario: **admin**. Contraseña: la indicada por el propietario en esta conversación. El SQL contiene únicamente su hash bcrypt. Puedes cambiarla en Configuración → Acceso y usuarios.

La URL de Supabase y su clave pública ya están configuradas. No se necesita una clave de servicio para las funciones normales. Los datos se importan en Supabase **cuando ejecutes el SQL**, no al desplegar el frontend. La cuenta `admin` utiliza internamente `admin@roboticlab.internal`; no requiere un buzón ni envío de correo.

El SQL completo original ocupa unos 11 MB y supera el límite del SQL Editor web observado en este proyecto. Las partes tienen menos de 450 KB y reconstruyen los documentos grandes con comprobación SHA256. Como alternativa a las partes, puedes ejecutar el SQL completo con `deliverables/IMPORTAR-SUPABASE.cmd`: pide el Host de **Connect → Session pooler** y la contraseña de la base de datos (distinta de admin), sin guardarla. Requiere `psql`, ya disponible en el equipo de origen. Elige uno de los dos métodos. No publiques los SQL ni las copias de datos en GitHub.

El plan gratuito de Render puede suspender el servicio sin actividad. Para remisión fiscal automática en producción hace falta un servicio que permanezca activo. No se ha creado ni contratado ningún servicio remoto desde esta entrega.

## Funciones incluidas

- Directorio de clientes recuperados automáticamente al abrir Clientes y alumnos: completa los campos vacíos con la factura más reciente disponible y evita duplicados por NIF o referencia. No sustituye los datos que ya has editado. Cada ficha enlaza con sus facturas.
- Facturación con filtro por cliente, fechas, año y estado; búsqueda de números, NIF y conceptos sin depender de tildes; ordenación por fecha o importe y exportación de los resultados filtrados.
- Hoja mensual editable en Clases e ingresos: pestañas de meses y actividades, edición directa, Tab/Enter, pegado de bloques tabulados desde Excel, coma decimal, fila de totales y guardado conjunto de cambios. El guardado comprueba versiones y revierte todo el lote si una fila cambió en otra sesión. Las columnas de alumnos y cabeceras permanecen visibles al desplazar la hoja.
- Botón de recálculo por fila: previsto = horas × precio − pagado − anticipo para tarifas por hora. El recálculo es explícito para respetar el histórico manual. Editar pagado corrige el registro; para nuevos movimientos con fecha usa Registrar cobro o Registrar clase.

- Inicio con accesos rápidos, indicadores y actividad reciente.
- Panel financiero mensual y anual, ingresos registrados, previsiones, gastos y resumen de facturación, con exportación CSV.
- Clientes, alumnos y contactos activos o históricos.
- Borradores con múltiples conceptos, descuentos, IVA y retención IRPF. El servidor calcula y redondea los importes. Las facturas emitidas reciben numeración correlativa. Con la migración 031 se pueden editar si VeriFactu está desactivado y no tienen registro fiscal; conservan su número, estado, PDF original, cobros y auditoría. Los registros fiscales permanecen protegidos.
- Series separadas de facturas, rectificativas por diferencias y documentos de prueba. Duplicado de facturas como nuevos borradores.
- Vista imprimible A4 y descarga exacta de los PDF originales. Para guardar nuevas facturas en PDF utiliza Imprimir → Guardar como PDF.
- Cobros parciales, métodos de pago y límite de cobro por factura. Las operaciones tienen identificadores para evitar duplicados al repetir una solicitud.
- Registro mensual con actividad, tarifa, unidades, bonos, horas, pagado, anticipos, previsto, días y notas. Clases por hora calculan cargos; bonos descuentan unidades; las tarifas manuales no inventan importes.
- En Clases e ingresos, el botón «Registro mensual» debajo de cada alumno abre su ficha del mes para imprimir o guardar en PDF. Incluye las actividades del mismo contacto y periodo, días originales, resumen de horas/pagos, movimientos y cobros asociados. Guarda los cambios de la hoja antes de abrirla. No requiere SQL adicional ni acceso de los alumnos a la cuenta de administración.
- Historial de movimientos de horas, ajustes con motivo y preparación de nuevos meses con alumnos activos.
- Gastos previstos y pagados. Los previstos no reducen la tesorería hasta que se registren como pagados.
- Archivo íntegro con las 61 pestañas y sus fórmulas guardadas, PDFs y Excel original descargables.
- Auditoría de cambios, exportación JSON de datos, permisos de administración, gestión y solo lectura.
- Tema claro y oscuro, tablas adaptadas a móviles y búsqueda global.

## Importación y conciliación

| Contenido                        | Cantidad |
| -------------------------------- | -------: |
| Facturas históricas              |       20 |
| Clientes fiscales                |        7 |
| Contactos por nombre y actividad |      221 |
| Registros mensuales operativos   |    2.209 |
| Previsiones de gastos            |      621 |
| Pestañas originales              |       61 |
| Documentos originales privados   |       21 |

Las facturas suman **5.730,00 € de base**, **643,50 € de retenciones** y **5.086,50 € netos**. Tres PDFs sin texto se leyeron visualmente. Se conservan todos los originales, también cuando la cantidad y el precio impresos no son multiplicativos (por ejemplo, un precio total por ocho horas).

En octubre de 2026 los registros operativos reproducen **971,00 € pagados** y **656,00 € previstos**, coincidiendo con las celdas resumen del libro. Las fórmulas antiguas se conservan como evidencia con sus valores almacenados; no se ejecutan como código de la aplicación.

Hay nueve pestañas sin año explícito. Se ha inferido 2021 para las cinco anteriores a enero de 2022, 2023 para septiembre posterior a julio-agosto de 2023, y 2025 para octubre-diciembre posteriores a septiembre de 2025. La aplicación avisa al consultar esas hojas. Las pestañas conjuntas de julio-agosto quedan agrupadas bajo julio y no se reparten artificialmente.

Los contactos se identifican por nombre y actividad para no mezclar alumnos que comparten un teléfono. Puede haber la misma persona en dos actividades o variantes de escritura que necesiten revisión. Los teléfonos, notas y tarifas escritas como texto se conservan.

Los cuadros laterales, resúmenes repetidos y anotaciones sin relación inequívoca no se suman de nuevo a los indicadores. Se mantienen en el archivo íntegro. Las previsiones de gastos no se presentan como pagos realizados.

Los PDF no acreditan cobro. Las facturas importadas aparecen **Por conciliar**. Antes de registrar un cobro histórico, comprueba si ya figura en «Pagado» o «Anticipos» del Excel. Los cobros vinculados a clases actualizan su registro mensual y no vuelven a sumarse como ingresos independientes.

Los cobros nuevos se asignan al mes en que se reciben, aunque correspondan a clases de otro mes. Los importes históricos mantienen el mes de su pestaña, ya que el libro no ofrece siempre una fecha individual de cobro.

## VeriFactu: alcance y puesta en servicio

VeriFactu está **desactivado inicialmente**. Hay entornos separados, serie TEST, generación transaccional de registros, encadenamiento SHA-256, XML de alta y rectificación, QR, cola persistente, reintentos, control de respuestas y CSV de la AEAT. El servidor procesa la cola cada minuto y tras emitir una factura; respeta el intervalo indicado por AEAT. Los registros históricos no se remiten automáticamente.

Se han comprobado el ejemplo oficial de hash y los XML de alta/rectificación contra los XSD oficiales descargados. **No se han realizado envíos reales a AEAT ni pruebas con certificado**, y no se entrega una declaración responsable firmada del productor. No debe presentarse esta versión como un SIF de conformidad fiscal acreditada. El modo desactivado tampoco implementa la modalidad reglamentaria NO VERI*FACTU.

El alcance actual de remisión es factura completa nacional F1 y rectificativas R1/R4 por diferencias, IVA ordinario y exención E1 del artículo 20. No incluye facturas simplificadas, destinatarios extranjeros, recargo de equivalencia, regímenes especiales, anulación de registros ni subsanación de rechazos como nuevos eventos. Los rechazos y aceptaciones con errores se conservan y requieren revisión técnica: no se alteran ni se finge que hayan sido aceptados.

**Antes de utilizar producción hay que completar las operaciones fiscales aplicables que falten, verificar el sistema completo en pruebas externas y obtener la declaración responsable del productor.** El interruptor de producción tiene un bloqueo técnico deliberado hasta completar los requisitos; poner una variable a `true` no acredita por sí solo el cumplimiento.

Variables privadas en Render para preparar las pruebas:

| Variable                        | Uso                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`     | Clave de servicio del proyecto, solo en servidor                        |
| `VERIFACTU_PFX_BASE64`          | Certificado PFX codificado en base64                                    |
| `VERIFACTU_PFX_PASSWORD`        | Contraseña del certificado                                              |
| `VERIFACTU_PRODUCER_NAME`       | Nombre real del productor del sistema                                   |
| `VERIFACTU_PRODUCER_NIF`        | NIF del productor                                                       |
| `VERIFACTU_INSTALLATION`        | Identificador estable de instalación; por defecto ROBOTICLAB-01         |
| `VERIFACTU_DECLARATION_URL`     | Referencia a la declaración responsable definitiva                      |
| `VERIFACTU_ALWAYS_ON`           | `true` únicamente con servicio permanentemente activo                   |
| `VERIFACTU_PRODUCTION_APPROVED` | `true` únicamente tras completar y validar la puesta en servicio fiscal |

No introduzcas certificados ni claves privadas en campos `NEXT_PUBLIC_*`. La configuración de remisión se cambia desde la aplicación y se verifica en el servidor. Tras comenzar producción se impide abandonar la remisión durante ese año natural. No se permite cambiar de entorno mientras existan envíos pendientes. La declaración, el certificado y la identidad del productor no se inventan ni vienen incluidos.

Fuentes oficiales: [información técnica AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html), [especificación de huella](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf), [servicios web](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf), [QR](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf), [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [Blueprints de Render](https://render.com/docs/blueprint-spec).

## Desarrollo y comprobaciones

Requiere Node.js 22. Copia `.env.example` como `.env.local`, ejecuta `npm ci` y `npm run dev`. Para producción: `npm run build` y `npm start`.

```sh
npm run typecheck
npm test
npm run build
```

El SQL completo se ha ejecutado y repetido en PostgreSQL embebido (PGlite), comprobando RLS, permisos, redondeo, numeración, inmutabilidad, cobros, horas y encadenamiento fiscal. Las pruebas de navegador usan un adaptador local de Supabase: no crean usuarios ni modifican el proyecto remoto. La conexión al servicio Auth remoto se ha verificado por lectura, HTTP 200.

Los scripts locales de importación y las fuentes privadas no son necesarios para desplegar. No se han subido datos al proyecto remoto: los cargará el SQL que ejecutará el propietario. Las copias JSON de la aplicación no sustituyen una copia completa de Supabase con sus usuarios y credenciales.

Para repetir las pruebas del SQL, coloca el archivo entregado en `deliverables/supabase-roboticlab.sql` y ejecuta `npm run test:db`. Se usa una base temporal local, nunca el proyecto Supabase real.

### Actualización automática en el VPS

AGD Cloud sigue `DCK222/GestionRL`, rama `main`. Al hacer `git push origin main`, construye el Dockerfile y publica la nueva versión si supera las comprobaciones de salud y HTTPS. El progreso se consulta en [Gestión RL en AGD Cloud](https://panel.agdpanel.es/applications/cmvf84q9x000dq501d6mxpe92). Las migraciones SQL de Supabase se aplican por separado; no se ejecutan al hacer push.
