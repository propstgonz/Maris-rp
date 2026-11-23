# Guía de Staff — Rolepriest

Esta guía es para quien modera la partida: qué hace el bot por su cuenta, qué decide un Rolepriest y con qué comando. Las reglas salen de *El Tomegrama*; el bot guarda las fichas y aplica las reglas mecánicas, y el Rolepriest arbitra todo lo demás. La referencia completa de comandos está en `docs/COMANDOS.md` del repositorio; las decisiones de interpretación, en `docs/ADR.md`. Para lo que ve un jugador, ver `PLAYER_GUIDE.md` o `/ayuda` en Discord.

---

## Roles y principios

- Solo hay **un** rol de moderación: **Rolepriest**. Se configura en `config.json`, en `roles.staff` (puede haber varios IDs; todos dan la misma autoridad). Un jugador sin ese rol solo usa los comandos de jugador.
- **Un Rolepriest no actúa sobre su propio personaje** (Reglamento al Lorepriest, regla 2). `/bienes-admin`, `/npcs-admin`, `/propiedades-admin`, `/perfil-admin` y `/magia-admin` rechazan que el objetivo seas tú. Si necesitas un cambio en tu ficha, pídeselo a otro Rolepriest.
- **Privacidad** (Reglamento al Usuario, regla 3): cada jugador ve solo lo suyo y en respuestas efímeras. Tú puedes ver a cualquiera pasando `jugador:` en `/perfil`, `/npcs ver`, `/bienes ver`, `/propiedades ver`, `/escuelas ver` y `/conjuros`.
- **Todo queda auditado.** Cada cambio escribe una fila en el registro (sección Registro del panel) con quién lo hizo y desde dónde, Discord o web.
- Las acciones difíciles de revertir piden confirmación con botones. Tienes 60 segundos.

---

## Perfil y PICARDA

El personaje tiene siete estadísticas: Potencia, Intuición, Chiripa, Autismo, Resistencia, Donjuanismo y Agilidad.

- Cada jugador reparte **8 puntos base** a su ritmo, con un máximo de **6 por estadística**. Puede dejar puntos sin gastar. Lo asignado no lo puede deshacer el jugador.
- La **estadística efectiva** es la base más el bono de raza más el bono de menhir. Puede pasar de 6 o quedar negativa (es la advertencia de la pág. 39 del Tomegrama). Las tiradas de magia usan la efectiva.
- Los **puntos extra** solo los concede un Rolepriest, porque el Tomegrama los considera muy difíciles de conseguir: `/perfil-admin puntos-extra`.
- Para corregir un error: `/perfil-admin corregir-stat` fija la base de una estadística (de 0 a 6, sin dejar la suma por encima de 8 más los puntos extra) y `/perfil-admin identidad` cambia nombre, edad o género.
- El jugador crea su personaje con `/personaje crear` (nombre, edad, género y raza). Con la creación se abre su canal de modmail y recibe el rol identificativo.
- Cada personaje tiene una **Magia** que sale de el Autismo efectivo: 25 por punto, con un tope literal de 150 más 25 por el bono racial de Autismo (150, 175 o 200). El Menhir del Mago suma 50 aparte; el Menhir Ritual convierte toda la Magia en Vida (Magia entre 100). No se guarda: se calcula al mostrarla.

---

## Razas

Hay 10 razas: Nórdico, Imperial, Bretón, Guardia Rojo, Bosmer, Aldmer, Dunmer, Orsimer, Argoniano y Khajiita, con los bonos y penalizaciones de las págs. 37-39.

- El jugador elige raza al crear el personaje y **no puede cambiarla**.
- Un Rolepriest puede corregirla con `/perfil-admin raza` (pide confirmación, porque cambia las estadísticas efectivas).

---

## Menhires

Hay 11 menhires (págs. 56-57). Un jugador **solo puede tener uno**.

