# Guía de Staff — Mecánicas de Ricardana RP

Esta guía explica **cómo funciona el mundo por dentro** — las reglas que
Staff necesita entender para configurar contenido con criterio y arbitrar
situaciones con justicia — y además incluye **recetas paso a paso con los
comandos exactos** para las tareas de configuración más habituales (crear
un ítem, montar una construcción que produce y almacena, dar de alta un
arma...). Es el único documento de referencia para Staff: no hay otro
archivo aparte con la sintaxis de comandos. Para la experiencia de un
jugador normal, ver [`PLAYER_GUIDE.md`](../PLAYER_GUIDE.md) o `/ayuda` en Discord.

## Roles y permisos

Solo hay **un** rol de moderación: **Rolepriest**. Puede todo, siempre,
sobre cualquier cosa — gestión de jugadores, catálogos, mapa y economía.
No existe ningún rol intermedio "Staff" con menos alcance: si en `config.json`
tienes IDs de rol de Discord separados para "Staff" y "Rolepriest", ambos dan
exactamente la misma autoridad puertas adentro del bot — es una sola
comprobación (`isRolepriest()`), nunca dos niveles distintos.

Un jugador normal, sin este rol, puede crear personaje y usar todos los
comandos de jugador. Sin personaje creado, no puede usar ninguno (el bot se
lo recuerda solo).

## Autoridad: Rolepriest frente a permisos de facción

Dos sistemas de autoridad completamente separados, y no deben mezclarse:

- **Rolepriest** es autoridad **fuera de la ficción** — moderación pura.
  Puede todo, siempre, sobre cualquier cosa. No es un rango que un jugador
  pueda ganar ni ceder dentro del juego; se concede fuera de él.
- **Los permisos de facción** son autoridad **dentro de la ficción** — un
  líder cede a un compañero la llave del almacén, un dueño autoriza a otro a
  reparar su vehículo. No dan ningún poder de moderación.

Cuando alguien intenta hacer algo sobre un objeto del mundo (usar un
almacén, reparar una construcción ajena...), la pregunta "¿puede?" se
responde en este orden, y se para en el primer sí:

- **1.** ¿Es Rolepriest? → sí, siempre.
- **2.** ¿Es el dueño del objeto? → sí.
- **3.** ¿Alguien le cedió permiso explícito sobre **ese objeto en
  concreto**, y sigue vigente (no caducado)? → sí.
- **4.** ¿Su rango dentro de la facción alcanza el mínimo que exige esa
  acción? → sí.
- **5.** Si nada de lo anterior aplica, se cae a la política por defecto
  que Staff configuró para ese tipo de construcción (`any`/`owner`/
  `faccion`/`rolepriest` en `/construction modify`).
- **6.** Si tampoco hay política que lo permita → no.

## Facciones y rangos

Cada facción nueva nace con **cuatro rangos** ya sembrados, de menor a mayor
autoridad: **Miembro, Veterano, Colíder, Líder**. El líder puede después
renombrarlos, añadir más o reordenarlos — una facción funciona desde el
minuto uno sin que nadie tenga que configurar nada.

Un permiso de facción (por ejemplo, "quién puede retirar del almacén") se
define como **"a partir de qué rango"** — no como una casilla marcada rango
por rango. Eso significa que dar un permiso a Veterano se lo da también
automáticamente a Colíder y Líder por encima: la jerarquía es aritmética,
no una lista que haya que repetir en cada nivel.

**Ceder permiso a alguien fuera de la jerarquía normal** (a un jugador
concreto, no a todo un rango) también es posible, con fecha de caducidad
opcional — pero solo puede hacerlo quien **ya tiene ese permiso él mismo**
y además es el dueño del objeto o tiene autoridad para gestionar rangos. No
se puede ceder lo que no se tiene: nadie puede fabricarse más poder del que
ya posee cediéndoselo a otro.

**Territorio**: asignar territorio a una facción por el mapa exige que
dentro del rectángulo ya haya un **ayuntamiento** construido — no se puede
reclamar tierra vacía sin presencia real allí. La vía de comandos de Staff
no tiene esta exigencia, para emergencias o worldbuilding inicial.

**Cómo funciona la ciudadanía** (quién pertenece a cada facción — distinto
de la nacionalidad, el origen narrativo fijado en `/personaje crear`, que
no cambia nunca sola):

- Un jugador que **no** es ciudadano de una facción se mueve (`/move`) y
  cruza su frontera (pasa de una casilla sin esa facción a una que sí la
  tiene).
- **Siempre** se avisa por MD al dueño ("policía fronteriza"): *"Fulano ha
  entrado en tu territorio"* — esto pasa cada vez, sea o no la primera
  visita.
- Si es la **primera vez** que ese jugador pisa el territorio de esa
  facción, además se le pregunta por MD con botones: *"¿Quieres solicitar
  incorporarte?"*. Si dice que no, no se le vuelve a preguntar solo — puede
  pedirlo cuando quiera con `/faccion solicitar`.
- Si acepta, se le manda al **dueño** un MD con botones Aceptar/Rechazar.
  Si el dueño no responde en **24h**, la solicitud caduca sola y se avisa
  al jugador.
- Si acepta, el jugador pasa a ser ciudadano al instante (se ve en
  `/personaje ficha` como "🏳️ Facción"). La ciudadanía es **permanente**
  hasta que se quite explícitamente: el propio jugador con `/faccion
  abandonar`, o el dueño/Staff con `/faccion expulsar`.

Este flujo de frontera solo se dispara con `/move` del propio jugador — si
Staff reposiciona a alguien con `/tp`, no se avisa a nadie ni se pregunta
nada (es un teletransporte administrativo, no un desplazamiento narrativo).

## Vida, muerte y revivir

HP y hambre van de 0 a 10. La hambre baja 1 al día sola; a 0 de hambre se
pierden 4 HP/día por inanición, y con la hambre siempre al máximo se
regeneran 4 HP/día.

Morir (por inanición o combate) abre una **ventana de gracia de 7 días**:

- El jugador puede esperar a que Staff lo revivan.
- O rendirse ya (`/personaje rendirse`) para renunciar al instante y poder
  crear personaje nuevo sin esperar el resto de la ventana.
- Si nadie hace nada, al pasar los 7 días el personaje se borra solo
  (inventario, efectos, identidad) — pero su **nombre** queda para siempre
  en el historial.

**Matar con autoridad de Staff (`/kill`) es permadeath directo**, sin
ventana de gracia ni opción de revivir — es una decisión deliberada de
Staff, no del jugador, y se borra al instante. Si el objetivo **ya** estaba
muerto y en gracia (por inanición, combate, o por haber salido del
servidor), `/kill` no lo "mata" otra vez — **finaliza esa gracia ya**, con
el mismo borrado sin vuelta atrás, en vez de esperar a que venzan los 7 días
solos.

