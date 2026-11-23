# Comandos de Discord

Referencia de los 22 comandos slash del bot, sacada de las definiciones `SlashCommandBuilder` de `src/commands/player/` y `src/commands/staff/`. `npm run test:commands` valida que todas cargan y son aceptables para Discord.

Convenciones:

- **Obligatoria** = la opción es `required`. Las demás son opcionales.
- **Autocompletado** = Discord ofrece sugerencias mientras se escribe; el valor enviado es el identificador interno.
- **Quién**: «Jugador» = cualquier persona con personaje vivo (los comandos de consulta fallan con «No tienes un personaje vivo» si no lo hay); «Rolepriest» = rol de `config.json` → `roles.staff` (el resto recibe «Necesitas permisos de Rolepriest»).
- **Efímera** = solo la ve quien ejecuta el comando; **pública** = se publica en el canal.
- «Confirmación» = botones Confirmar/Cancelar efímeros con 60 s de plazo.
- Un Rolepriest no puede aplicar a su propio personaje las altas, bajas y correcciones de `/bienes-admin`, `/npcs-admin`, `/propiedades-admin`, `/perfil-admin` y `/magia-admin`.
- Los comandos del terminal web (`/staff/terminal`) ejecutan los mismos comandos slash a través de un `terminal_job` que procesa el bot.

## Jugador

### /ayuda
Guía rápida de los comandos de jugador. Sin opciones. Efímera.

### /personaje
Crea y gestiona el personaje.

- `crear`: abre un formulario (nombre, edad) y luego menús para elegir género (hombre o mujer) y raza, con un botón «Crear personaje». Falla si ya tienes personaje o si no ha terminado la espera de 336 h desde la muerte del anterior. Al crear se abre el canal de modmail privado y se asigna el rol identificativo (`roles.characterCreated`). Efímero.
- `foto`: cambia la foto del personaje.
  - `imagen` (adjunto, obligatoria): PNG, JPG, WEBP o GIF, máximo 2 MB. Efímera.
- `historial`: nombres de los personajes que has tenido (los 25 más recientes).
  - `jugador` (usuario): solo Rolepriest, para ver el de otro. Efímera.

### /perfil
Ficha del personaje: estadísticas base y efectivas, puntos libres, raza, menhir, Magia, estado civil, y botones para pasar a NPCs, Bienes, Propiedades, Escuelas y Conjuros. Según el estado aparecen los botones «Asignar puntos» (si quedan puntos libres), «Elegir menhir» (si no tienes o ya pasaron 6 meses), «Proponer matrimonio» y «Divorciarse».

- `jugador` (usuario): solo Rolepriest, para ver a otro. Con ese objetivo no hay botones de acción.

Efímera. Asignar puntos y elegir menhir piden confirmación y son irreversibles (el menhir, durante 6 meses).

### /npcs
- `ver`: tus NPCs agrupados por nombre, 10 por página.
  - `jugador` (usuario): solo Rolepriest.
- `traspasar`: ofrece NPCs a otro jugador; tiene que aceptar.
  - `destinatario` (usuario, obligatoria).
  - `nombre` (texto, obligatoria, autocompletado): nombre del NPC que tienes.
  - `cantidad` (entero 1 a 50, obligatoria).

El traspaso crea una solicitud (ver `/solicitudes`). Efímera.

### /bienes
- `ver`: tus bienes por categoría, 10 por página.
  - `jugador` (usuario): solo Rolepriest.
- `traspasar`: ofrece bienes a otro jugador; tiene que aceptar.
  - `destinatario` (usuario, obligatoria).
  - `objeto` (entero, obligatoria, autocompletado): bien a traspasar.
  - `cantidad` (número, obligatoria, mínimo 0,01, hasta 2 decimales).

Efímera.

### /propiedades
- `ver`: tus propiedades, 10 por página.
  - `jugador` (usuario): solo Rolepriest.
- `traspasar`: ofrece una propiedad a otro jugador; tiene que aceptar.
  - `destinatario` (usuario, obligatoria).
  - `propiedad` (entero, obligatoria, autocompletado).

Efímera.

### /escuelas
- `ver`: nivel en cada escuela, siguiente meta, umbral, si hace falta mentor, enfriamiento y Magia total.
  - `jugador` (usuario): solo Rolepriest.
- `iniciar`: usa tu escuela gratuita (Autismo efectivo 6 o más, una sola vez por personaje).
  - `escuela` (texto, obligatoria, autocompletado). Te deja en nivel Principiante (nivel 1).

