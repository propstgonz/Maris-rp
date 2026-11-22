# Guia del jugador - Ricardana RP

Todo lo que necesitas para empezar a rolear. Los comandos de Discord son `/slash`,
escribelos y Discord te guia con las opciones. `/ayuda` te enseña una version corta de
esta misma guia sin salir de Discord.

Juegas desde dos sitios que comparten el mismo personaje en tiempo real: **Discord**
(comandos y el panel `/jugar`) y el **panel web** en `https://rp-map.baronette.es/`
(entras con tu cuenta de Discord). Cada seccion de abajo dice donde se hace cada cosa.
Lo que no esta en la web todavia solo se puede hacer por Discord.

## Todo a clics en Discord: `/jugar`

`/jugar` abre tu panel privado: arriba tu ficha resumida (vida, hambre, Laburo,
posicion, viaje en curso) y debajo un desplegable con seis secciones - Inventario (ver,
usar consumibles, tirar al suelo), Fabricar, Construir, Combate, Mapa y viaje (tu
casilla y botones a las contiguas) y Personaje (ficha y alertas). Cada seccion lleva un
boton Volver.

Hace casi todo lo que cuenta esta guia sin escribir nada, asi que si eres nuevo y estas
en Discord empieza por ahi. Los comandos de texto de abajo siguen funcionando todos: son
la via rapida cuando ya te los sabes, y la unica para lo que el menu no cubre (adjuntar
foto al crear personaje, atacar construcciones a distancia, o viajar lejos con
coordenadas explicitas).

## Empezar

`/personaje crear` (Discord) - nombre completo, pais de origen y nacionalidad
(obligatorios); religion, genero (hombre/mujer), descripcion (max. 50 caracteres) y foto
opcionales. Sin esto no puedes hacer nada mas. Tambien puedes crear personaje desde la
web: entra en `https://rp-map.baronette.es/` con tu cuenta de Discord y rellena el
formulario que aparece (la foto se sube igual, ahi mismo).

`/personaje foto` (Discord) - pon o cambia la foto de tu personaje cuando quieras.

`/personaje ficha` (Discord) o la seccion Personaje del panel web (`/personaje` en la
web) - tu ficha: HP, hambre, posicion, nacion, facion, efectos activos, inventario y tus
construcciones y NPCs propios.

`/personaje alertas` (Discord) - panel de interruptores: elige cuales de los 7 avisos
automaticos quieres recibir por MD. Vienen todos activados.

Al crear tu personaje se abre un canal privado `rp-<tu-personaje>`, visible solo para ti
y Staff - puedes rolear ahi directamente. Tambien puedes seguir escribiendo por MD al
bot: se retransmite al canal solo, usa el que prefieras.

## Vida y hambre

HP y Hambre van de 0 a 10. Cada dia tu hambre baja 1. Si llega a 0, pierdes vida. Si te
mantienes bien alimentado (hambre al maximo), regeneras vida solo.

Comer un consumible sube tu hambre (y a veces tu HP, segun el objeto): en Discord con
`/item usar item`, o desde la web con el boton Comer que aparece junto a cada objeto
consumible de tu inventario (en la ficha de personaje, y tambien en el mapa cuando tu
hambre baja del 30%).

Si tu HP llega a 0, mueres. Tienes 7 dias de gracia con tu personaje intacto (inventario
incluido) para que Staff te reviva. Pasado ese plazo - o si usas `/personaje rendirse`
(Discord) para no esperar - se borra del todo y puedes crear uno nuevo. `/kill` de
Staff es la excepcion: permadeath inmediato, sin gracia.

## Mapa y movimiento

**Mapa web**: en `https://rp-map.baronette.es/` tienes el mapa en pantalla en cuanto
entras con tu cuenta de Discord. Veras donde esta tu personaje y que hay en varias
casillas a la redonda - otros jugadores, construcciones y NPCs. El resto del mundo se ve
en gris: sabes que esa tierra existe, pero no que hay en ella hasta que te acerques.

Controles del mapa: arrastra con el raton para moverte por el, la rueda del raton hace
zoom, doble clic centra la vista otra vez en tu personaje. Clic en una casilla la
selecciona (un boton "Ir a (x, y)" aparece abajo a la derecha) y un segundo clic la
deselecciona.

`/casilla info` (Discord) - que hay en tu casilla ahora mismo. En la web esa misma
informacion esta siempre visible en el panel lateral.

`/move x y` (Discord) o el formulario "Viajar" / el boton "Ir a (x, y)" en la web -
empieza un viaje hacia esas coordenadas: 3 casillas por hora en linea recta (mas rapido
si llevas un vehiculo). Sigues siendo visible y atacable en cada casilla por la que
pasas, no te teletransportas.