**El botín cae al suelo, no desaparece.** En el momento en que un personaje
queda **irreversiblemente** borrado (permadeath, rendición, gracia vencida
o finalizada por Staff — nunca durante la propia ventana de gracia, que
sigue siendo revivible) su inventario se suelta entero en la casilla donde
murió, exactamente igual que el botín de un NPC — cualquiera que pase por
ahí puede recogerlo con `/item grab`. El Laburo es la excepción: no es un
ítem físico, así que simplemente se pierde, no queda tirado en ningún
sitio.

**Salir del servidor de Discord mata igual que la inanición o el combate**
— misma ventana de 7 días, no permadeath directo. Si el jugador vuelve
dentro de esos 7 días, su personaje **revive solo**, sin que nadie tenga que
hacer nada.

Staff puede exigir un **cooldown de creación** (desactivado por defecto,
`/personaje cooldown [horas]`): tiempo de espera entre quedarse sin
personaje de verdad y poder crear uno nuevo. Un jugador que nunca tuvo
personaje no arrastra ningún cooldown — solo aplica tras haber perdido uno
real.

## Economía: Laburo

El Laburo es la moneda de trabajo del rol — se gana **activamente**
trabajando (`/laburo trabajar`, cooldown de 23h por jugador), nunca de
forma pasiva. Cada tanda ganada es un **lote independiente que caduca a los
7 días** si no se gasta: no es un saldo único que se acumula sin límite, así
que guardar Laburo "para más adelante" tiene un coste real.

`/laburo-admin dia cantidad` cambia cuánto da `/laburo trabajar` a todo el
mundo por defecto (antes de efectos). `/laburo-admin add/remove/reset/set`
ajustan el saldo de un jugador concreto a mano.

## Viaje, distancia y terreno

La distancia entre dos casillas se mide igual en todas partes del
juego — combate a distancia y movimiento usan la misma regla: **número de
pasos en línea recta tipo tablero de ajedrez** (se cuenta en diagonal como
un solo paso, no como la hipotenusa). De (0,0) a (100,100) hay 100 casillas
de distancia, ni una más.

Viajar no es siempre "una casilla = una hora": cada terreno tiene su propio
coste de movimiento (Staff lo configura al crear el tipo de terreno con
`/terrain create|modify coste_movimiento`), y una infraestructura de ruta
construida en una casilla (`/construction modify ruta_multiplicador`) puede
abaratar cruzarla multiplicando ese coste — nunca restando. Si hay varias
construcciones de ruta en la misma casilla, gana la que más abarate, no se
suman. El presupuesto de horas disponible por tramo depende también de la
velocidad del vehículo del jugador. Con todo en su valor por defecto
(`coste_movimiento:1`, `ruta_multiplicador:1`) el comportamiento es
exactamente "una casilla, una hora".

`/move x y` solo deja ir a casillas que **ya existen** en el mapa, y solo
dentro de un **límite de coordenada máxima configurable** (Mecánicas →
"Límite del mapa", 100 por defecto): pasado ese límite, `/move` lo rechaza
avisando del máximo actual. Un Rolepriest puede saltarse las dos
restricciones a la vez con `/tp` — teletransporte instantáneo, sin viaje
gradual, sin exigir que la casilla exista y sin límite de coordenada. Es la
herramienta pensada para eventos, rescates o para llevar a alguien más allá
del mapa "oficial" cuando haga falta.

## Combate

Un ataque a distancia son **siempre dos tiradas**, nunca una sola:

- **Alcance** — cada cara del dado del arma tiene su propio alcance
  máximo; si la distancia real al objetivo cae dentro de ese máximo,
  continúa a la segunda tirada, si no, el ataque falla ahí mismo.
- **Resultado** (solo si la primera entró en alcance): 1 = fallas y dañas
  tu propia arma, 2 = fallas sin más, 3 = impacto flojo, 4 = normal, 5 =
  buen impacto, 6 = crítico (daño doble).

Cuerpo a cuerpo (exige compartir casilla con el objetivo) solo tira la
segunda tabla, sobre el daño base a puño — y un 1 te hace daño a ti mismo en
vez de a tu arma.

El arma en sí nunca se gasta por usarla — solo pierde durabilidad si Staff
le configuró una (`/item-admin arma durabilidad:N`; sin ponerla, es
irrompible), y si tiene munición configurada, esa sí se consume en cada
disparo entre o no en alcance, acierte o falle.

**Las construcciones no se dañan por defecto**: la mayoría de armas no
pueden tocar su vida (hasta 1000, la que Staff fije por tipo) — solo las que
Staff marcó explícitamente con `dano_estructura` (dinamita, cañones...)
pueden arruinarlas. Al llegar a 0 quedan **en ruinas**: no desaparecen del
mapa, pero dejan de contar como construcción válida para crafteos/requisitos
hasta que alguien las repare (por la mitad de sus ingredientes originales +
mitad de su Laburo, `/build reparar`) o Staff las borre del todo.

**Un solo límite de ataques para todo**: si Staff configura un tope diario
y/o un cooldown entre ataques (panel web, sección "Mecánicas" — desactivado
por defecto), ese límite es **compartido** entre atacar a otro jugador, atacar
un NPC y atacar una construcción — los tres cuentan para el mismo cupo y el
mismo cooldown, no son contadores independientes. Un jugador no puede agotar
su cupo contra jugadores y seguir atacando construcciones sin límite.

**Armas de área** (explosivos, bombas...): si el arma tiene `area:true`, un
impacto contra un jugador (nunca cuerpo a cuerpo) también afecta a toda su
casilla — mismo daño para el resto de jugadores vivos ahí (el atacante
incluido, si comparte casilla), `dano_estructura` para las construcciones, y
el estado de `area_efecto` (si tiene uno configurado) para todos los
afectados. Ver la receta completa más abajo, en el apartado técnico.

**Los NPCs reclutados en rol de soldado defienden su casilla solos**: si
alguien ataca a un jugador o a una construcción en una casilla donde hay
NPCs propios en rol "soldado" (ver la sección de NPCs), esos NPCs
contraatacan automáticamente con su herramienta equipada — sin que su dueño
tenga que estar conectado. Nunca contraatacan a su propio dueño.

## Ítems: catálogo y creación

Crear un ítem es un proceso de **hasta 3 pasos separados** — antes era todo
en un único comando, que llegó a los 25 campos, el máximo que permite
Discord por comando. Ningún paso obliga a repetir el anterior, y cada uno
falla claramente si el ítem no es del tipo que le corresponde.