- Guerrero (+1 Potencia), Ladrón (+1 Agilidad), Mago (+50 de Magia), Atronach, Amante, Torre (+1 Resistencia), Dama (+1 Intuición), Ritual (la Magia pasa a Vida), Ofidio (+1 Chiripa e inmunidad a Ilusiones), Sombrío y Aprendiz (+1 Autismo).
- Atronach, Amante, Sombrío y la inmunidad del Ofidio son efectos narrativos: el bot solo muestra el texto y los arbitras tú.
- El jugador elige menhir desde el botón «Elegir menhir» de `/perfil`. Después **debe esperar 6 meses** para cambiarlo. El bot lo impide con una sola sentencia atómica, así que no hay forma de saltarse la espera con dos clics simultáneos.
- `/perfil-admin menhir` fija o quita un menhir **sin esperar**. Corregir un menhir ya existente no reinicia los 6 meses; asignar uno a quien no tenía sí empieza a contarlos.

---

## Matrimonio

El Tomegrama no define estados civiles; el proyecto usa el matrimonio.

- Todo jugador es **Soltero/a** por defecto. Pasa a **Casado/a** cuando propone matrimonio a otro personaje vivo y este acepta (`/matrimonio proponer`; el destinatario recibe un MD o lo resuelve en `/solicitudes`). La propuesta caduca a las 24 horas.
- Es monógamo: nadie puede estar casado con dos personas. Cualquiera de las dos partes puede divorciarse (`/matrimonio divorciar`).
- Si un cónyuge muere definitivamente, el otro queda **Viudo/a**. Quien muere no queda viudo de sí mismo si más tarde crea otro personaje.
- Un Rolepriest puede anular un matrimonio con `/perfil-admin anular-matrimonio` (queda registrado como anulación).

---

## Los tres inventarios

Cada jugador tiene tres inventarios independientes. Todos pertenecen a un personaje vivo.

- **NPCs**: sin estadísticas. Cada fila es un NPC con nombre y se agrupan por nombre. Las unidades de población, los rangos o los oficios se expresan en el nombre.
- **Bienes**: cantidades con hasta 2 decimales (el Tomegrama usa 0,5 de hierro o toneladas de comida). Se clasifican en categorías y tipos del catálogo. Las Platas son un bien de la categoría Moneda; el ganado, de la categoría Ganado.
- **Propiedades**: edificios, barcos y terrenos, con nombre opcional, nivel y ubicación en texto libre. Los barcos, galeras y buques son propiedades de categoría naval. El bot no hace cumplir límites por ciudad: la ubicación es informativa.

### Altas, bajas y traspasos

Las adquisiciones del Tomegrama se resuelven con dados y arbitraje del Lorepriest; el bot **registra el resultado**.

- **Alta** (el jugador gana algo): `/npcs-admin alta`, `/bienes-admin dar`, `/propiedades-admin otorgar`.
- **Baja**: `/npcs-admin baja`, `/bienes-admin quitar`, `/propiedades-admin revocar`. Las tres piden confirmación y no se pueden deshacer.
- **Transferencia forzada** de un jugador a otro, sin que el destinatario acepte: `/npcs-admin transferir`, `/bienes-admin transferir`, `/propiedades-admin transferir`. Se mueve en una sola transacción: o llega todo o no se mueve nada.
- **Traspaso entre jugadores**: lo inicia un jugador con `/npcs traspasar`, `/bienes traspasar` o `/propiedades traspasar`. El destinatario recibe un MD y debe aceptar (también desde `/solicitudes`). Caduca a las 24 horas. Cada pareja puede tener como máximo 5 solicitudes pendientes entre sí.
- Si al aceptar el origen ya no tiene lo que ofrecía, la solicitud se cancela y no se mueve nada.

### Catálogos

Los tipos de bien y de propiedad viven en catálogos que gestiona el Rolepriest.