`/move` sin nada (Discord), o simplemente mira el panel lateral en la web - consulta tu
viaje en curso (destino, ETA) sin redirigirlo. `/move cancelar:true` (Discord) o el
boton "Cancelar viaje" (web) lo para donde estes.

Solo se puede viajar a casillas ya creadas en el mapa. Ciertos terrenos (agua,
montaña...) exigen un vehiculo de la categoria adecuada. Cuando llegues (o si el viaje
se bloquea a mitad de camino por un encuentro) te avisamos por MD y en tu canal privado.

### Si un encuentro pausa tu viaje

A veces un NPC salvaje te sale al paso y tu viaje se pausa hasta que lo resuelvas. Tres
salidas, en Discord o en la web:

- Atacarlo: `/attack` (Discord, la unica forma de atacar a un NPC ahi) o el boton
  Atacar que aparece junto al aviso de encuentro en la web.
- Huir: `/huir` (Discord) o el boton Huir en la web. Puede fallar segun el tipo de NPC -
  si falla, puede contraatacarte.
- Cancelar el viaje entero donde estes: `/move cancelar:true` (Discord) o el boton
  "Cancelar viaje" (web), que tambien libera el encuentro.

## Objetos

`/item list` (Discord) - catalogo completo de objetos del servidor (que existe, para que
sirve).

`/personaje inventario` (Discord) o la ficha de personaje en la web - lo que llevas
encima.

`/item grab` / `/item drop` (Discord), o los botones Coger / Soltar en la web (Coger
aparece en el mapa cuando hay algo en tu casilla; Soltar en cada objeto de tu
inventario, en la ficha de personaje) - recoger o tirar objetos del suelo de tu casilla.

`/item destroy` (Discord) - descartar algo de tu inventario sin dejarlo en el suelo.

`/item usar item` (Discord) o el boton Comer (web) - usa un consumible (comida,
pociones...) y aplica su efecto.

## Recolectar

`/recolectar item` (Discord) o el boton Recolectar (web, uno por cada recurso
disponible en tu casilla) - intenta conseguir un recurso del terreno donde estas. No
siempre sale algo, y a veces sale algo distinto de lo que buscabas.

## Crafteo

`/craft item` (Discord) o el boton Craftear (web, en el mapa y en la ficha de
personaje) - fabrica algo con lo que llevas. Cada receta pide ingredientes y a veces
Laburo, una construccion concreta cerca, o una herramienta que abarata el coste. Si un
objeto tiene varias recetas que puedes permitirte, eliges cual.

## Laburo (la moneda del juego)

`/laburo trabajar` (Discord) o el boton Laburar (web, en el mapa) - trabaja para ganar
Laburo (cooldown de 23h).

`/laburo trade jugador cantidad` (Discord) o el formulario de intercambio (web,
seleccionando Laburo) - dale parte de tu Laburo a alguien en tu misma casilla.

## Comercio entre jugadores

`/trade jugador item cantidad` (Discord) o el formulario "Intercambiar" (web, en el
mapa) - ofrece objetos a otro jugador que este en tu misma casilla. Si lo inicias desde
la web, la otra persona tiene que aceptar la propuesta por Discord - la aceptacion
todavia no esta disponible en el panel web.

## Construcciones y vehiculos

`/build list` (Discord) - tipos de construccion disponibles.

`/build place tipo x y` (Discord) - construye en tu casilla actual. Todavia no hay
equivalente en la web.

`/build usar` (Discord) o el boton Usar (web, en el mapa, por cada construccion de tu
casilla) - interactua con una construccion (ej. sacar recursos de una mina).

`/build repostar` (Discord) o el formulario de repostar (web) - mete combustible si lo
necesita.

`/build reparar` (Discord) o el boton Reparar (web) - devuelve a la vida una
construccion en ruinas.

`/build restaurar` (Discord) - restaura al maximo la durabilidad de una construccion que
no esta en ruinas, sin pasar por el ciclo de reparacion completo.

`/build destroy` (Discord) o el boton de la papelera (web) - demuele una construccion
tuya.

`/build mercado_stock` / `mercado_list` / `comprar` (Discord) - reponer stock y precio
de un puesto de comercio, consultar lo que vende, y comprarle. Solo por Discord.

`/build almacen_ver` / `almacen_depositar` / `almacen_retirar` (Discord) - el almacen
propio de una construccion, separado de tu inventario personal. Solo por Discord.

`/build reclutar` (Discord) - recluta un NPC en una oficina de reclutamiento, pagado con
recursos de tu faccion.

`/build ceder` (Discord) - cede un permiso sobre una construccion tuya a otro jugador.