- **1.** Identidad básica — siempre el primer paso, para cualquier ítem:
   ```
   /item-admin create nombre:barril_petroleo display:"Barril de Petróleo" tipo:recurso emoji:🛢️ peso:5
   ```
   `tipo` es uno de `dinero`/`consumible`/`recurso`/`herramienta`/`laburo`/
   `arma`/`vehiculo`. `peso` importa por dos motivos a la vez: la capacidad de
   inventario del jugador que lo lleve (por defecto 500, `/stat modify stat:"Capacidad de inventario"`
   la corrige por jugador), y la capacidad de cualquier almacén de
   construcción donde acabe cayendo — ambas se miden en peso total, no en
   unidades sueltas (ver "Almacenes" más abajo). Si es consumible, aquí
   también van `consumible:true`, `hp_delta`, `hunger_delta` y `efecto`.
   `combustible:true` marca que puede usarse como combustible de
   construcciones (ver la receta de combustible en el apartado técnico).

- **2.** Paso opcional, solo si hace falta — `tipo:arma` usa `/item-admin arma`
   (daño, tabla de dados, durabilidad, munición, área); `tipo:vehiculo` usa
   `/item-admin vehiculo item categoria:aereo|maritimo|terrestre`. Un ítem
   de cualquier otro tipo no necesita este paso.

- **3.** Receta de crafteo, opcional — `/item-admin receta item ingredientes:"madera:5,hierro:2" laburo_coste:10`.
   **Añade** una receta más, nunca reemplaza las que ya tuviera — un mismo
   ítem puede craftearse de varias formas a la vez (una barata a mano, otra
   más barata en una fábrica). `/item-admin recetas item` las lista
   numeradas; `/item-admin quitar-receta item indice` borra una en concreto.

**El orden importa, y falla claro si no lo respetas**: cualquier comando
que referencie un ítem por nombre (`otorga_item`, `combustible_item`,
`ingredientes`, `requiere_recurso` de una receta...) busca ese nombre en el
catálogo de `items` en ese momento — si el ítem todavía no existe, el
comando entero se rechaza con un error explícito en vez de crear algo a
medias. Crea siempre primero el ítem, después lo que lo use.

Para editar identidad de un ítem ya creado, `/item-admin modify`; para
borrarlo, `/item-admin delete` (falla si está en uso en algún sitio,
incluida su propia receta — usa antes `/item-admin quitar-receta` si el
error dice "resultado de una receta").

## Construcciones: producción pasiva y almacenes

La producción de una construcción (el recurso que reparte sola con el
tiempo, si Staff se lo configuró) **no corre en segundo plano
constantemente** — se calcula de golpe, por ciclos completos, en el momento
en que alguien interactúa con ella (mirarla, usarla) o, para las que nadie
visita, en un barrido de mantenimiento cada 15 minutos. El resultado siempre
va a un **almacén propio de esa construcción**, nunca directo al inventario
de nadie — hay que retirarlo aparte (ver "Almacenes" más abajo).

Dos límites protegen esto de romperse por abandono o acumulación infinita:

- Hay un **tope de horas acumulables**: una construcción olvidada durante
  meses no suelta de golpe medio año de producción de una vez, ni cobra
  medio año de combustible retroactivo.
- Si el **almacén está lleno**, la producción se para en seco: no se cobra
  combustible y el reloj de producción no avanza hasta que alguien haga
  hueco retirando algo.

Estos dos límites (y la capacidad del almacén en sí) viven en la base de
datos con valores de fábrica — **sin límite** de peso, produce cada **24h**,
acumula hasta **48h** sin que nadie pase a recoger — pero hoy **no son
configurables** desde ningún comando ni desde el catálogo web: todo tipo de
construcción nace y se queda con esos tres valores. Si necesitas ajustarlos
para un tipo concreto, pide que se añada esa opción — es una extensión
pequeña sobre lo que ya existe.

### Ejemplo completo: una construcción que produce y almacena

Con lo que ya existe no hace falta escribir nada nuevo — una plataforma
petrolífera es un caso más del patrón que ya usan minas/talleres/etc.
(producción pasiva → almacén propio de la construcción).

- **1.** Crea el ítem que va a producir (ver "Ítems" más arriba):
   ```
   /item-admin create nombre:barril_petroleo display:"Barril de Petróleo" tipo:recurso emoji:🛢️ peso:5
   ```

- **2.** Crea el tipo de construcción, con el generador pasivo activado:
   ```
   /construction create nombre:plataforma_petrolifera display:"Plataforma Petrolífera" emoji:🛢️
     laburo_coste:80 ingredientes:"hierro:20,acero:10"
     otorga_item:barril_petroleo otorga_tasa:5
     requiere_recurso:petroleo
   ```
   `otorga_item`/`otorga_tasa` es lo que activa el generador pasivo — 5
   barriles/día en este ejemplo. `requiere_recurso` es opcional: si lo
   pones, solo se puede construir sobre una casilla marcada con ese recurso
   de texto libre (`/map edit x:.. y:.. recurso:petroleo`) — un sistema
   aparte de `terrain_type_resources` (ver "Recolección" más abajo), pensado
   para requisitos de construcción, no para recolectar a mano.

- **3.** Constrúyela en juego:
   ```
   /build place tipo:plataforma_petrolifera x:.. y:..
   ```

- **4.** Gestiona su almacén — no hace falta construir uno aparte, cada instancia
   ya trae el suyo propio:
   ```
   /build almacen_ver tipo:plataforma_petrolifera x:.. y:..
   /build almacen_retirar tipo:plataforma_petrolifera x:.. y:.. item:barril_petroleo cantidad:10
   ```
   Cualquiera físicamente en la casilla puede mirar/retirar, no solo el
   dueño — mismo criterio que repostar o reparar.

### Combustible (opcional, solo afecta al reparto pasivo)

El combustible **solo** afecta al reparto pasivo diario (`otorga_item`/
`otorga_tasa`) — la interacción activa de `/build usar` no se ve afectada.
Cada instancia tiene su propio depósito interno; el cron diario nunca cobra
combustible del inventario de ningún jugador (no hay nadie "presente" a
medianoche) — descuenta del depósito, y si no hay suficiente, ese generador
simplemente no produce ese día.

- **1.** Marca un ítem como combustible (puede seguir siendo un recurso normal a
   la vez): `/item-admin create nombre:lena display:Leña tipo:recurso combustible:true`
   (o `/item-admin modify item:lena combustible:true` si ya existía).
- **2.** Configura el generador para que lo exija:
   ```
   /construction create nombre:horno display:Horno emoji:🔥
     otorga_item:hierro otorga_tasa:3
     combustible_item:lena combustible_tasa:2 combustible_capacidad:20
   ```
   `combustible_tasa` es obligatoria si pones `combustible_item` (si no,
   nunca se descontaría nada). `combustible_capacidad` es opcional — vacío
   = el depósito no tiene límite.