Efímera.

### /conjuros
Conjuros desbloqueados por tu nivel en cada escuela, 10 por página.

- `escuela` (texto, autocompletado): filtra por escuela.
- `jugador` (usuario): solo Rolepriest.

Efímera.

### /matrimonio
- `proponer`: propón matrimonio a otro personaje vivo. Pide confirmación; el destinatario recibe la propuesta por MD y la acepta o rechaza (también desde `/solicitudes`). Caduca a las 24 h.
  - `usuario` (usuario, obligatoria). Sin esta opción el bot lo pregunta con un selector.
- `divorciar`: te divorcias de tu cónyuge. Pide confirmación (irreversible) y avisa al cónyuge por MD. Sin opciones.

Efímera.

### /solicitudes
Lista tus solicitudes pendientes: las recibidas (con botones para aceptar o rechazar) y las enviadas (con botón para cancelar). Cubre traspasos de bienes, NPCs y propiedades, y propuestas de matrimonio. Sin opciones. Efímera.

### /dado
Tira un dado libre; la tirada se publica en el canal. Exige personaje vivo.

- `caras` (entero): `6` (por defecto), `12`, `20` o `100`. No hay D10.

Pública.

## Rolepriest

Todas exigen el rol de Rolepriest. Salvo que se indique, la respuesta es efímera.

### /perfil-admin
Corrige el perfil de un jugador. Todas las subórdenes excepto `cooldown-creacion` exigen un personaje vivo que no sea el tuyo.

- `raza`: cambia la raza. Pide confirmación (altera las estadísticas efectivas).
  - `jugador` (usuario, obligatoria), `raza` (texto, obligatoria, autocompletado).
- `menhir`: fija o quita el menhir sin esperar los 6 meses. No reinicia la espera si ya tenía uno.
  - `jugador` (obligatoria), `menhir` (texto, obligatoria, autocompletado; «Quitar menhir» lo borra).
- `puntos-extra`: concede puntos extra de estadística.
  - `jugador` (obligatoria), `cantidad` (entero 1 a 100, obligatoria).
- `corregir-stat`: fija el valor base de una estadística. Pide confirmación.
  - `jugador` (obligatoria), `estadistica` (potencia, intuicion, chiripa, autismo, resistencia, donjuanismo o agilidad; obligatoria), `valor` (entero 0 a 6, obligatoria). No puede dejar la suma por encima de 8 más los puntos extra.
- `identidad`: edita nombre, edad o género.
  - `jugador` (obligatoria), `nombre` (texto, máx. 191), `edad` (entero 1 a 1000), `genero` (hombre o mujer). Hay que indicar al menos uno.
- `anular-matrimonio`: anula el matrimonio vigente. Pide confirmación; queda como «anulación».
  - `jugador` (obligatoria).
- `cooldown-creacion`: horas de espera para crear personaje tras perder el anterior (por defecto 336).
  - `horas` (número, mínimo 0): nuevo valor, 0 = sin espera. Sin valor, solo consulta.

### /bienes-admin
Gestiona el catálogo de bienes y los inventarios.

- `tipo-crear`: `nombre` (obligatoria, máx. 191), `categoria` (autocompletado), `emoji`, `descripcion` (máx. 2000).
- `tipo-editar`: `tipo` (entero, obligatoria, autocompletado), más `nombre`, `categoria`, `emoji`, `descripcion`.
- `tipo-desactivar` y `tipo-activar`: `tipo` (obligatoria, autocompletado). Un tipo desactivado no se puede dar ni traspasar.
- `categoria-crear`: `nombre` (obligatoria), `emoji`, `descripcion`.
- `dar`: `jugador` (obligatoria), `objeto` (obligatoria, autocompletado), `cantidad` (número, mínimo 0,01, obligatoria).
- `quitar`: mismas opciones que `dar`. Pide confirmación.
- `transferir`: `origen` (usuario), `destino` (usuario), `objeto`, `cantidad`; todas obligatorias. Mueve bienes en una sola transacción, sin que el destinatario acepte.
- `catalogo`: lista todos los tipos de bien, activos o no.

### /npcs-admin
- `alta`: `jugador` (obligatoria), `nombre` (texto, máx. 80, obligatoria), `cantidad` (entero 1 a 50, obligatoria).
- `baja`: `jugador`, `nombre` (autocompletado), `cantidad`; todas obligatorias. Pide confirmación.
- `transferir`: `origen`, `destino`, `nombre`, `cantidad`; todas obligatorias.