Caben 15 construcciones por casilla, y hasta 8 del mismo tipo. Como puede haber varias
iguales, los comandos de Discord que actuan sobre una aceptan `id:` para decir cual - el
bot te lo pide y te lista los ids solo si de verdad hay empate. En la web cada boton ya
sabe a cual se refiere.

El combustible de un edificio se ve en `/casilla info` o en el panel lateral de la web:
cuanto queda, de cuanto es el deposito (infinito si no tiene tope) y para cuantos dias
da. Si eres quien lo construyo, el bot te avisa por MD unos dias antes de que se seque,
no cuando ya ha dejado de producir.

Poseer un vehiculo en tu inventario te deja cruzar terreno que lo exija (agua, aire...)
y acelera tus viajes con `/move` - no hace falta montarlo, basta con tenerlo.

## Tu imperio

`/imperio` (Discord) o la ficha de personaje en la web - consulta todas tus
construcciones y NPCs reclutados de un vistazo, y cobra su produccion pendiente de
golpe.

`/npc list` (Discord) - lista los NPCs que has reclutado.

`/npc rol` (Discord) - fija si un NPC reclutado es productor o soldado.

`/npc equipar` / `desequipar` (Discord) - asigna o quita una herramienta (de tu
inventario) a un NPC reclutado.

`/npc recoger` (Discord) - cobra la produccion pendiente de un NPC reclutado en
concreto (el boton "Cobrar toda la produccion" de la web hace esto para todos a la vez).

`/npc reubicar` (Discord) - traslada un NPC reclutado a tu casilla actual.

## Combate

`/attack jugador [arma]` (Discord) - con arma es a distancia (dos tiradas: alcance y
resultado); sin arma es cuerpo a cuerpo y exige estar en la misma casilla.

`/attack construccion` (Discord) - ataca un edificio del mapa (solo con arma preparada
para ello).

`/attack menu` (Discord, la mas completa, y la unica forma de atacar a un NPC por
Discord) o el boton Atacar (web, en el mapa) - eliges primero el arma y luego el
objetivo entre todo lo que esa arma alcanza: jugadores, NPCs y construcciones hasta la
distancia del arma, no solo los de tu casilla.

Cada objetivo te dice a cuantas casillas esta y con cuantas de las 6 caras llega tu
arma. Ojo: un arma "de 20 casillas" casi siempre llega a 20 con una sola cara - a esa
distancia fallas el alcance 5 de cada 6 veces. Si atacas a un NPC y sobrevive,
contraataca en el mismo turno - pero solo si SU arma te alcanza a ti: a un bicho de
garras se le puede disparar de lejos sin que responda.

`/huir` (Discord) o el boton Huir (web, cuando un encuentro te tiene parado) - intentas
escapar del NPC en vez de pelear; si fallas, te ataca gratis.

Fallar puede dañar tu propia arma, o hacerte daño a ti mismo si peleas cuerpo a cuerpo.
Los ataques con area afectan a todos los que esten en la casilla.

## Robar y saquear

`/robar` (Discord) - intenta robarle algo a un NPC amistoso de tu casilla.

`/saquear jugador` (Discord) - exige a otro jugador de tu casilla que te entregue
algo. El decide si pelear o rendirse.

## Animales: domesticar, criar, montura

`/domesticar` (Discord) - intenta domesticar un NPC amistoso de tu casilla. Necesitas
llevar su cebo encima.

`/criar padre madre` (Discord) - intenta que dos animales tuyos del mismo tipo tengan
una cria.

`/montura montar` / `desmontar` / `estado` (Discord) - gestiona cual de tus animales
domesticados llevas como montura activa. Un animal montado viaja contigo casilla a
casilla y cuenta como vehiculo (con su propia categoria y velocidad).

## Comerciar con NPCs

`/comerciar` (Discord) - ofrece un trueque a un NPC amistoso de tu casilla: das un ítem
tuyo y pides otro de su stock.

## Facciones

`/faccion list` (Discord) - territorios existentes.

`/faccion solicitar` (Discord) - pide ciudadania en la faccion cuyo territorio pisas (el
dueño decide).

`/faccion abandonar` (Discord) - deja tu faccion actual.

Hay mas subcomandos de `/faccion` para rangos, permisos y almacen de faccion, pensados
para quien ya lidera una - Discord te los guia con las opciones si tienes el rango
necesario.

## Extra

`/dado [caras]` (Discord) - tira un dado libre para resolver cualquier duda narrativa.
Sin elegir nada sale un D6; en el desplegable tienes ademas D10 (investigacion), D12
(viento en batalla naval), D20 (acciones generales, prospeccion, conversion) y D100
(puntos de inflexion).

---

Dudas? Pregunta a Staff o a un Rolepriest. A rolear.