- **3.** En juego, cualquiera en la casilla rellena el depósito con
   `/build repostar tipo:horno x:.. y:.. cantidad:10` — si repostas más de
   lo que cabe, solo se gasta del inventario lo que de verdad entra.
- **4.** Cada día, el horno descuenta 2 de leña del depósito y **añade el hierro
   a su propio almacén** (no al inventario del dueño, ver "Almacenes") — si
   el depósito se queda con menos de 2, ese día no produce nada hasta que
   alguien vuelva a repostar.

### Interacción activa (`/build usar`, tipo mina con pico)

Es un sistema aparte de la producción pasiva de arriba — **conviven sin
problema**: un mismo tipo puede tener generador pasivo, interacción activa,
ambos o ninguno.

- **1.** Crea el tipo de construcción si no existe:
   ```
   /construction create nombre:mina_hierro display:"Mina de Hierro" emoji:⛏️ laburo_coste:30 ingredientes:"madera:20,piedra:10"
   ```
- **2.** Configura la interacción — herramienta requerida, ítem que da, tabla de
   1d6, coste y cooldown:
   ```
   /construction usar nombre:mina_hierro herramienta:pico resultado:hierro
     dado_1:0 dado_2:0 dado_3:1 dado_4:1 dado_5:2 dado_6:3
     laburo_coste:2 cooldown_horas:4
   ```
   Cada `dado_N` se edita de forma independiente — una llamada posterior que
   solo toque `dado_6` no borra el resto de la tabla ya configurada.
   `herramienta`/`resultado`/`laburo_coste`/`cooldown_horas` son todos
   opcionales por separado.
- **3.** En juego: cualquier jugador (no solo el dueño) físicamente en la casilla
   y con `pico` en el inventario (basta con tenerlo, no se gasta) puede
   `/build usar tipo:mina_hierro x:.. y:..`. Tira 1d6 contra esa tabla; el
   coste en Laburo y el cooldown se cobran **siempre que se intenta**,
   acierte o falle. El cooldown es por **esa instancia concreta** — usar una
   mina no bloquea usar otra mina distinta en otra casilla.

### Durabilidad (opcional, por tipo)

Un tercer indicador, aparte de la vida (daño de combate) y del mantenimiento
(impago de un ítem diario, ver más abajo) — decae **solo por el paso del
tiempo**, independiente de los otros dos. Sin configurar, un tipo no
participa en el desgaste en absoluto.

- **1.** Fija la durabilidad máxima al crear el tipo (por defecto 100):
   `/construction create nombre:... durabilidad_maxima:150 ...`
- **2.** Activa el desgaste diario y, si quieres, exige una herramienta para
   restaurarla:
   ```
   /construction durabilidad nombre:plataforma_petrolifera maxima:150 perdida_dia:2 herramienta:llave_inglesa
   ```
   `perdida_dia` es opcional — sin ella, ese tipo nunca pierde durabilidad
   por tiempo, solo por lo que tú fijes aquí. `herramienta` es opcional
   también: si la pones, hace falta **tener** ese ítem en el inventario para
   restaurar (no se gasta, igual que la herramienta de `/build usar`); sin
   ella, cualquiera con permiso puede restaurar sin necesitar nada especial.
- **3.** En juego, un jugador la restaura al máximo con:
   ```
   /build restaurar tipo:plataforma_petrolifera x:.. y:..
   ```

### Mantenimiento (opcional, por tipo)

Staff puede exigir que un tipo de construcción consuma a diario un ítem de
mantenimiento para seguir en pie — un tipo sin mantenimiento configurado se
comporta exactamente igual que siempre, sin ningún coste añadido
(`/construction modify mantenimiento_item:... mantenimiento_tasa:...`). El
pago sale primero del almacén propio de la construcción; si no alcanza y
hay un **silo de recursos** de la misma facción del dueño a **2 casillas o
menos**, tira de ahí en su lugar (mismo criterio de cercanía que la comida
de los NPCs, ver más abajo). Sin pagar: desde el primer día deja de
producir (el reloj no avanza, así que lo acumulado no se pierde, solo se
congela), y desde el **tercer día seguido** sin mantener pierde 1 de vida al
día hasta quedar en ruinas.

**El jugador tiene un panel propio (`/imperio`)** que resume de un vistazo
todas sus construcciones y NPCs con producción pendiente, avisos (sin
combustible, sin mantener, a punto de desertar...) y un botón para cobrarlo
todo de golpe — no cambia ninguna regla de las de arriba, solo hace visible
lo que ya estaba pasando por debajo.

## Recolección de recursos por terreno

Sistema distinto de la producción pasiva de construcciones: en vez de
plantar algo y esperar, el jugador **intenta** conseguir un recurso a mano,
en cualquier casilla, sin construir nada.

Cada **tipo de terreno** declara una lista de recursos posibles, cada uno
con su propio porcentaje de éxito y la cantidad que da si sale — a
diferencia de casi todo lo demás en este documento, **esto se configura
desde el catálogo web de Terrenos** (`/terrain-types`), no con un comando de
Discord: es una lista de varias filas (ítem + cantidad + %), y ese tipo de
catálogo (como el botín de los NPCs) vive solo en la web. `/terrain list`
sí muestra en Discord lo que hay configurado, en modo lectura.

Si además la casilla pertenece a una **zona** (ver más abajo), se recolecta
sobre la **unión** de los recursos del terreno y los de la zona: los de la
zona se suman, y si la zona repite un ítem que ya daba el terreno, mandan la
cantidad y el % de la zona.

En juego, el jugador usa `/recolectar item:...` — el desplegable de `item`
solo sugiere lo que se puede sacar en la casilla donde está parado **ahora
mismo**, zona incluida. El juego tira el porcentaje de **cada** recurso por separado
(no es un reparto de 100% entre opciones): si el que elegiste sale,
te lo llevas; si el tuyo no sale pero otro sí, te llevas ese como sorpresa;
si ninguno sale, no consigues nada esta vez — puedes elegir, pero puede
salirte otra cosa.

El cooldown es **por casilla y jugador**, no global: recolectar en una
casilla no bloquea recolectar en otra distinta, aunque seas el mismo
jugador. Su duración en horas es un único ajuste configurable en Mecánicas
→ "Recolección" (panel web), no por terreno.

## Zonas

Una zona es un **área con nombre propio** que agrupa casillas y actúa como
**tercer eje** junto al tipo de terreno. Sirve para que dos casillas del
mismo terreno en extremos opuestos del mapa no sean idénticas: el bosque del
norte puede dar pieles y tener lobos, y el del sur no.

