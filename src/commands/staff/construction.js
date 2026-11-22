import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  listConstructionTypes,
  getIngredients,
  createConstructionType,
  updateConstructionType,
  deleteConstructionType,
  configureConstructionUse,
} from '../../services/constructionTypeService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }           from '../../utils/embeds.js';
import { handleItemAutocomplete, handleConstructionTypeAutocomplete } from '../../utils/autocomplete.js';
import { parseIngredients }   from '../../utils/ingredients.js';
import logger                from '../../utils/logger.js';
import { logAction }          from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('construction')
    .setDescription('Gestiona el catálogo de tipos de construcción')

    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('[Rolepriest] Crea un nuevo tipo de construcción en el catálogo')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre clave único (ej: taller_rifles)').setRequired(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nombre para mostrar (ej: Taller de Rifles)').setRequired(true))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji (ej: 🔫)').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción corta').setRequired(false))
        .addNumberOption(opt => opt.setName('laburo_coste').setDescription('Coste en Laburo para construir').setRequired(false).setMinValue(0))
        .addStringOption(opt => opt.setName('ingredientes').setDescription('Receta: "item:cant,item:cant"').setRequired(false))
        .addStringOption(opt => opt.setName('requiere_recurso').setDescription('Recurso de casilla necesario (ej: piedra) — vacío = cualquiera').setRequired(false))
        .addStringOption(opt => opt.setName('desbloquea_item').setDescription('Ítem cuya receta de crafteo desbloquea').setRequired(false))
        .addStringOption(opt => opt.setName('otorga_item').setDescription('Ítem que empieza a generar la casilla al construirse (opcional)').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('otorga_tasa').setDescription('Unidades/día del ítem otorgado').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('vida').setDescription('Vida máxima de este tipo, 1-1000 (por defecto: 10)').setRequired(false).setMinValue(1).setMaxValue(1000))
        .addIntegerOption(opt => opt.setName('durabilidad_maxima').setDescription('Durabilidad máxima de este tipo, 1-1000 (por defecto: 100)').setRequired(false).setMinValue(1).setMaxValue(1000))
        .addStringOption(opt => opt.setName('combustible_item').setDescription('Ítem-combustible (marcado con /item modify combustible:true) que exige el generador').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('combustible_tasa').setDescription('Unidades de combustible consumidas del depósito por día de reparto').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('combustible_capacidad').setDescription('Capacidad máxima del depósito de cada instancia (vacío = sin límite)').setRequired(false).setMinValue(0))
        .addBooleanOption(opt => opt.setName('aterrizaje').setDescription('¿Sirve de destino para vehículos aéreos con /move? (ver /item vehiculo)').setRequired(false))
    )

    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('[Rolepriest] Edita un tipo de construcción ya existente')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a editar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
        .addNumberOption(opt => opt.setName('laburo_coste').setDescription('Nuevo coste en Laburo').setRequired(false).setMinValue(0))
        .addStringOption(opt => opt.setName('requiere_recurso').setDescription('Nuevo recurso requerido').setRequired(false))
        .addStringOption(opt => opt.setName('desbloquea_item').setDescription('Nuevo ítem cuya receta de crafteo desbloquea (vacío en el catálogo = quitar)').setRequired(false))
        .addStringOption(opt => opt.setName('otorga_item').setDescription('Nuevo ítem que genera la casilla (usa junto a otorga_tasa)').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('otorga_tasa').setDescription('Nuevas unidades/día del ítem otorgado').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('vida').setDescription('Nueva vida máxima, 1-1000 (no afecta a instancias ya construidas)').setRequired(false).setMinValue(1).setMaxValue(1000))
        .addStringOption(opt => opt.setName('combustible_item').setDescription('Nuevo ítem-combustible que exige el generador').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('combustible_tasa').setDescription('Nuevas unidades de combustible consumidas por día').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('combustible_capacidad').setDescription('Nueva capacidad máxima del depósito').setRequired(false).setMinValue(0))
        .addBooleanOption(opt => opt.setName('aterrizaje').setDescription('¿Sirve de destino para vehículos aéreos con /move?').setRequired(false))

        .addStringOption(opt => opt.setName('destruir_politica').setDescription('¿Quién puede destruirla con /build destroy?').setRequired(false)
          .addChoices(
            { name: 'Cualquiera (por defecto)', value: 'any' },
            { name: 'Solo quien la construyó', value: 'owner' },
            { name: 'Solo su misma facción', value: 'faccion' },
            { name: 'Solo Rolepriest', value: 'rolepriest' },
          ))
        .addStringOption(opt => opt.setName('usar_politica').setDescription('¿Quién puede usarla con /build usar?').setRequired(false)
          .addChoices(
            { name: 'Cualquiera (por defecto)', value: 'any' },
            { name: 'Solo quien la construyó', value: 'owner' },
            { name: 'Solo su misma facción', value: 'faccion' },
            { name: 'Solo Rolepriest', value: 'rolepriest' },
          ))
        .addStringOption(opt => opt.setName('repostar_politica').setDescription('¿Quién puede repostarla con /build repostar?').setRequired(false)
          .addChoices(
            { name: 'Cualquiera (por defecto)', value: 'any' },
            { name: 'Solo quien la construyó', value: 'owner' },
            { name: 'Solo su misma facción', value: 'faccion' },
            { name: 'Solo Rolepriest', value: 'rolepriest' },
          ))
        .addStringOption(opt => opt.setName('reparar_politica').setDescription('¿Quién puede repararla con /build reparar?').setRequired(false)
          .addChoices(
            { name: 'Cualquiera (por defecto)', value: 'any' },
            { name: 'Solo quien la construyó', value: 'owner' },
            { name: 'Solo su misma facción', value: 'faccion' },
            { name: 'Solo Rolepriest', value: 'rolepriest' },
          ))

        .addBooleanOption(opt => opt.setName('mercado').setDescription('¿Puede una instancia de este tipo actuar como puesto de comercio (/build mercado_stock|comprar)?').setRequired(false))

        .addBooleanOption(opt => opt.setName('reclutamiento').setDescription('¿Sirve como oficina de reclutamiento (/build reclutar)?').setRequired(false))

        .addBooleanOption(opt => opt.setName('silo').setDescription('¿Silo de recursos? Da acceso al almacén de facción a NPCs a ≤2 casillas').setRequired(false))

        .addStringOption(opt => opt.setName('mantenimiento_item').setDescription('Ítem que consume a diario para mantenerse (vacío = sin mantenimiento)').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('mantenimiento_tasa').setDescription('Unidades/día que consume de mantenimiento').setRequired(false).setMinValue(0.01))

        .addNumberOption(opt => opt.setName('ruta_multiplicador').setDescription('¿Es infraestructura de ruta? Multiplicador de coste de viaje en su casilla (0.01-1, def. 1=ninguno)').setRequired(false).setMinValue(0.01).setMaxValue(1))
    )

    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('[Rolepriest] Elimina un tipo de construcción (si no hay instancias construidas)')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a eliminar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Lista el catálogo de tipos de construcción')
        .addStringOption(opt => opt.setName('buscar').setDescription('Filtra por texto en el nombre').setRequired(false))
    )

    .addSubcommand(sub =>
      sub
        .setName('usar')
        .setDescription('[Rolepriest] Configura la interacción activa (/build usar) de un tipo — edición parcial')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a configurar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('herramienta').setDescription('Ítem que hace falta tener para usarla (vacío = ninguna)').setRequired(false).setAutocomplete(true))
        .addStringOption(opt => opt.setName('resultado').setDescription('Ítem que se obtiene al usarla').setRequired(false).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('dado_1').setDescription('Unidades obtenidas si sale un 1 (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_2').setDescription('Unidades obtenidas si sale un 2 (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_3').setDescription('Unidades obtenidas si sale un 3 (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_4').setDescription('Unidades obtenidas si sale un 4 (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_5').setDescription('Unidades obtenidas si sale un 5 (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_6').setDescription('Unidades obtenidas si sale un 6 (vacío=falla)').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('laburo_coste').setDescription('Coste en Laburo por cada uso (vacío = gratis)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('cooldown_horas').setDescription('Horas de cooldown por jugador+instancia (vacío = sin cooldown)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('durabilidad')
        .setDescription('[Rolepriest] Configura el desgaste diario de durabilidad de un tipo — edición parcial')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a configurar').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('maxima').setDescription('Durabilidad máxima, 1-1000 (no afecta a instancias ya construidas)').setRequired(false).setMinValue(1).setMaxValue(1000))
        .addNumberOption(opt => opt.setName('perdida_dia').setDescription('Unidades de durabilidad que pierde cada día (vacío = sin desgaste)').setRequired(false).setMinValue(0.01))
        .addStringOption(opt => opt.setName('herramienta').setDescription('Herramienta que hace falta TENER para restaurarla, no se gasta (vacío = cualquiera)').setRequired(false).setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'nombre') {
      await handleConstructionTypeAutocomplete(interaction);
    } else {
      await handleItemAutocomplete(interaction);
    }
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const buscarFilter = interaction.options.getString('buscar')?.toLowerCase().trim();
      let types = await listConstructionTypes();
      if (buscarFilter) {
        types = types.filter(t =>
          t.display_name.toLowerCase().includes(buscarFilter) || t.name.toLowerCase().includes(buscarFilter)
        );
      }

      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('🏗️ Catálogo de tipos de construcción').setTimestamp();

      if (types.length === 0) {
        embed.setDescription(
          buscarFilter ? '*Ningún tipo coincide con ese filtro.*' : '*No hay ningún tipo de construcción definido todavía.*'
        );
      } else {
        for (const t of types) {
          const ingredients = await getIngredients(t.id);
          const lines = [];
          if (t.requires_resource_type) lines.push(`📍 Requiere recurso: **${t.requires_resource_type}**`);
          if (ingredients.length > 0) lines.push(ingredients.map(i => `${i.emoji ?? '📦'} ${i.display_name} ×${i.quantity_required}`).join(', '));
          if (t.laburo_cost > 0) lines.push(`💪 Laburo ×${t.laburo_cost}`);
          if (t.grants_resource_item_id) lines.push(`⚙️ Otorga generador: +${t.grants_resource_rate}/día`);
          if (t.fuel_item_id) lines.push(`⛽ Exige combustible: -${t.fuel_consumption_rate ?? 0}/día${t.fuel_capacity != null ? ` (depósito: ${t.fuel_capacity})` : ''}`);
          if (t.is_landing_site) lines.push('🛬 Sirve de aterrizaje para vehículos aéreos');
          if (t.is_market) lines.push('🏪 Puede actuar como puesto de comercio');
          if (t.is_recruitment_office) lines.push('🚩 Oficina de reclutamiento (/build reclutar)');
          if (t.is_resource_silo) lines.push('🌾 Silo de recursos (acceso al almacén de facción para comida de NPCs)');
          if (t.maintenance_item_id) lines.push(`🔧 Exige mantenimiento: -${t.maintenance_rate ?? 0}/día (para o se daña sin pagar)`);
          if (t.durability_loss_per_day) lines.push(`🛠️ Durabilidad: -${t.durability_loss_per_day}/día${t.durability_repair_tool_item_name ? ` (se restaura con \`${t.durability_repair_tool_item_name}\`)` : ' (cualquiera puede restaurarla)'}`);
          if (t.travel_cost_multiplier !== 1) lines.push(`🛣️ Infraestructura de ruta: abarata el viaje ×${t.travel_cost_multiplier}`);
          lines.push(`❤️ Vida: ${t.max_health}`);
          if (t.durability_loss_per_day) lines.push(`🛠️ Durabilidad máxima: ${t.max_durability}`);

          const restrictedPolicies = [
            ['destroy_policy', '🗑️ Destruir'], ['use_policy', '🔧 Usar'],
            ['refuel_policy', '⛽ Repostar'], ['repair_policy', '🩹 Reparar'],
          ].filter(([col]) => t[col] && t[col] !== 'any');
          if (restrictedPolicies.length > 0) {
            lines.push(`🔒 ${restrictedPolicies.map(([col, label]) => `${label}: ${t[col]}`).join(' · ')}`);
          }
          embed.addFields({
            name:  `${t.emoji} ${t.display_name} (\`${t.name}\`)`,
            value: lines.length > 0 ? lines.join('\n') : '*Sin requisitos*',
          });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (!await requireRolepriest(interaction)) return;

    if (sub === 'create') {
      const nombre       = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display      = interaction.options.getString('display', true).trim();
      const emoji        = interaction.options.getString('emoji') ?? '🏗️';
      const descripcion  = interaction.options.getString('descripcion') ?? '';
      const laburoCoste  = interaction.options.getNumber('laburo_coste') ?? 0;
      const ingredientesRaw = interaction.options.getString('ingredientes') ?? null;
      const requiereRecurso = interaction.options.getString('requiere_recurso') ?? null;
      const desbloqueaItem  = interaction.options.getString('desbloquea_item') ?? null;
      const otorgaItem      = interaction.options.getString('otorga_item') ?? null;
      const otorgaTasa      = interaction.options.getNumber('otorga_tasa') ?? null;
      const vida            = interaction.options.getInteger('vida') ?? 10;
      const durabilidadMaxima = interaction.options.getInteger('durabilidad_maxima') ?? 100;
      const combustibleItem     = interaction.options.getString('combustible_item') ?? null;
      const combustibleTasa     = interaction.options.getNumber('combustible_tasa') ?? null;
      const combustibleCapacidad = interaction.options.getNumber('combustible_capacidad') ?? null;
      const aterrizaje           = interaction.options.getBoolean('aterrizaje') ?? false;

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.reply({
          content: '❌ El nombre solo puede contener minúsculas, números, guiones y guiones bajos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let ingredients = [];
      try {
        ingredients = parseIngredients(ingredientesRaw);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      let created;
      try {
        created = await createConstructionType({
          name: nombre, displayName: display, emoji, description: descripcion,
          laburoCost: laburoCoste, requiresResourceType: requiereRecurso,
          unlocksItemName: desbloqueaItem,
          grantsResourceItemName: otorgaItem, grantsResourceRate: otorgaTasa,
          ingredients, maxHealth: vida, maxDurability: durabilidadMaxima,
          fuelItemName: combustibleItem, fuelConsumptionRate: combustibleTasa, fuelCapacity: combustibleCapacidad,
          isLandingSite: aterrizaje,
        });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/construction create] ${interaction.user.tag} creó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'construction.create', target: nombre });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`✅ Tipo de construcción creado: ${emoji} ${display}`)
        .addFields(
          { name: '🔑 Nombre clave', value: `\`${nombre}\``, inline: true },
          { name: '💪 Laburo',       value: `${laburoCoste}`, inline: true },
          { name: '❤️ Vida',         value: `${vida}`, inline: true },
          { name: '🛠️ Durabilidad',  value: `${durabilidadMaxima}`, inline: true }
        )
        .setFooter({ text: `Creado por ${interaction.user.tag}` })
        .setTimestamp();

      if (requiereRecurso) embed.addFields({ name: '📍 Requiere recurso', value: requiereRecurso, inline: true });
      if (ingredients.length > 0) embed.addFields({ name: '🧰 Ingredientes', value: ingredients.map(i => `\`${i.name}\` ×${i.quantity}`).join('\n') });
      if (desbloqueaItem) embed.addFields({ name: '📖 Desbloquea', value: desbloqueaItem, inline: true });
      if (otorgaItem) embed.addFields({ name: '⚙️ Otorga generador', value: `${otorgaItem} × ${otorgaTasa ?? 0}/día`, inline: true });
      if (combustibleItem) embed.addFields({ name: '⛽ Combustible', value: `${combustibleItem} × ${combustibleTasa ?? 0}/día${combustibleCapacidad != null ? ` (depósito: ${combustibleCapacidad})` : ''}`, inline: true });
      if (aterrizaje) embed.addFields({ name: '🛬 Aterrizaje', value: 'Sirve de destino para vehículos aéreos', inline: true });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'modify') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      const updates = {};
      const display = interaction.options.getString('display');
      const emoji = interaction.options.getString('emoji');
      const descripcion = interaction.options.getString('descripcion');
      const laburoCoste = interaction.options.getNumber('laburo_coste');
      const requiereRecurso = interaction.options.getString('requiere_recurso');
      const desbloqueaItem = interaction.options.getString('desbloquea_item');
      const otorgaItem = interaction.options.getString('otorga_item');
      const otorgaTasa = interaction.options.getNumber('otorga_tasa');
      const vida = interaction.options.getInteger('vida');
      const combustibleItem      = interaction.options.getString('combustible_item');
      const combustibleTasa      = interaction.options.getNumber('combustible_tasa');
      const combustibleCapacidad = interaction.options.getNumber('combustible_capacidad');
      const aterrizaje           = interaction.options.getBoolean('aterrizaje');
      const destruirPolitica     = interaction.options.getString('destruir_politica');
      const usarPolitica         = interaction.options.getString('usar_politica');
      const repostarPolitica     = interaction.options.getString('repostar_politica');
      const repararPolitica      = interaction.options.getString('reparar_politica');
      const mercado              = interaction.options.getBoolean('mercado');
      const reclutamiento        = interaction.options.getBoolean('reclutamiento');
      const silo                 = interaction.options.getBoolean('silo');
      const rutaMultiplicador    = interaction.options.getNumber('ruta_multiplicador');
      const mantenimientoItem    = interaction.options.getString('mantenimiento_item');
      const mantenimientoTasa    = interaction.options.getNumber('mantenimiento_tasa');

      if (display !== null) updates.displayName = display;
      if (emoji !== null) updates.emoji = emoji;
      if (descripcion !== null) updates.description = descripcion;
      if (laburoCoste !== null) updates.laburoCost = laburoCoste;
      if (requiereRecurso !== null) updates.requiresResourceType = requiereRecurso;
      if (desbloqueaItem !== null) updates.unlocksItemName = desbloqueaItem;
      if (otorgaItem !== null) updates.grantsResourceItemName = otorgaItem;
      if (otorgaTasa !== null) updates.grantsResourceRate = otorgaTasa;
      if (vida !== null) updates.maxHealth = vida;
      if (combustibleItem !== null) updates.fuelItemName = combustibleItem;
      if (combustibleTasa !== null) updates.fuelConsumptionRate = combustibleTasa;
      if (combustibleCapacidad !== null) updates.fuelCapacity = combustibleCapacidad;
      if (aterrizaje !== null) updates.isLandingSite = aterrizaje;
      if (destruirPolitica !== null) updates.destroyPolicy = destruirPolitica;
      if (usarPolitica !== null) updates.usePolicy = usarPolitica;
      if (repostarPolitica !== null) updates.refuelPolicy = repostarPolitica;
      if (repararPolitica !== null) updates.repairPolicy = repararPolitica;
      if (mercado !== null) updates.isMarket = mercado;
      if (reclutamiento !== null) updates.isRecruitmentOffice = reclutamiento;
      if (silo !== null) updates.isResourceSilo = silo;
      if (rutaMultiplicador !== null) updates.travelCostMultiplier = rutaMultiplicador;
      if (mantenimientoItem !== null) updates.maintenanceItemName = mantenimientoItem;
      if (mantenimientoTasa !== null) updates.maintenanceRate = mantenimientoTasa;

      let updated;
      try {
        updated = await updateConstructionType(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/construction modify] ${interaction.user.tag} editó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'construction.update', target: nombre, details: updates });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle(`✏️ Tipo actualizado: ${updated.emoji} ${updated.display_name}`)
            .setFooter({ text: `Editado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'delete') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      let deleted;
      try {
        deleted = await deleteConstructionType(nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/construction delete] ${interaction.user.tag} eliminó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'construction.delete', target: nombre });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Tipo eliminado: ${deleted.emoji} ${deleted.display_name}`)
            .setFooter({ text: `Eliminado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'usar') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      const updates = {};
      const herramienta = interaction.options.getString('herramienta');
      const resultado    = interaction.options.getString('resultado');
      if (herramienta !== null) updates.toolItemName = herramienta.toLowerCase().trim();
      if (resultado !== null) updates.resultItemName = resultado.toLowerCase().trim();
      for (let i = 1; i <= 6; i++) {
        const v = interaction.options.getInteger(`dado_${i}`);
        if (v !== null) updates[`roll${i}`] = v;
      }
      const laburoCoste = interaction.options.getNumber('laburo_coste');
      if (laburoCoste !== null) updates.laburoCost = laburoCoste;
      const cooldownHoras = interaction.options.getInteger('cooldown_horas');
      if (cooldownHoras !== null) updates.cooldownHours = cooldownHoras;

      let updated;
      try {
        updated = await configureConstructionUse(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/construction usar] ${interaction.user.tag} configuró la interacción de "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'construction.configure_use', target: nombre, details: updates });

      const dadoLines = [1, 2, 3, 4, 5, 6].map(n => {
        const v = updated[`use_roll_${n}`];
        return `🎲 ${n}: ${v != null ? `${v} unidad(es)` : 'falla'}`;
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🎲 Interacción configurada: ${updated.emoji} ${updated.display_name}`)
        .addFields(
          { name: '🔧 Herramienta', value: updated.use_tool_item_name ? `\`${updated.use_tool_item_name}\`` : '*Ninguna*', inline: true },
          { name: '📦 Resultado', value: updated.use_result_item_id ? `ítem #${updated.use_result_item_id}` : '*Sin configurar*', inline: true },
          { name: '💪 Laburo/uso', value: updated.use_laburo_cost ? `${updated.use_laburo_cost}` : 'Gratis', inline: true },
          { name: '⏳ Cooldown', value: updated.use_cooldown_hours ? `${updated.use_cooldown_hours}h` : 'Sin cooldown', inline: true },
          { name: '🎯 Tabla de tirada (1d6)', value: dadoLines.join('\n') }
        )
        .setFooter({ text: `Configurada por ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'durabilidad') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      const updates = {};
      const maxima = interaction.options.getInteger('maxima');
      const perdidaDia = interaction.options.getNumber('perdida_dia');
      const herramienta = interaction.options.getString('herramienta');
      if (maxima !== null) updates.maxDurability = maxima;
      if (perdidaDia !== null) updates.durabilityLossPerDay = perdidaDia;
      if (herramienta !== null) updates.durabilityRepairToolItemName = herramienta.toLowerCase().trim();

      let updated;
      try {
        updated = await updateConstructionType(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/construction durabilidad] ${interaction.user.tag} configuró la durabilidad de "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'construction.configure_durability', target: nombre, details: updates });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🛠️ Durabilidad configurada: ${updated.emoji} ${updated.display_name}`)
        .addFields(
          { name: '🛠️ Máxima', value: `${updated.max_durability}`, inline: true },
          { name: '📉 Pérdida/día', value: updated.durability_loss_per_day ? `${updated.durability_loss_per_day}` : 'Sin desgaste', inline: true },
          { name: '🔧 Herramienta', value: updated.durability_repair_tool_item_name ? `\`${updated.durability_repair_tool_item_name}\`` : '*Cualquiera puede restaurarla*', inline: true }
        )
        .setFooter({ text: `Configurada por ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  },
};