- Bienes: `/bienes-admin tipo-crear`, `tipo-editar`, `tipo-desactivar`, `tipo-activar`, `categoria-crear` y `catalogo` para verlo todo.
- Propiedades: `/propiedades-admin tipo-crear`, `tipo-editar`, `tipo-desactivar`, `tipo-activar` y `catalogo`. Las categorías de propiedad son un conjunto cerrado: vivienda, ganadería, infraestructura, ocio, producción, extracción, religión, educación, naval y terreno.
- Un tipo desactivado no se puede dar ni traspasar, pero lo que ya está en los inventarios se conserva.
- **Catálogo opcional del Tomegrama**: el repositorio incluye un script que carga (sin duplicar) los bienes y edificios que nombra el PDF, entre ellos Parque, Hotel, Alcantarillado, Academia, Laboratorio y Caña de Pescar. Quien administra el servidor lo lanza a mano con `npm run seed:tomegrama`; no se ejecuta solo.

---

## Magia

Cinco escuelas activas: Destrucción, Alteración, Restauración, Ilusión y Conjuración. **Encantamiento está excluida** hasta nuevo aviso (pág. 51): existe en el catálogo, pero está inactiva, no tiene conjuros y no se puede avanzar en ella.

### Niveles y umbrales

Los niveles de dominio son Principiante, Aprendiz, Hábil, Experto y Maestro. Para subir al siguiente se hace una tirada de D20 más un modificador y se compara con el umbral:

- Principiante: 19 o más.
- Aprendiz: 19 o más.
- Hábil: más de 20 (el umbral real es 20,5, porque Destrucción da totales con medio punto).
- Experto: 24 o más.
- Maestro: 28 o más.

El **modificador** es el Autismo efectivo más una segunda estadística según la escuela: Destrucción suma Autismo entre 2 (sin redondear), Alteración Intuición, Restauración Resistencia, Ilusión Agilidad y Conjuración Donjuanismo.

### Mentor

**Todos los niveles exigen mentor**, también el de Principiante. El mentor puede ser:

- otro jugador (`mentor:`): el bot comprueba que su nivel en esa escuela es igual o superior al nivel que se intenta alcanzar; o
- un NPC (`mentor_npc:`): validas tú que existe y tiene el nivel necesario, y su nombre queda registrado.

Nadie puede ser su propio mentor.

### La tirada autorizada

- **Solo un Rolepriest autoriza la tirada**, con `/magia-admin tirada` indicando jugador, escuela y mentor. El jugador no puede tirar por su cuenta.
- El bot hace todo en una operación: reclama el intento, tira el D20, suma el modificador, compara con el umbral y, si pasa, sube un nivel. El resultado se publica en el canal con la tirada y el desglose.
- Si falla, la escuela queda en **enfriamiento durante 28 días** para ese jugador. Mientras dure no se puede volver a tirar en esa escuela. El tiempo «semana» del Tomegrama en mecánicas es tiempo real.
- Los conjuros desbloqueados no se guardan: salen del nivel. Subir el nivel los desbloquea y bajarlo los bloquea.

### Escuela gratuita

Un personaje con **Autismo efectivo de 6 o más** puede iniciar una escuela sin tirada ni mentor, **una sola vez**: `/escuelas iniciar` (o el botón en `/escuelas ver`). Queda en nivel Principiante. No sirve para Encantamiento ni para una escuela en la que ya tenga nivel.

### Corregir niveles

`/magia-admin fijar` pone a mano un nivel de 0 a 5. Pide confirmación cuando baja el nivel. Si el nivel cambia, el enfriamiento de esa escuela se borra.

---

## Muerte y revivir

Hay dos clases de muerte.

### Muerte en gracia

Cuando un jugador **abandona el servidor**, su personaje entra en gracia durante **7 días**. No se borra nada: inventarios, estadísticas, matrimonio y magia se conservan. Se avisa al jugador por MD y en su canal de modmail.

- Si el jugador **vuelve al servidor dentro de los 7 días**, recupera su personaje intacto de forma automática.
- Un Rolepriest puede devolverlo antes con `/revive jugador` o `/revive personaje_id` (por el ID interno del personaje).