Reglas básicas:

- Una casilla pertenece a **una zona como mucho** — no hay solapes, así que
  nunca hay que desempatar entre dos zonas.
- Las casillas se asignan **por rectángulo**: desde el mapa de Staff (modo
  "Zona" del selector de arrastre) o con `/zona asignar zona x1 y1 x2 y2`.
  El rectángulo solo afecta a las casillas que ya existen; no crea ninguna.
- El catálogo vive en la web (`/staff/zonas`): nombre, color del contorno,
  emoji y **recursos propios de la zona**. Como con los terrenos, la lista de
  recursos solo se edita en la web; `/zona listar` la muestra en Discord en
  modo lectura.
- Una zona con casillas asignadas **no se puede borrar**: primero hay que
  liberarlas con `/zona desasignar` o con el botón de quitar zona del mapa.

Qué aporta una zona:

- **Recursos**: se suman a los del terreno al recolectar, y pisan al terreno
  si repiten ítem (ver la sección de recolección más arriba).
- **NPCs**: cada tipo de NPC (y cada grupo) puede marcarse como exclusivo de
  una o varias zonas, con su propio % de aparición — ver la sección de NPCs.
- **Temperatura**: la zona fija el rango de clima de sus casillas — ver la
  sección siguiente.

En el mapa de Staff, la zona se dibuja como un **contorno de color** alrededor
del área, no como relleno: el color de fondo de una casilla sigue siendo el de
su terreno. El botón "Zonas" de la barra superior muestra u oculta ese contorno.

## Temperatura

Cada casilla tiene **su propia temperatura**, y cada zona el **rango** dentro
del que se reparten las suyas (`Temperatura mínima` / `máxima` en el catálogo
de zonas, o `temp_min` / `temp_max` en `/zona crear` y `/zona editar`). Las
casillas que no pertenecen a ninguna zona usan el rango base del mundo, en
Mecánicas → "Temperatura del mundo".

El reparto **no es aleatorio casilla a casilla**: se calcula con un campo de
ruido suave, así que dos casillas vecinas siempre tienen temperaturas
parecidas y el clima cambia poco a poco al recorrer el mapa. Dentro de una
misma zona la diferencia entre dos casillas contiguas es de un grado o dos,
nunca un salto de veinte. En el límite entre dos zonas sí hay transición, y es
tanto más brusca cuanto más se alejen sus rangos: si pones una tundra de -12 a
-4 pegada a un desierto de 28 a 40, la frontera se nota. Es a propósito — el
suavizado une climas vecinos, pero no puede inventarse las casillas templadas
que no has puesto en medio.

El cálculo se dispara solo cuando hace falta: al crear casillas, al asignar o
quitar una zona sobre un rectángulo, y al cambiar el rango de una zona (que
recalcula solo las suyas). Para rehacer el mapa entero está `/map temperaturas`
en Discord y el botón "Sortear un clima nuevo" en Mecánicas.

El reparto es **estable**: mientras no cambie la semilla, recalcular devuelve
exactamente las mismas temperaturas. Solo `nueva_semilla` (o el botón de
sortear) reparte un clima distinto.

## Almacenes: los tres tipos

El juego tiene tres sitios distintos donde puede vivir un ítem, y conviene
no confundirlos:

- **Inventario personal** — lo que un jugador lleva encima. Se gestiona con
  `/item usar|destroy|drop|grab`, y es lo único que cuenta para su capacidad
  de peso individual (`/stat modify stat:"Capacidad de inventario"`).
- **Almacén de una construcción** (`construction_storage`) — propio de
  **esa instancia concreta**, no del tipo ni del dueño. Aquí caen solas la
  producción pasiva y las recompensas de `/build usar`; se gestiona con
  `/build almacen_ver|almacen_depositar|almacen_retirar`. Cualquiera
  físicamente en la casilla puede mirar/depositar/retirar, no hace falta ser
  el dueño. Su capacidad se mide en **peso total** (por eso el `peso` de
  cada ítem importa al crearlo, ver "Ítems" arriba).
- **Almacén de facción** (`faction_storage`) — colectivo, compartido por
  toda la facción, no ligado a ninguna casilla. Se gestiona con `/faccion
  almacen_ver|almacen_depositar|almacen_retirar`. Es de donde sale el pago
  al **reclutar** un NPC, el respaldo del **mantenimiento** de una
  construcción cuando su propio almacén no alcanza, y la **comida** de los
  NPCs reclutados cuando hay un silo de recursos cerca (ver NPCs, más
  abajo) — siempre a **2 casillas o menos** de quien lo necesita.

## NPCs

Cada tipo de NPC aparece en los terrenos **y zonas** que Staff eligió, con un
porcentaje de aparición configurable en cada uno (catálogo `/npc-types` de
la web — no hay comando de Discord para el catálogo de tipos, solo para las
instancias ya colocadas o reclutadas).

Terreno y zona son **dos filtros que deben cumplirse los dos**. En cada lista,
dejarla vacía significa "en cualquiera":

- Sin terrenos ni zonas marcados: puede salir en cualquier parte, con su %
  general.
- Solo terrenos marcados: se comporta como siempre, restringido a ellos.
- Solo zonas marcadas: sale únicamente dentro de esas zonas, en cualquier
  terreno. Ojo: entonces **no** sale en las casillas que no tienen zona.
- Terrenos y zonas marcados: tienen que cumplirse ambos, p. ej. "lobos, solo
  en bosque, y solo en la zona Norte".

Si tanto el terreno como la zona fijan su propio %, **manda el de la zona**.

Un NPC **salvaje** (el que aparece solo, sin dueño) es de dos maneras:

- **Agresivo**: pausa el viaje de quien se lo encuentra y exige resolverlo
  antes de seguir — el jugador puede intentar huir, con un porcentaje de
  éxito que Staff también configura.
- **Pasivo**: puramente informativo, el viaje del jugador sigue sin
  interrupción.

### Segunda arma, curación y montura — el "kit" de combate de un tipo

Desde el catálogo `/npc-types` de la web, un tipo de NPC puede llevar tres
cosas más, todas opcionales e independientes entre sí:

- **Arma secundaria**: de respaldo, solo entra en juego cuando la principal
  no llega a la distancia del objetivo. Para que sirva de verdad, la
  **principal** debe ser la de cuerpo a cuerpo (la que se prefiere cuando el
  objetivo está pegado) y la **secundaria** la de alcance — al revés, la
  secundaria casi nunca se elegiría, porque un arma a distancia siempre
  "podría" llegar también a 0 casillas.
