# Gestión RL en el VPS

Actualizado el 19 de octubre de 2026.

## Acceso y arquitectura

- Aplicación: https://gestionrl.apps.agdpanel.es
- Servidor: `185.2.101.52`, Ubuntu, Docker y Traefik existentes.
- Panel: https://panel.agdpanel.es/applications/cmvf84q9x000dq501d6mxpe92
- Proyecto: **Gestión RL**, aplicación **Gestión RL**, entorno **Production**, servidor **Contabo · vmi3674445**.
- Aplicación gestionada por el agente de AGD Cloud: `cmvf84q9x000dq501d6mxpe92`. Despliegue inicial: `cmvf86fh8001hq501hndvdodp`.
- Contenedor inicial: `agd-app-cmvf84q9x000dq501d6mxpe92-cmvf86fh8001hq501hndvdodp`. Usuario `101:101`, raíz de solo lectura, 768 MiB, un CPU, red propia y sin puerto publicado al exterior.
- Imagen verificada: `sha256:6b8149090447b7bcf1d4dbc93eb866725c8d9f17e29010906c4086a10a6538e9`. Es exactamente la imagen de la versión corregida `20261019-2`; el agente comprueba su identidad antes de iniciarla.
- Configuración HTTPS gestionada: `/opt/agd-cloud/infrastructure/traefik/dynamic/cmvf84q9x000dq501d6mxpe92.yml`.
- Base de datos y autenticación: proyecto Supabase `qbiqnlhzdovdrglihttg`, el mismo que usaba Render. Se mantienen cuentas, contraseñas y datos. No se ha creado otra base local.
- Las variables de ejecución están cifradas en AGD Cloud y tienen ámbito exclusivo de esta aplicación. Se verificó que sus valores coincidían con los del contenedor anterior.
- El panel administra despliegues, inicio, parada, reinicio y registros. Repositorio **DCK222/GestionRL**, rama **main**, autodeploy activado. Cada push a main inicia la compilación del Dockerfile en el constructor aislado; solo se publica cuando pasan salud, DNS y HTTPS. Un commit o guardado local no basta: hay que hacer push.
- El contenedor independiente `gestionrl-web` se retiró tras comprobar la nueva ruta HTTPS. Su imagen y código en `/opt/gestionrl/current` se conservan para recuperación. Las rutas independientes se guardan fuera del directorio activo de Traefik, en `/opt/gestionrl/gestionrl.standalone.yml` y `gestionrl.standalone.low-priority.yml`.

## Correcciones incluidas

- Una renovación de sesión del mismo usuario no reinicia el espacio de trabajo. Cambiar de usuario sí limpia el estado para no mezclar datos.
- Una lectura fallida muestra un aviso y permite reintentar sin desmontar la pantalla ni sus modales. Las respuestas antiguas de cargas solapadas se descartan; las lecturas tienen límite de espera.
- El editor de facturas aparece sobre su vista previa. Pulsar fuera del diálogo no lo cierra. Cerrar, Escape o Cancelar piden confirmación si se ha modificado el formulario; se impide cerrar un formulario mientras guarda.
- Sin VeriFactu y sin registro fiscal, se pueden editar documentos emitidos e importados. La base comprueba la regla, permisos y versión; el botón no es el único control.
- Se conservan número, estado, entorno, tipo, emisor, PDF original y cobros. Una edición no puede dejar el total por debajo de cobros existentes ni cambiar el año de una factura numerada. Los cambios quedan auditados.
- Tener un registro fiscal bloquea la modificación aunque se desactive VeriFactu posteriormente.
- Cada nuevo borrador conserva un UUID durante los reintentos. Los guardados simultáneos o repetidos con una versión anterior se rechazan y explican cómo recargar.
- El servidor recalcula importes y descarta bases, totales o indicadores históricos enviados por el navegador. Se validan líneas, números finitos e IRPF.
- Un aviso de envío fiscal pendiente ya no se sustituye inmediatamente por un mensaje de éxito.

La migración incremental `migrations/031_estabilidad_facturas.sql` ya se ejecutó en el proyecto real. La comprobación posterior comparó las 22 facturas con su copia previa: mismo contenido excepto la nueva columna `version`. VeriFactu seguía desactivado y había cero registros fiscales. No se han emitido facturas ni registrado cobros reales durante las pruebas.

## Copia anterior a la migración