### Muerte definitiva

Ocurre de dos formas: con **`/kill`** (inmediata, también si estaba en gracia) o cuando **se acaban los 7 días de gracia** (el bot lo comprueba cada día a las 00:30 UTC).

- En una sola operación se vacían los tres inventarios (NPCs, bienes y propiedades), las estadísticas, la raza, el menhir, los puntos extra, la escuela gratuita y todo el progreso mágico. Se cancelan las solicitudes pendientes y el cónyuge queda Viudo/a. Es la regla de «sin lucro post mortem» (Reglamento, regla 4).
- Antes de borrar, el bot guarda una **instantánea** de la ficha en el registro de auditoría (`personaje.muerte`). Es lo único que sobrevive y la purga de 30 días del registro no la toca.
- **No se puede revivir.** Si hay herencia narrativa, traspasa lo que corresponda **antes** de ejecutar `/kill`.
- El jugador podrá crear otro personaje tras una **espera de 336 horas (2 semanas) contadas desde la muerte** (mecánica RED, regla 1). Si el personaje pasó por la gracia, la espera cuenta desde que entró en ella. Se ajusta con `/perfil-admin cooldown-creacion` (0 la desactiva).
- `/personaje historial` con `jugador:` lista los nombres de los personajes anteriores de un jugador.

---

## Comunidad

### Modmail

Cada personaje tiene un canal privado de Staff, que solo ven el Staff y el jugador (este, por MD con el bot). Lo que el jugador escribe por MD al bot aparece en ese canal, y lo que escribas allí le llega por MD. Discord limita a 50 canales por categoría:

- `/modmail-categoria crear` crea y registra una categoría nueva; `/modmail-categoria listar` muestra cuántos canales tiene cada una. También se gestionan en el panel, en Categorías.
- `/modmail-relink` enlaza un canal ya existente como canal de un jugador, conservando su historial.

### Imprenta y periódicos

- `/periodico categoria` fija la categoría de Discord donde se crean los canales-periódico.
- `/periodico abrir` **abre la imprenta** de un jugador: crea su canal-periódico con el nombre que indiques.

### Broadcast

`/broadcast` manda un MD a todos los jugadores registrados, con una cabecera de aviso de Staff y hasta 4 imágenes opcionales. También se puede lanzar desde el terminal del panel. No se puede deshacer: revisa el texto.

---

## Panel web

El panel usa tu cuenta de Discord y solo admite Rolepriest. La sesión se cierra tras 30 minutos de inactividad (ajustable) y la API comprueba cada 10 minutos que sigues teniendo el rol; si lo pierdes, la sesión se destruye. Para salir, usa el botón de cerrar sesión.

- **Jugadores**: lista de personajes y la ficha de cada uno en solo lectura (perfil, inventarios, escuelas, conjuros y estado civil).
- **Registro**: el registro de auditoría, con filtros por actor, acción y fecha, y actualización en directo.
- **Terminal**: ejecuta comandos slash desde la web y consultas SQL **de solo lectura** (una sola sentencia `SELECT`, máximo 500 filas y 5 segundos; no puede leer sesiones ni el schema `mysql`). Desde aquí también se envía un broadcast.
- **Backups**: copias de seguridad de la base de datos y del bucket de imágenes, con programación y descarga. Por defecto se hacen a diario a las 23:30 UTC y se conservan 7. Generar una a mano antes de un cambio arriesgado es buena idea.
- **Categorías**: categorías de modmail.
- **Guía de Staff**: este documento.

---

## Cuándo avisar a quien administra el servidor

- Si el bot no responde a un comando de Rolepriest, o el terminal tarda más de 10 segundos en contestar: el bot puede estar reiniciándose.
- Si hace falta cambiar una regla del Tomegrama en el bot (un umbral, un bono de raza, el texto de un conjuro): es un cambio de migración, no se hace desde Discord.