- **Ítem de curación**: cualquier ítem consumible (el mismo que un jugador
  usaría con `/item usar` — la cantidad curada es la misma) con un
  **alcance de curación** propio (`heal_range` del ítem, en el catálogo de
  Ítems). Antes de atacar, el NPC comprueba si él mismo o algún **aliado de
  su mismo grupo de encuentro** dentro de ese alcance está por debajo del
  **% de vida para curarse** que Staff fije — si lo hay, gasta el turno
  curando al que esté peor en vez de atacar. Sin heal_range (0), solo puede
  curarse a sí mismo.
- **Montura**: un ítem tipo Vehículo con un bonus de vida y de daño propios
  (`/item-admin`, o el catálogo de Ítems en la web) — TODO NPC de ese tipo
  nace con esa vida extra ya sumada a su tope, y su ataque suma ese daño
  extra. Pensado para jinetes o piratas montados/embarcados.

### NPCs reclutados — trabajan para un jugador

En una construcción que Staff marcó como **oficina de reclutamiento**
(`/construction modify reclutamiento:true`), un jugador puede levar un NPC
del catálogo con `/npc` (ver comandos abajo). El coste sale del **almacén
de su facción**, nunca de su inventario personal — reclutar es una
inversión colectiva, no algo que un jugador sin facción pueda hacer solo.

Un NPC reclutado tiene un **rol**, que su dueño fija y puede cambiar
libremente (`/npc rol`):

- **Productor**: genera algo con el tiempo, con el mismo devengo por ciclos
  que una construcción (perezoso + barrido de respaldo, tope de horas
  acumulables). Sin **herramienta equipada** (`/npc equipar`) no produce
  nada — es la herramienta la que decide QUÉ produce (Laburo directo al
  saldo del dueño, o un recurso físico que se acumula en el almacén propio
  del NPC) y a qué ritmo. Cambiar la herramienta cambia la producción al
  instante, sin reconfigurar nada más.
- **Soldado**: no produce nada — defiende su casilla en combate (ver
  "Combate" más arriba). Su herramienta equipada hace de arma en ese
  contraataque; sin herramienta, no tiene con qué defenderse.

**Comen a diario, o desertan.** Cada NPC reclutado consume comida (un ítem
consumible que ya reste hambre a un jugador, cualquiera vale) de su propio
almacén, o del almacén de facción si hay un **silo de recursos** de esa
misma facción a **2 casillas o menos** (`/construction modify silo:true`).
Sin comida disponible por ninguna de las dos vías, pasa hambre; **tres días
seguidos** sin comer y deserta — pierde dueño, rol y herramienta de golpe, y
vuelve a ser un NPC salvaje normal del mapa (la herramienta que llevara
puesta se pierde con él, no vuelve al inventario de nadie: es una deserción,
no un despido).

`/npc list` lista los NPCs reclutados de quien lo ejecuta; `/npc reubicar`
y `/npc recoger` mueven/recogen producción sin tener que pasar por
`/imperio`.

## Estados (efectos)

Un catálogo de condiciones temporales o permanentes que modifican a un
jugador día a día — típicamente Laburo ganado y/o HP perdido o ganado por
día, y opcionalmente pueden bloquear por completo la posibilidad de
trabajar (por ejemplo, "encarcelado"). Staff siembra por defecto: enfermo,
herido, fatigado, energizado, encarcelado — y puede ampliar el catálogo
libremente:

```
/effect create nombre:borracho label:Borracho emoji:🍺 laburo_mod:-0.3 hp_delta_dia:0
```

`laburo_mod` se suma (o resta) a lo que da `/laburo trabajar` mientras esté
activo; `hp_delta_dia` es el HP que gana/pierde el jugador cada día que lo
tenga puesto; `bloquea_laburar:true` le impide usar `/laburo trabajar` del
todo. Se aplica con `/effect add jugador:@alguien efecto:borracho [duracion_horas:24]`
(sin duración = permanente hasta que Staff lo quite con `/effect remove`).

## Mercado

Cualquier construcción concreta que Staff marcó como tipo mercado
(`/construction modify mercado:true`) puede convertirse en un **puesto de
comercio** — no hace falta que el dueño esté conectado para que otros le
compren. El dueño (o quien tenga permiso) abastece stock y fija precio en
Laburo sacándolo de su propio inventario (`/build mercado_stock`); cualquiera
físicamente en la casilla puede comprar mientras quede stock — el Laburo
pagado va **directo e íntegro** al dueño, sin ninguna comisión. El stock se
agota al venderse: no es un generador infinito, solo baja hasta que alguien
lo reabastezca a mano.

## Periódicos (Imprenta)

Dos caminos distintos llevan al mismo sitio — un canal de Discord propio de
un jugador para publicar en él como periódico.

**Camino 1 — ítem "disparador"**: un ítem marcado como tal, crafteado
estando en una construcción del tipo que la receta exige, crea
automáticamente un canal con nombre generado solo
(`periodico-<jugador>-<n>`) y un permiso curado: el dueño puede escribir,
gestionar sus propios mensajes y renombrar el canal; el resto del servidor
solo puede leerlo. Montarlo:

- **1.** Categoría de Discord donde se crean los canales:
   `/periodico categoria categoria:<la categoría que creaste>`.
- **2.** Tipo de construcción (opcionalmente con `requiere_recurso` si solo debe
   poder montarse en ciertas casillas):
   `/construction create nombre:imprenta display:Imprenta emoji:🖨️ laburo_coste:20 ingredientes:"madera:10,hierro:5"`.
- **3.** El ítem y su receta, en dos pasos:
   ```
   /item-admin create nombre:periodico display:"Edición del Periódico" tipo:consumible
   /item-admin receta item:periodico construccion:imprenta periodico:true laburo_coste:5
   ```
   `construccion:imprenta` obliga a estar en una casilla con la Imprenta
   construida. `periodico:true` es lo que dispara el canal — exige que
   `construccion` esté puesto en esa misma llamada, para que no cualquiera
   pueda generar canales desde cualquier sitio. Si más adelante cambias la
   receta, vuelve a poner `construccion:imprenta periodico:true` aunque no
   cambien — `/item-admin receta` reemplaza la receta entera, no la parchea.
- **4.** En juego: `/build place tipo:imprenta x:.. y:..`, luego `/craft item:periodico`
   estando ahí. El canal aparece solo, con mensaje de bienvenida. Cada
   repetición crea un canal **nuevo** numerado, no reescribe el anterior.

**Camino 2 — construir una imprenta directamente**: al levantar una
construcción del tipo `imprenta` en concreto, se avisa al dueño con un
botón para crear su periódico — al pulsarlo elige él mismo el nombre del
canal (no se genera solo), y el canal se crea con **todos los permisos de
Discord** a su favor sobre él, no solo el subconjunto curado del camino 1.