### /propiedades-admin
Gestiona el catálogo de propiedades y las de los jugadores.

- `tipo-crear`: `nombre` (obligatoria), `categoria` (obligatoria: vivienda, ganaderia, infraestructura, ocio, produccion, extraccion, religion, educacion, naval o terreno), `emoji`, `descripcion`.
- `tipo-editar`: `tipo` (obligatoria, autocompletado), más `nombre`, `categoria`, `emoji`, `descripcion`.
- `tipo-desactivar` y `tipo-activar`: `tipo` (obligatoria).
- `otorgar`: `jugador` (obligatoria), `tipo` (obligatoria, autocompletado), `nombre` (máx. 191), `nivel` (entero 1 a 1000, por defecto 1), `ubicacion` (máx. 100, texto libre informativo).
- `revocar`: `propiedad` (entero, ID, obligatoria). Pide confirmación. No funciona si la propiedad es tuya.
- `nivel`: `propiedad` (ID), `nivel` (1 a 1000); ambas obligatorias.
- `transferir`: `propiedad` (ID) y `destino` (usuario); ambas obligatorias.
- `catalogo`: lista todos los tipos de propiedad, activos o no.

### /magia-admin
Gestiona el progreso mágico. No se puede usar sobre uno mismo.

- `tirada`: autoriza y resuelve una tirada de ascenso de escuela. El bot tira el D20, suma el modificador (Autismo efectivo más la estadística secundaria de la escuela), compara con el umbral y, si pasa, sube el nivel; si falla, abre el enfriamiento de 28 días. La respuesta es **pública**.
  - `jugador` (obligatoria), `escuela` (obligatoria, autocompletado), y un mentor: `mentor` (usuario, otro jugador, el bot comprueba su nivel) o `mentor_npc` (texto, máx. 80, un NPC cuyo valor valida el Rolepriest). Todos los niveles exigen mentor.
- `fijar`: fija el nivel de un jugador en una escuela.
  - `jugador`, `escuela`, `nivel` (entero 0 a 5); todas obligatorias. Pide confirmación solo cuando baja el nivel.

### /kill
Muerte definitiva inmediata (permadeath), también si el personaje estaba en gracia.

- `jugador` (usuario, obligatoria), `motivo` (texto): se avisa al jugador por MD.

Vacía inventarios, estadísticas, raza, menhir y progreso mágico; deja la instantánea en el registro y anuncia en `channels.announcements`. **Pública.**

### /revive
Revive un personaje en gracia (7 días tras salir del servidor). Devuelve el personaje intacto; no se puede revivir una muerte definitiva. **Pública.**

- `jugador`: `jugador` (usuario, obligatoria).
- `personaje_id`: `id` (entero, ID interno del personaje, obligatoria).

### /periodico
Gestiona los canales-periódico (imprenta).

- `categoria`: `categoria` (canal de tipo categoría, obligatoria). Fija dónde se crean los canales. Respuesta pública.
- `abrir`: abre la imprenta de un jugador. `jugador` (obligatoria), `nombre` (texto, máx. 80, obligatoria; letras, números o guiones). Crea el canal-periódico del jugador.

### /broadcast
Manda un MD a todos los jugadores registrados con una cabecera de aviso de Staff.

- `mensaje` (texto, máx. 1500, obligatoria).
- `imagen1` a `imagen4` (adjuntos): imágenes opcionales; solo se aceptan imágenes.

El resumen (enviados, fallidos) es efímero. También se puede enviar desde el terminal web.

### /modmail-categoria
Gestiona las categorías donde se crean los canales privados de personaje (Discord limita a 50 canales por categoría).

- `crear`: `nombre` (texto, obligatoria). Crea y registra la categoría.
- `listar`: lista las categorías registradas y cuántos canales tiene cada una.

### /modmail-relink
Enlaza un canal de Discord ya existente como canal de modmail de un jugador, conservando su historial.

- `jugador` (usuario, obligatoria), `canal` (canal de texto, obligatoria).

## Modmail por mensaje directo

No es un comando: cuando un jugador con personaje escribe un MD al bot, el mensaje se retransmite a su canal de modmail, y lo que el Rolepriest escribe en ese canal llega al jugador por MD. Un MD de alguien sin personaje recibe una respuesta que le indica `/personaje crear`.
