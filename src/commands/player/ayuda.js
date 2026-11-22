import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { COLORS } from '../../utils/embeds.js';

const SECTIONS = [
  {
    name: '🎮 Todo a clics: /jugar',
    value:
      '`/jugar` — abre tu panel privado: ficha resumida arriba y un desplegable con **Inventario**, **Fabricar**, **Construir**, **Combate**, **Mapa y viaje** y **Personaje**. ' +
      'Hace casi todo lo de abajo sin escribir nada, así que si eres nuevo empieza por aquí.\n' +
      'Los comandos de texto de esta guía **siguen funcionando todos** — son la vía rápida si ya te los sabes, y la única para lo que el menú no cubre (foto al crear personaje, atacar construcciones a distancia, viajar lejos con coordenadas).',
  },
  {
    name: '🧍 Empezar',
    value:
      '`/personaje crear` — nombre completo, nacionalidad y foto opcional. Sin esto no puedes hacer nada más.\n' +
      '`/personaje foto` — pon (o cambia) la foto de tu personaje cuando quieras.\n' +
      '`/personaje ficha` — tu ficha: HP, hambre, posición, nación.\n' +
      '`/personaje alertas` — panel de interruptores para elegir qué avisos te llegan por MD.\n' +
      'Al crear tu personaje se abre un canal privado **rp-<tu-personaje>**, visible solo para ti y Staff — puedes rolear ahí directamente, o seguir escribiendo por **MD al bot** (se retransmite igual, usa el que prefieras).',
  },
  {
    name: '❤️ Vida y hambre',
    value:
      'HP y Hambre van de 0 a 10. Cada día tu hambre baja 1 — si llega a 0 pierdes vida; si te mantienes bien alimentado (hambre al máximo), regeneras vida solo.\n' +
      'Si tu HP llega a 0, mueres. Tienes **7 días de gracia** con tu personaje intacto para que Staff te reviva — pasado ese plazo, o si usas `/personaje rendirse` para no esperar, se borra del todo y puedes crear uno nuevo.',
  },
  {
    name: '🗺️ Mapa y movimiento',
    value:
      '`/casilla info` — qué hay en tu casilla ahora mismo.\n' +
      '`/move x y` — empieza un viaje: **3 casillas/hora** en línea recta (más rápido con vehículo). Sigues siendo visible y atacable en cada casilla por la que pasas.\n' +
      '`/move` (sin nada) — consulta tu viaje en curso. `/move cancelar:true` — lo detiene donde estés.',
  },
  {
    name: '🎒 Objetos',
    value:
      '`/item list` — catálogo completo de objetos del servidor.\n' +
      '`/personaje inventario` — lo que llevas encima.\n' +
      '`/item grab` / `/item drop` — recoger o tirar del suelo de tu casilla.\n' +
      '`/item usar item` — usa un consumible y aplica su efecto.',
  },
  {
    name: '🔨 Crafteo',
    value:
      '`/craft item` — fabrica algo con lo que llevas. Cada receta pide ingredientes y a veces Laburo, una construcción cerca, o una herramienta que abarata el coste.',
  },
  {
    name: '💪 Laburo (la moneda)',
    value:
      '`/laburo trabajar` — trabaja para ganar Laburo (cooldown de 23h).\n' +
      '`/laburo trade jugador cantidad` — dale parte del tuyo a alguien en tu misma casilla.',
  },
  {
    name: '🤝 Comercio',
    value: '`/trade jugador item cantidad` — pásale objetos a otro jugador en tu misma casilla.',
  },
  {
    name: '🏗️ Construcciones y vehículos',
    value:
      '`/build list` / `place` / `usar` / `repostar` — construye e interactúa con edificios de tu casilla.\n' +
      'Poseer un **vehículo** en tu inventario te deja cruzar terreno que lo exija (agua, aire...) y acelera `/move` — no hace falta "montarlo".',
  },
  {
    name: '⚔️ Combate',
    value:
      '`/attack` (sin opciones) — a clics: eliges arma y luego objetivo (jugador, NPC o construcción) entre **todo lo que esa arma alcanza**, no solo tu casilla. Te dice a qué distancia está cada uno y con cuántas de las 6 caras llegas. Es la única forma de atacar a un NPC. Si sobrevive contraataca, pero solo si SU arma te alcanza a ti.\n' +
      '`/attack jugador:<jugador> [arma]` — con arma es a distancia; sin arma, cuerpo a cuerpo (misma casilla).\n' +
      '`/attack tipo:<tipo> arma:<arma>` — ataca un edificio del mapa.\n' +
      '`/huir` — intentas escapar de un NPC que te ha salido al paso.\n' +
      'Fallar puede dañar tu propia arma, o hacerte daño si peleas cuerpo a cuerpo.',
  },
  {
    name: '🏳️ Facciones',
    value:
      '`/faccion list` — territorios existentes.\n' +
      '`/faccion solicitar` — pide ciudadanía en la facción cuyo territorio pisas. `/faccion abandonar` — deja la tuya.',
  },
];

export default {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Guía rápida de roleo: cómo empezar y qué puedes hacer'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setTitle('📖 Guía de Roleo — Ricardana RP')
      .setDescription('Los comandos son `/slash` — escríbelos y Discord te guía con las opciones.')
      .addFields(SECTIONS)
      .setFooter({ text: '¿Dudas? Pregunta a Staff o a un Rolepriest. ¡A rolear! 🖋️' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