Ambos caminos pueden usarse por el mismo jugador — no son excluyentes, y
puede acabar con varios canales de periódico si repite cualquiera de los
dos.

## Apartado técnico

### Cómo crear un arma

Dos pasos: `/item-admin create tipo:arma` (identidad) y luego
`/item-admin arma` (estadísticas de combate) — `/item-admin arma` rechaza
el comando si el ítem no es `tipo:arma`.

```
/item-admin create nombre:rifle display:Rifle tipo:arma
/item-admin arma item:rifle dano:3 dado_1: dado_2:2 dado_3:2 dado_4:4 dado_5:4 dado_6:6 durabilidad:8
```

Cada `dado_N` es el alcance máximo de esa cara — si la tirada de alcance
saca ese número, el disparo llega a cualquier distancia entre 0 y ese
valor (no hace falta estar exactamente ahí). Vacío = esa cara falla
siempre, ni a bocajarro. `durabilidad` es cuántas veces puede sacar un `1`
en la tirada de resultado antes de romperse; vacío = irrompible. `dano` es
el HP base de un impacto normal (resultado 4) — la tabla de modificadores
de esa segunda tirada es igual para todas las armas: 3 = daño−1, 4 =
normal, 5 = daño+1, 6 = daño×2. `/item-admin arma` es edición **parcial**:
volver a llamarlo solo con `dano:4` sube el daño sin tocar el resto de la
tabla ya configurada.

Como cualquier `dado_N` con valor cubre desde 0 hasta ese número, ninguna
arma puede fallar a propósito a corta distancia — el arquetipo de un arma
se define por qué tan alto llegan sus caras, no por rangos con huecos: un
cuchillo lleva casi todas las caras en 1-2, un rifle de francotirador en
8-12, una escopeta casi todas en 2-3 (fiable pero corta).

**Munición** (opcional): `municion:<ítem>` + `municion_coste:<cantidad>`
(por defecto 1) hace que el arma consuma ese ítem **cada vez que se
dispara**, entre o no en alcance, acierte o falle — sin munición
suficiente, `/attack` se rechaza antes de tirar ningún dado. El Laburo no
puede usarse como munición.

Un arma de **rango 0** (solo utilizable compartiendo casilla con el
objetivo) se consigue poniendo **todas** las caras del dado de alcance a
`0` — el alcance máximo de cualquier cara es 0, así que solo entra en juego
a distancia 0.

### Cómo hacer una construcción destructible

Por defecto **nada** se puede destruir a cañonazos: hace falta activarlo a
propósito tanto en el tipo de construcción (cuánta vida tiene) como en el
arma (cuánto daño hace a estructuras).

- **1.** Tipo de construcción con vida limitada (por defecto todas tienen 10):
   `/construction create nombre:muro_madera display:"Muro de Madera" laburo_coste:10 ingredientes:"madera:15" vida:4`.
- **2.** Arma capaz de dañarla:
   ```
   /item-admin create nombre:dinamita display:Dinamita tipo:arma
   /item-admin arma item:dinamita dano_estructura:3 dado_1:0 dado_2:0 dado_3:0 dado_4:0 dado_5:0 dado_6:0 municion:mecha municion_coste:1
   ```
   No hace falta darle `dano` (a jugadores) si no quieres que también sirva
   para eso — puede tener solo `dano_estructura`, o al revés.
- **3.** En juego: `/attack construccion tipo:muro_madera x:.. y:.. arma:dinamita`
   — mismas dos tiradas que atacar a un jugador, pero sobre la vida de la
   construcción.

### Cómo crear un arma de área (tipo bomba nuclear)

Una vez `/attack jugador` impacta, si el arma tiene `area:true`, ese mismo
daño se extiende a **toda la casilla** del objetivo automáticamente, en el
mismo ataque.

- **1.** El estado que va a dejar (catálogo normal de `/effect`, nada nuevo):
   `/effect create nombre:radiacion label:Radiación emoji:☢️ hp_delta_dia:-2`.
- **2.** El arma, con daño a jugador, a estructuras, y el área activada:
   ```
   /item-admin create nombre:bomba_nuclear display:"Bomba Nuclear" tipo:arma
   /item-admin arma item:bomba_nuclear dano:8 dano_estructura:10
     dado_1:0 dado_2:0 dado_3:0 dado_4:0 dado_5:0 dado_6:0
     area:true area_efecto:radiacion area_efecto_horas:48
   ```
   `area:true` es el interruptor — sin él, `dano_estructura` y
   `area_efecto` no hacen nada por sí solos. `area_efecto_horas` es
   opcional; vacío = el estado dura para siempre hasta que Staff lo quite.
- **3.** En juego: si `/attack jugador jugador:@alguien arma:bomba_nuclear`
   impacta, además del objetivo, todo el resto de jugadores vivos en esa
   casilla reciben el mismo daño (sin tirada aparte), toda construcción ahí
   recibe `dano_estructura`, y todos los afectados reciben `radiacion` —
   incluido el propio atacante, si comparte casilla.

### Terrenos que exigen vehículo

El terreno no es una lista fija — Staff puede crear tipos nuevos con su
propio color y, opcionalmente, qué categoría de vehículo exige `/move` para
entrar.

- **1.** El vehículo, un ítem normal marcado como tal:
   ```
   /item-admin create nombre:barco display:Barco tipo:vehiculo
   /item-admin vehiculo item:barco categoria:maritimo
   ```
   Categorías: `maritimo`, `terrestre`, o `aereo` (especial, ver siguiente
   punto).
- **2.** El terreno que lo exige:
   `/terrain create nombre:mar display:Mar color:#1B6FA8 emoji:🌊 vehiculo_categoria:maritimo`.
- **3.** Los vehículos **aéreos** son distintos a propósito: sobrevuelan
   cualquier terreno (no hace falta que sea justo su categoría), pero la
   casilla **destino** debe tener una construcción marcada como aterrizaje:
   `/construction modify nombre:aeropuerto aterrizaje:true`. Puede haber
   varias construcciones de aterrizaje a la vez — basta con que el destino
   tenga una, viva (no en ruinas).
- **4.** En juego: `/move` a una casilla `mar` sin barco → rechazado; con el
   barco en el inventario (no se consume) → permitido. Con una avioneta
   pero sin aeropuerto en el destino → rechazado, aunque el terreno pidiera
   `maritimo` y la avioneta sea `aereo`.

### Cómo expandir el mapa

En vez de `/map create` casilla por casilla:
```
/map create-range x1:0 y1:0 x2:19 y2:19 nombre:"Llanura Meridional" tipo:yermo recurso:piedra
```
Crea todas las casillas que falten en ese rectángulo con el mismo
nombre/tipo/recurso — luego se pueden personalizar casillas concretas con
`/map edit` sin perder las demás. Si repites el mismo rango más tarde, las
casillas que ya existan no se tocan. Límite de 2500 casillas por llamada —
para mapas más grandes, divide en varias llamadas. `/faccion-admin asignar`
y `/zona asignar` funcionan igual por rango, pero solo sobre casillas que
**ya existen**.