Existe una copia privada en `rl_maintenance.invoice_review_20261019`, sin permisos para `anon` ni `authenticated`. Contiene las 22 facturas, configuración y definiciones de las dos funciones anteriores. También se descargó como CSV en Descargas. Es una copia puntual de lo afectado, **no un respaldo completo ni automático de la base**: no sustituye una política de copias que incluya alumnos, clases, documentos y usuarios.

`migrations/rollback_031_functions.sql` restaura únicamente las dos funciones anteriores desde esa copia. No borra la columna `version` ni revierte ediciones posteriores de facturas. Se debe coordinar con la versión de frontend que se vaya a usar. No ejecutes la importación inicial para volver atrás.

## Operación

Usa la ficha de **Gestión RL** en AGD Cloud: **General** contiene los controles de ejecución; **Despliegues** y **Logs** permiten revisar el estado. **Desplegar** construye y publica manualmente el último commit de la rama configurada; los pushes a main ya lo hacen automáticamente. Las variables se editan en **Variables y secretos**, con ámbito **Gestión RL**, y se aplican al siguiente despliegue.

Para consultar el contenedor activo por SSH sin depender de su ID de despliegue:

```sh
docker ps --filter label=agd.application=cmvf84q9x000dq501d6mxpe92
curl --fail -i https://gestionrl.apps.agdpanel.es/api/health
```

La respuesta incluye `X-AGD-Deployment`, que debe coincidir con el despliegue publicado en el panel. El proceso del agente usa `/api/health` para validar el contenedor antes de publicar la ruta.

Las variables `NEXT_PUBLIC_SUPABASE_*` son públicas y deben estar disponibles durante compilación y ejecución; modificarlas exige recompilar. No deben incluirse claves privadas como argumentos de compilación. No se ha activado VeriFactu ni instalado un certificado fiscal.

Para actualizar código:

```sh
git add <archivos-modificados>
git commit -m "Describe el cambio"
git push origin main
```

El webhook firmado de la GitHub App existente avisa al panel. El historial muestra el commit, los registros de compilación y el estado final. No se han añadido credenciales de escritura ni una clave SSH al repositorio. Un fallo de compilación mantiene la versión publicada anterior. Puedes recuperar una imagen anterior desde el historial de despliegues.

La configuración usa `Dockerfile`, raíz del repositorio, puerto 3000 y `/api/health`. Las dos variables públicas `NEXT_PUBLIC_SUPABASE_*` están configuradas también como argumentos de compilación. Las variables privadas solo corresponden a ejecución. No hay comando de preparación de datos: **las migraciones SQL de Supabase requieren revisión y aplicación por separado**; un push no ejecuta importaciones ni modifica automáticamente las facturas.

La imagen local inicial se conserva para recuperación. Las nuevas imágenes las construye el agente con identidad inmutable y comprobaciones de pertenencia a la aplicación. No es necesario ampliar la lista de imágenes autorizadas en cada actualización.


La instalación Compose conservada en `/opt/gestionrl/current` es solo una vía de recuperación. No ejecutar `compose up` como procedimiento normal: crearía otra instancia fuera del panel. Si fuera necesario volver a ella, coordinar la parada de la app gestionada, el arranque de Compose y la restauración de la ruta independiente; comprobar HTTPS y retirar la ruta alternativa para no dejar dos instancias publicadas.

## Validación

- `npm test`: 16 pruebas, incluyendo una prueba de integración SQL con múltiples casos de edición, versiones, cobros, auditoría, permisos y protección fiscal.
- `npm run typecheck` y compilación de producción dentro de Docker.
- `npm run test:workspace`: recuperación de clientes, edición atómica de hojas y conflictos de versiones.
- Navegador con `scripts/local-fixture.mjs`: base temporal con datos ficticios; crear, guardar, emitir y editar una factura; comprobar el orden de modales, la conservación al trabajar con otra pestaña y la recuperación de lecturas fallidas.
- HTTPS público devuelve 200 en salud y en la página principal. La cabecera identifica el despliegue del panel. Imagen y variables comparadas con la versión anterior; permisos y aislamiento del contenedor verificados. Futgard y AulaLab continúan activos.

Para la prueba local aislada: `node scripts/local-fixture.mjs`, abrir `http://127.0.0.1:3101`. El servidor de prueba solo escucha en loopback y no usa la base real. No se incluye en la imagen Docker.