### El mapa web para Staff

Panel Astro con sesión propia (login por Discord OAuth2, mismo rol de
Rolepriest que Discord) en un subdominio aparte, compartiendo la misma base
de datos MySQL que el bot. Cada sección tiene su propia URL real (no hash
routing): `/mapa` (editor visual, ver abajo), `/mapamundi` (lo mismo que ve
un jugador, para comprobarlo sin salir del panel), `/items`,
`/terrain-types`, `/zonas`, `/construction-types`, `/npc-types`, `/effect-types`,
`/facciones`, `/players`, `/audit-log` (registro de acciones de Staff,
tanto hechas desde la web como desde Discord), `/mechanics` (todos los
ajustes configurables: cooldowns, límite del mapa, sesión, movimiento
libre...), `/terminal`, `/backups`, `/modmail-categorias` y esta misma guía
en `/docs`.

**El mapa (`/mapa`)**: pan/zoom con el ratón, clic para ver/editar una
casilla, Shift+clic para seleccionar varias, Shift+arrastrar para
seleccionar un rectángulo entero (repintar terreno, crear/rellenar huecos,
o asignar facción o zona, según el modo activo en la barra superior). El
botón **Zonas** muestra u oculta el contorno de color de cada zona sobre el
mapa. El botón
**Pincel** repinta terreno arrastrando sin necesidad de marcar un
rectángulo. El botón **Recursos** marca en el mapa qué casillas tienen algo
recolectable (por su terreno o por su recurso propio) — el detalle completo
de una casilla lista esos recursos con su %.

**Actualización en vivo**: la mayoría de páginas se refrescan solas al
momento si otro Rolepriest cambia algo desde la web o desde Discord
(Server-Sent Events, `/api/events`) — no hace falta recargar a mano. La
sesión caduca por inactividad tras los minutos que fije Mecánicas (30 por
defecto); cualquier clic, tecla o movimiento del ratón la renueva.

**Límite conocido**: el panel de casilla no permite reasignar dueño
todavía — para eso sigue haciendo falta `/map setowner` en Discord.

### Mapa del mundo para jugadores (`/mapamundi`)

Página pública, servida por el mismo panel Astro. La posición sale de la
BD por el `discord_id` de la sesión — el endpoint no acepta coordenadas de
ninguna clase, así que no hay forma de pedir la vista de otro punto ni de
otra persona. Dentro de un radio corto (distancia de Chebyshev) van
casillas completas, jugadores, construcciones y NPCs; fuera solo viaja la
coordenada de cada casilla, para pintar la silueta gris. De los demás
jugadores solo sale su nombre de personaje: ningún `discord_id` ni
`@usuario`.

### Variables de entorno relevantes (`.env`)

- `STAFF_ALERTS_CHANNEL_ID` — canal donde el bot vuelca automáticamente
  todos sus `warn`/`error` (fallos de backup, excepciones de comandos...).
- `MODMAIL_CATEGORY_ID` — categoría donde se crean los canales privados de
  Staff al hacer `/personaje crear`.
- `NEWSPAPER_CATEGORY_ID` — fallback de la categoría de periódicos (mejor
  usar `/periodico categoria`, que no necesita reiniciar el bot).
- `BACKUP_CRON`, `BACKUP_RETENTION`, `BACKUP_DIR` — copias de seguridad
  rotativas (opcionales, tienen valores por defecto razonables; también
  configurables en caliente desde `/backups` en la web).
- `DISCORD_CLIENT_SECRET`, `MAP_SERVER_PUBLIC_URL`, `MAP_SERVER_SESSION_SECRET`
  — panel web para Staff: login por Discord OAuth2, servicio Docker aparte.

Los comandos se registran solos en Discord cada vez que el bot arranca —
basta con reiniciar el contenedor tras cambiar nombres/opciones. Los de
**Staff** se registran en el servidor (instantáneo); los de **jugador** se
registran de forma **global** con el contexto de MD activado — la única
forma de que funcionen por Mensaje Directo — así que tardan hasta **1 hora**
en propagarse tras un cambio de nombre/opciones.

### Despliegue: cuidado con los comandos "zombie"

El despliegue a producción es copia manual de ficheros (no `git clone`/
`git pull`), lo que tiene una trampa: si en local se borra, mueve o
renombra un archivo de `src/commands/`, `src/services/` o `src/utils/`, y
el despliegue solo copia lo nuevo/cambiado, el archivo viejo se queda
huérfano en el servidor. Eso es peligroso porque el cargador de comandos
recorre carpetas en orden alfabético y el último que carga **sobreescribe**
en el mapa de comandos a cualquiera anterior con el mismo nombre — un
archivo zombie en `staff/` puede pisar silenciosamente a la versión buena
en `player/`.

**Cómo detectarlo**: al arrancar, el bot avisa en el log si hay un nombre
duplicado, indicando qué archivo ganó la sobreescritura.

**Cómo evitarlo en cada despliegue**: sincroniza con borrado incluido en
vez de copiar archivo por archivo:
```
rsync -av --delete --exclude 'data/' --exclude 'node_modules/' --exclude '.env' ./ usuario@servidor:/ruta/del/bot/
```
El `--delete` es la parte clave: borra en el servidor cualquier archivo que
ya no exista en local. Los `--exclude` protegen la base de datos,
dependencias y secretos de que un `rsync` mal apuntado los destruya.

## Límites conocidos

- **Propiedad de construcciones**: `/build destroy`/`usar`/`repostar`/
  `reparar` comprueban quién puede hacer cada acción, pero **por defecto
  siguen abiertos a cualquiera** (`destruir_politica`/`usar_politica`/
  `repostar_politica`/`reparar_politica` = `any` de serie) — Staff tiene que
  restringir tipo por tipo con `/construction modify` si quiere que solo el
  dueño (o su facción, o Rolepriest) pueda hacerlo. `/attack construccion`
  (dañar/arruinar) sigue sin ninguna comprobación de propiedad — cualquiera
  puede atacar y arruinar construcciones ajenas, sin excepción.
- **Capacidad/intervalo de producción de una construcción**
  (`storage_capacity`/`production_interval_hours`/`max_accrual_hours`) no
  son configurables hoy por ningún comando ni por la web — todo tipo nace
  sin límite de peso, produce cada 24h y acumula hasta 48h.
- El panel de casilla de la web no permite reasignar dueño — sigue haciendo
  falta `/map setowner` en Discord.
