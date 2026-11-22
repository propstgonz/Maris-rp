import { queryOne, execute, whenReady } from '../src/database/index.js';
import { T } from '../src/database/tables.js';




await whenReady;

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`OK   ${label}`); }
  else { fail++; console.error(`FALLA ${label} ${extra}`); }
}

const OWNER = '100000000000000001';
const OTHER = '100000000000000002';

await execute(`INSERT IGNORE INTO ${T.players} (discord_id, username, character_name, character_created_at, is_alive, coord_x, coord_y)
            VALUES (?, 'dueno', 'Dueno', NOW(), 1, 0, 0)`, [OWNER]);
await execute(`INSERT IGNORE INTO ${T.players} (discord_id, username, character_name, character_created_at, is_alive, coord_x, coord_y)
            VALUES (?, 'otro', 'Otro', NOW(), 1, 0, 0)`, [OTHER]);
await execute(`INSERT IGNORE INTO ${T.items} (name, display_name, item_type, emoji) VALUES ('piedra_gui','Piedra','recurso','🪨')`);
const itemId = (await queryOne(`SELECT id FROM ${T.items} WHERE name = 'piedra_gui'`)).id;
await execute(`INSERT INTO ${T.recipes} (result_item_id, result_quantity, laburo_cost) VALUES (?, 1, 0)`, [itemId]);

const { listCraftableForPlayer } = await import('../src/services/craftService.js');
const { buildCraftPickerMessage, CRAFT_NS } = await import('../src/components/craftFlow.js');
const { COMPONENT_HANDLERS } = await import('../src/components/registry.js');
const { parseCustomId, assertComponentAccess } = await import('../src/utils/componentAuth.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const craftable = await listCraftableForPlayer(OWNER);
check('listCraftableForPlayer encuentra la receta sin coste', craftable.some(ev => ev.recipe.result_name === 'piedra_gui'));

const picker = await buildCraftPickerMessage(OWNER);
const json = picker.components[0].toJSON();
check('el desplegable serializa a JSON válido', json.components[0].type === 3 && json.components[0].options.length > 0);
check('el customId del desplegable sigue la convención', parseCustomId(json.components[0].custom_id)?.ns === CRAFT_NS);
check('todas las opciones respetan el límite de 25 de Discord', json.components[0].options.length <= 25);
check('ninguna descripción de opción pasa de 100 chars',
  json.components[0].options.every(o => !o.description || o.description.length <= 100));

const parsed = parseCustomId(json.components[0].custom_id);
check('el registro tiene handler para el namespace del menú', typeof COMPONENT_HANDLERS[parsed.ns]?.handle === 'function');

const fakeInteraction = (userId) => ({ user: { id: userId }, message: { createdTimestamp: Date.now() } });

let blocked = false;
try { assertComponentAccess(fakeInteraction(OTHER), parsed); }
catch (err) { blocked = err instanceof UserFacingError; }
check('OTRO usuario NO puede usar el menú ajeno', blocked);

let allowed = true;
try { assertComponentAccess(fakeInteraction(OWNER), parsed); }
catch { allowed = false; }
check('el DUEÑO sí puede usar su propio menú', allowed);

let expired = false;
try {
  assertComponentAccess({ user: { id: OWNER }, message: { createdTimestamp: Date.now() - 60 * 60_000 } }, parsed);
} catch (err) { expired = /caducado/.test(err.message); }
check('un menú viejo caduca solo', expired);

for (const [ns, entry] of Object.entries(COMPONENT_HANDLERS)) {
  check(`namespace "${ns}" tiene handler`, typeof entry.handle === 'function');
}

async function checkBuilder(label, fn) {
  try {
    const payload = await fn();
    const json = (payload.components ?? []).map(r => r.toJSON());
    check(label, json.every(r => r.components.length > 0));
  } catch (err) {
    const { UserFacingError: UFE } = await import('../src/utils/errors.js');
    check(`${label} (sin datos → UserFacingError, correcto)`, err instanceof UFE, err.message);
  }
}

const { buildAlertsPanel } = await import('../src/components/alertsFlow.js');
const { buildFactionPickerMessage } = await import('../src/components/factionFlow.js');
const { buildTradePickerMessage } = await import('../src/components/tradeFlow.js');
const { buildPlacePickerMessage } = await import('../src/components/buildFlow.js');
const { buildCharacterModal } = await import('../src/components/characterFlow.js');
const { buildAttackKindMessage } = await import('../src/components/attackFlow.js');
const { buildInventoryActionRow } = await import('../src/components/inventoryFlow.js');

await checkBuilder('alertsFlow: el panel de 9 interruptores serializa', () => buildAlertsPanel(OWNER));
await checkBuilder('factionFlow: el desplegable serializa', () => buildFactionPickerMessage(OWNER));
await checkBuilder('tradeFlow: el desplegable serializa', () => buildTradePickerMessage(OWNER));
await checkBuilder('buildFlow: el desplegable serializa', () => buildPlacePickerMessage(OWNER));
await checkBuilder('attackFlow: el desplegable serializa', () => buildAttackKindMessage(OWNER));

const alertsJson = (await buildAlertsPanel(OWNER)).components.map(r => r.toJSON());
check('alertsFlow: ninguna fila pasa de 5 botones', alertsJson.every(r => r.components.length <= 5));
check('alertsFlow: están los 9 interruptores', alertsJson.reduce((n, r) => n + r.components.length, 0) === 9);

const modalJson = buildCharacterModal(OWNER).toJSON();
check('characterFlow: el modal serializa', Array.isArray(modalJson.components));
check('characterFlow: no pasa de 5 campos (límite de Discord)', modalJson.components.length <= 5);
check('characterFlow: el customId del modal sigue la convención', parseCustomId(modalJson.custom_id)?.ns === 'pj');

check('inventoryFlow: sin consumibles devuelve null, no una fila vacía', (await buildInventoryActionRow(OWNER)) === null);

const { buildHubMessage } = await import('../src/components/hubFlow.js');

const hub = await buildHubMessage(OWNER);
const hubRows = hub.components.map(r => r.toJSON());
check('hubFlow: la pantalla principal serializa', hubRows.length > 0 && hubRows[0].components.length > 0);
check('hubFlow: es efímero (es el panel privado del jugador)', hub.flags !== undefined);
const hubParsed = parseCustomId(hubRows[0].components[0].custom_id);
check('hubFlow: el customId sigue la convención', hubParsed !== null);
check('hubFlow: el namespace es "jugar" (contrato jugar:seccion:userId:meta)', hubParsed?.ns === 'jugar');
check('hubFlow: el customId lleva el userId del dueño', hubParsed?.owner === OWNER);
check('hubFlow: ofrece las 7 secciones', hubRows[0].components[0].options.length === 7);
check('hubFlow: ninguna etiqueta de sección pasa de 100 chars',
  hubRows[0].components[0].options.every(o => o.label.length <= 100 && (!o.description || o.description.length <= 100)));

const { getInventory } = await import('../src/services/inventoryService.js');
void getInventory;
check('hubFlow: la pantalla principal no pasa de 5 filas', hubRows.length <= 5);

let hubGuarded = false;
try { await buildHubMessage('999999999999999999'); }
catch (err) { hubGuarded = err instanceof UserFacingError; }
check('hubFlow: sin personaje lanza UserFacingError, no un fallo interno', hubGuarded);

await execute(`INSERT IGNORE INTO ${T.items} (name, display_name, item_type, emoji,
            weapon_damage, weapon_structure_damage,
            weapon_roll_1, weapon_roll_2, weapon_roll_3, weapon_roll_4, weapon_roll_5, weapon_roll_6)
            VALUES ('rifle_gui','Rifle de prueba','arma','🔫', 3, 2, 1, 2, 5, 5, 10, 20)`);
const rifleId  = (await queryOne(`SELECT id FROM ${T.items} WHERE name = 'rifle_gui'`)).id;
const ownerRow = await queryOne(`SELECT id FROM ${T.players} WHERE discord_id = ?`, [OWNER]);
await execute(`INSERT IGNORE INTO ${T.inventory} (player_id, item_id, quantity) VALUES (?, ?, 1)`, [ownerRow.id, rifleId]);

const NEAR = '100000000000000003';
const EDGE = '100000000000000004';
const FAR  = '100000000000000005';
for (const [id, name, x, y] of [[NEAR, 'cerca', 0, 15], [EDGE, 'borde', 0, 20], [FAR, 'lejos', 0, 50]]) {
  await execute(`INSERT IGNORE INTO ${T.players} (discord_id, username, character_name, character_created_at, is_alive, coord_x, coord_y)
              VALUES (?, ?, ?, NOW(), 1, ?, ?)`, [id, name, name, x, y]);
}

const { weaponMaxRange, weaponFacesReaching, getPlayerWeapons } = await import('../src/services/combatService.js');
const { getPlayersInRadius } = await import('../src/services/playerService.js');
const { buildTargetMessage, buildCoordsModal } = await import('../src/components/attackFlow.js');

const rifle = (await getPlayerWeapons(OWNER)).find(w => w.name === 'rifle_gui');
check('combate: el arma de prueba llega al inventario', Boolean(rifle));
check('combate: weaponMaxRange lee la mejor cara (20), no la primera', weaponMaxRange(rifle) === 20);
check('combate: a 20 casillas solo llega 1 de las 6 caras', weaponFacesReaching(rifle, 20) === 1);
check('combate: a 6 casillas llegan 2 caras (las de 10 y 20)', weaponFacesReaching(rifle, 6) === 2);
check('combate: a 1 casilla llegan las 6', weaponFacesReaching(rifle, 1) === 6);

const radiusRows = await getPlayersInRadius(0, 0, 20, OWNER);
const inRadius = radiusRows.map(row => row.discord_id);
check('radio: incluye al que está a 15 casillas', inRadius.includes(NEAR));
check('radio: incluye al del borde exacto (20)', inRadius.includes(EDGE));
check('radio: excluye al que está a 50', !inRadius.includes(FAR));
check('radio: nunca te ofrece a ti mismo', !inRadius.includes(OWNER));
check('radio: vienen ordenados de más cerca a más lejos',
      radiusRows.every((row, idx, all) => idx === 0 || all[idx - 1].distance <= row.distance));

const targetMsg  = await buildTargetMessage(OWNER, String(rifleId));
const targetJson = targetMsg.components[0].toJSON().components[0];
const values     = targetJson.options.map(o => o.value);

await checkBuilder('attackFlow: el selector de objetivos serializa', () => targetMsg);
check('attackFlow: ofrece al jugador que está a 15 casillas', values.includes('p.' + NEAR));
check('attackFlow: ofrece al del borde exacto', values.includes('p.' + EDGE));
check('attackFlow: NO ofrece al que está fuera de alcance', !values.includes('p.' + FAR));
check('attackFlow: ofrece la salida por coordenadas', values.includes('xy'));
check('attackFlow: no pasa de 25 opciones', targetJson.options.length <= 25);
check('attackFlow: ninguna descripción de objetivo pasa de 100 chars',
      targetJson.options.every(o => (o.description ?? '').length <= 100));
check('attackFlow: ninguna descripción está vacía (Discord la rechaza)',
      targetJson.options.every(o => o.description === undefined || o.description.length > 0));
check('attackFlow: el customId del selector lleva el arma elegida',
      parseCustomId(targetJson.custom_id)?.ctx === String(rifleId));

const meleeValues = (await buildTargetMessage(OWNER, 'm'))
  .components[0].toJSON().components[0].options.map(o => o.value);
check('attackFlow: a puño limpio solo aparece quien está en tu casilla',
      meleeValues.includes('p.' + OTHER) && !meleeValues.includes('p.' + NEAR));
check('attackFlow: a puño limpio no se ofrece elegir coordenadas', !meleeValues.includes('xy'));

const coordsJson = buildCoordsModal(OWNER, String(rifleId)).toJSON();
check('attackFlow: el modal de coordenadas serializa', Array.isArray(coordsJson.components));
check('attackFlow: el modal pide exactamente X e Y', coordsJson.components.length === 2);
check('attackFlow: el customId del modal sigue la convención',
      parseCustomId(coordsJson.custom_id)?.ns === 'atk');

const atNear = (await buildTargetMessage(OWNER, String(rifleId), { x: 0, y: 15 }))
  .components[0].toJSON().components[0].options.map(o => o.value);
check('attackFlow: filtrar por casilla deja solo lo que hay en ella',
      atNear.includes('p.' + NEAR) && !atNear.includes('p.' + EDGE));

let outOfRange = false;
try { await buildTargetMessage(OWNER, String(rifleId), { x: 0, y: 50 }); }
catch (err) { outOfRange = err instanceof UserFacingError; }
check('attackFlow: apuntar fuera de alcance avisa en vez de romperse', outOfRange);

for (let n = 0; n < 30; n++) {
  await execute(`INSERT IGNORE INTO ${T.players} (discord_id, username, character_name, character_created_at, is_alive, coord_x, coord_y)
              VALUES (?, ?, ?, NOW(), 1, ?, ?)`,
    ['20000000000000' + String(n).padStart(4, '0'), 'masa' + n, 'Masa ' + n, 0, 1 + n % 19]);
}
const crowded = (await buildTargetMessage(OWNER, String(rifleId)))
  .components[0].toJSON().components[0].options;
check('attackFlow: con 30 objetivos sigue cabiendo en el límite de Discord', crowded.length === 25);
check('attackFlow: al truncar deja siempre la salida por coordenadas',
      crowded.some(o => o.value === 'xy'));

const goId = 'atk:go:' + OWNER + ':' + rifleId + '.p.' + FAR;
check('attackFlow: el customId de confirmación cabe en 100 chars', goId.length <= 100, 'mide ' + goId.length);

{
  const conArma = await buildTargetMessage(OWNER, String(rifleId));
  const filaVuelta = conArma.components[1]?.toJSON().components ?? [];
  check('attackFlow: el paso de objetivo deja volver a elegir arma',
        filaVuelta.some(b => parseCustomId(b.custom_id)?.action === 'restart'));

  const { COMPONENT_HANDLERS: HANDLERS } = await import('../src/components/registry.js');
  const ttl = HANDLERS.atk.ttlMs;
  check('attackFlow: el menú guiado no caduca a los 3 minutos',
        typeof ttl === 'function' && ttl({ action: 'weapon' }) === 15 * 60_000);
  check('attackFlow: el botón de contraatacar sí sigue siendo urgente',
        typeof ttl === 'function' && ttl({ action: 'counter' }) === 3 * 60_000);

  await execute(`INSERT IGNORE INTO ${T.items} (name, display_name, item_type, emoji) VALUES ('balas_gui','Balas','recurso','🔩')`);
  const balasId = (await queryOne(`SELECT id FROM ${T.items} WHERE name='balas_gui'`)).id;
  await execute(`UPDATE ${T.items} SET weapon_ammo_item_name='balas_gui', weapon_ammo_cost=2 WHERE id=?`, [rifleId]);

  const sinBalas = (await buildAttackKindMessage(OWNER))
    .components[0].toJSON().components[0].options.find(o => o.value === String(rifleId));
  check('attackFlow: un arma sin munición lo avisa ya en el desplegable',
        sinBalas?.description.includes('sin munición'), sinBalas?.description);
  check('attackFlow: la descripción del arma sigue cabiendo en 100 chars',
        (sinBalas?.description.length ?? 0) <= 100);

  const jugadorId = (await queryOne(`SELECT id FROM ${T.players} WHERE discord_id=?`, [OWNER])).id;
  await execute(`INSERT INTO ${T.inventory} (player_id, item_id, quantity) VALUES (?, ?, 10)
                 ON DUPLICATE KEY UPDATE quantity=10`, [jugadorId, balasId]);
  const conBalas = (await buildAttackKindMessage(OWNER))
    .components[0].toJSON().components[0].options.find(o => o.value === String(rifleId));
  check('attackFlow: con munición encima ya no avisa', !conBalas?.description.includes('sin munición'));

  const { getAttackAvailability, setAttackLimits } = await import('../src/services/combatService.js');
  await setAttackLimits({ maxPerDay: 3, cooldownHours: 0 });
  const disponible = await getAttackAvailability(OWNER);
  check('attackFlow: se puede saber cuántos ataques quedan sin gastarlos',
        disponible.limited === true && disponible.remainingToday === 3);
  const antes = (await queryOne(`SELECT attacks_today_count AS n FROM ${T.players} WHERE discord_id=?`, [OWNER])).n;
  await getAttackAvailability(OWNER);
  const despues = (await queryOne(`SELECT attacks_today_count AS n FROM ${T.players} WHERE discord_id=?`, [OWNER])).n;
  check('attackFlow: consultarlo NO consume el ataque del día', antes === despues);
  await setAttackLimits({ maxPerDay: 0, cooldownHours: 0 });

  await execute(`UPDATE ${T.items} SET weapon_ammo_item_name=NULL, weapon_ammo_cost=NULL WHERE id=?`, [rifleId]);
}

const { rollRangeCheckForNpcCombat } = await import('../src/services/combatService.js');

const sinTabla = { weapon_roll_1: null, weapon_roll_2: null, weapon_roll_3: null,
                   weapon_roll_4: null, weapon_roll_5: null, weapon_roll_6: null };
const aBocajarro = rollRangeCheckForNpcCombat(sinTabla, 0);
check('npc: un arma SIN tabla de alcance sigue llegando a distancia 0 (compatibilidad)',
      aBocajarro.inRange === true && aBocajarro.meleeOnly === true);
check('npc: un arma sin tabla NO llega a 5 casillas',
      rollRangeCheckForNpcCombat(sinTabla, 5).inRange === false);
check('npc: un arma sin tabla no llega ni a tirar el dado de alcance',
      aBocajarro.rangeRoll === null);

check('npc: un arma CON tabla nunca entra en alcance más allá de su mejor cara',
      Array.from({ length: 200 },
        () => rollRangeCheckForNpcCombat(rifle, weaponMaxRange(rifle) + 1).inRange).every(v => v === false));
check('npc: un arma CON tabla siempre entra en alcance a distancia 0 si todas sus caras tienen valor',
      Array.from({ length: 200 }, () => rollRangeCheckForNpcCombat(rifle, 0).inRange).every(v => v === true));

const terrainId = (await queryOne(`SELECT id FROM ${T.terrain_types} LIMIT 1`))?.id;
if (!terrainId) { console.error('FALLA npc: no hay terrain_types sembrados'); }
else {
  await execute(`INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id)
              VALUES (0, 12, 'Casilla del NPC', ?)`, [terrainId]);
  const tileId = (await queryOne(`SELECT id FROM ${T.map_tiles} WHERE coord_x = 0 AND coord_y = 12`)).id;
  await execute(`INSERT IGNORE INTO ${T.npc_types} (name, display_name, emoji, max_hp)
              VALUES ('bicho_gui', 'Bicho de prueba', '🐗', 8)`);
  const npcTypeId = (await queryOne(`SELECT id FROM ${T.npc_types} WHERE name = 'bicho_gui'`)).id;
  await execute(`INSERT INTO ${T.npcs} (tile_id, npc_type_id, current_hp) VALUES (?, ?, 8)`, [tileId, npcTypeId]);

  const { getNpcsInRadius } = await import('../src/services/npcService.js');
  const near = (await getNpcsInRadius(0, 0, 20)).find(n => n.type_name === 'bicho_gui');
  check('npc: getNpcsInRadius encuentra al NPC a 12 casillas', Boolean(near) && near.distance === 12);
  check('npc: fuera del radio no aparece', !(await getNpcsInRadius(0, 0, 5)).some(n => n.type_name === 'bicho_gui'));

  const conNpc = (await buildTargetMessage(OWNER, String(rifleId)))
    .components[0].toJSON().components[0].options;
  check('attackFlow: el menú ofrece al NPC lejano', conNpc.some(o => o.value === 'n.' + near.id));
  check('attackFlow: la opción del NPC dice a qué distancia está',
        conNpc.find(o => o.value === 'n.' + near.id)?.description.includes('12 casillas'));

  const sinArma = (await buildTargetMessage(OWNER, 'm'))
    .components[0].toJSON().components[0].options;
  check('attackFlow: a puño limpio no se ofrece ningún NPC',
        !sinArma.some(o => o.value.startsWith('n.')));
}

const { TILE_CONSTRUCTION_LIMITS, MAX_CONSTRUCTION_HEALTH } = await import('../src/services/constructionTypeService.js');
const { pickConstruction, updateConstructionInstance } = await import('../src/services/mapService.js');

check('topes: 15 por casilla', TILE_CONSTRUCTION_LIMITS.perTile === 15);
check('topes: 8 del mismo tipo', TILE_CONSTRUCTION_LIMITS.perTypePerTile === 8);
check('topes: el tope por tipo no puede superar al total (seria inalcanzable)',
      TILE_CONSTRUCTION_LIMITS.perTypePerTile <= TILE_CONSTRUCTION_LIMITS.perTile);
check('vida: el tope de vida de un tipo es 1000', MAX_CONSTRUCTION_HEALTH === 1000);

const una   = [{ id: 7, current_health: 5, ct_max_health: 10 }];
const varias = [
  { id: 7,  current_health: 5,  ct_max_health: 10 },
  { id: 12, current_health: 0,  ct_max_health: 10 },
  { id: 20, current_health: 10, ct_max_health: 10 },
];
const ctx = { x: 3, y: 4, typeLabel: 'Fortaleza' };

check('pick: con UNA sola no pregunta nada', pickConstruction(una, ctx).id === 7);
check('pick: con varias y un id, devuelve ESA', pickConstruction(varias, { ...ctx, constructionId: 12 }).id === 12);

let sinId = null;
try { pickConstruction(varias, ctx); } catch (err) { sinId = err; }
check('pick: con varias y sin id, NO elige la primera en silencio (G10)', sinId instanceof UserFacingError);
check('pick: el error lista los ids para poder repetir el comando',
      sinId && ['#7', '#12', '#20'].every(id => sinId.message.includes(id)), sinId?.message);
check('pick: el error distingue las que estan en ruinas',
      sinId && sinId.message.includes('ruinas'));

let idMalo = null;
try { pickConstruction(varias, { ...ctx, constructionId: 999 }); } catch (err) { idMalo = err; }
check('pick: un id que no esta ahi se rechaza con mensaje, no se ignora', idMalo instanceof UserFacingError);

let ninguna = null;
try { pickConstruction([], ctx); } catch (err) { ninguna = err; }
check('pick: sin ninguna, error claro', ninguna instanceof UserFacingError && ninguna.message.includes('Fortaleza'));

{
  const terr = (await queryOne(`SELECT id FROM ${T.terrain_types} LIMIT 1`))?.id;
  if (!terr) { console.error('FALLA g12: no hay terrain_types'); }
  else {
    await execute(`INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id) VALUES (77, 77, 'Casilla G12', ?)`, [terr]);
    const tid = (await queryOne(`SELECT id FROM ${T.map_tiles} WHERE coord_x=77 AND coord_y=77`)).id;
    await execute(`INSERT IGNORE INTO ${T.items} (name, display_name, item_type, emoji, is_fuel) VALUES ('carbon_gui','Carbón','recurso','🪨',1)`);
    const fuelId = (await queryOne(`SELECT id FROM ${T.items} WHERE name='carbon_gui'`)).id;
    await execute(`INSERT IGNORE INTO ${T.construction_types} (name, display_name, emoji, max_health, fuel_item_id, fuel_consumption_rate, fuel_capacity)
                VALUES ('deposito_gui','Depósito de prueba','🛢️', 10, ?, 2, NULL)`, [fuelId]);
    const ctId = (await queryOne(`SELECT id FROM ${T.construction_types} WHERE name='deposito_gui'`)).id;
    await execute(`INSERT INTO ${T.constructions} (tile_id, name, construction_type_id, current_health, fuel_level) VALUES (?, 'Depósito', ?, 10, 50)`, [tid, ctId]);
    const cid = (await queryOne(`SELECT id FROM ${T.constructions} WHERE tile_id=? AND construction_type_id=?`, [tid, ctId])).id;

    await updateConstructionInstance(cid, { currentHealth: 8, fuelLevel: 50 });
    const tras = await queryOne(`SELECT current_health h, fuel_level f FROM ${T.constructions} WHERE id=?`, [cid]);
    check('G12: editar una construccion de capacidad ILIMITADA no vacia su deposito',
          tras.f === 50, 'quedo en ' + tras.f);
    check('G12: la vida si se aplica', tras.h === 8);

    await updateConstructionInstance(cid, { fuelLevel: 5000 });
    check('G12: sin tope, se puede repostar por encima de cualquier cifra',
          (await queryOne(`SELECT fuel_level f FROM ${T.constructions} WHERE id=?`, [cid])).f === 5000);

    await execute(`UPDATE ${T.construction_types} SET fuel_capacity = 100 WHERE id = ?`, [ctId]);
    await updateConstructionInstance(cid, { fuelLevel: 5000 });
    check('G12: con capacidad declarada, el tope se sigue respetando',
          (await queryOne(`SELECT fuel_level f FROM ${T.constructions} WHERE id=?`, [cid])).f === 100);

    const { getTileWithDetails } = await import('../src/services/mapService.js');
    const { buildTileInfoEmbed } = await import('../src/utils/embeds.js');
    const info = await getTileWithDetails(77, 77);
    check('combustible: la casilla expone el item-combustible del tipo',
          info.constructions.some(c => c.ct_fuel_item_name === 'carbon_gui'));
    const embedJson = buildTileInfoEmbed(info).toJSON();
    const campo = embedJson.fields.find(f => f.name.includes('Construcciones'));
    check('combustible: /casilla info muestra el deposito', Boolean(campo) && campo.value.includes('100/100'));
    check('combustible: /casilla info dice cuantos dias quedan',
          Boolean(campo) && /d[ií]a/.test(campo.value), campo?.value);
  }
}

{
  const { buildConstruction } = await import('../src/services/constructionTypeService.js');

  const terr = (await queryOne(`SELECT id FROM ${T.terrain_types} LIMIT 1`)).id;
  await execute(`INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id) VALUES (88, 88, 'Casilla topes', ?)`, [terr]);

  for (const [n, d] of [['cabana_gui', 'Cabaña'], ['torre_gui', 'Torre']]) {
    await execute(`INSERT IGNORE INTO ${T.construction_types} (name, display_name, emoji, laburo_cost, max_health) VALUES (?, ?, '🏠', 0, 10)`, [n, d]);
  }
  const tipoA = await queryOne(`SELECT * FROM ${T.construction_types} WHERE name='cabana_gui'`);
  const tipoB = await queryOne(`SELECT * FROM ${T.construction_types} WHERE name='torre_gui'`);

  const construir = async (tipo) => {
    try { await buildConstruction(OWNER, 88, 88, tipo); return null; }
    catch (err) { return err; }
  };

  let errores = 0;
  for (let n = 0; n < TILE_CONSTRUCTION_LIMITS.perTypePerTile; n++) if (await construir(tipoA)) errores++;
  check('topes: caben las 8 primeras del mismo tipo', errores === 0, errores + ' fallaron antes de tiempo');

  const novena = await construir(tipoA);
  check('topes: la NOVENA del mismo tipo se rechaza', novena instanceof UserFacingError, novena?.message);
  check('topes: el mensaje explica que es el tope del mismo tipo',
        novena && novena.message.includes('8'), novena?.message);
  check('topes: rechazar no deja una construccion a medias',
        (await queryOne(`SELECT COUNT(*) n FROM ${T.constructions} c JOIN ${T.map_tiles} t ON c.tile_id=t.id
                    WHERE t.coord_x=88 AND t.coord_y=88 AND c.construction_type_id=?`, [tipoA.id])).n === 8);

  check('topes: un tipo distinto sigue cabiendo (8 no agota las 15)', (await construir(tipoB)) === null);

  let hasta15 = 0;
  while (true) {
    const err = await construir(tipoB);
    if (err) break;
    if (++hasta15 > 20) break;
  }
  const total = (await queryOne(`SELECT COUNT(*) n FROM ${T.constructions} c JOIN ${T.map_tiles} t ON c.tile_id=t.id
                            WHERE t.coord_x=88 AND t.coord_y=88`)).n;
  check('topes: la casilla se queda exactamente en 15', total === TILE_CONSTRUCTION_LIMITS.perTile, 'quedaron ' + total);

  await execute(`INSERT IGNORE INTO ${T.construction_types} (name, display_name, emoji, laburo_cost, max_health) VALUES ('faro_gui','Faro','🗼',0,10)`);
  const tipoC = await queryOne(`SELECT * FROM ${T.construction_types} WHERE name='faro_gui'`);
  const lleno = await construir(tipoC);
  check('topes: con la casilla llena se rechaza incluso un tipo nuevo', lleno instanceof UserFacingError);
  check('topes: el mensaje explica que es el tope de la casilla',
        lleno && lleno.message.includes('15'), lleno?.message);

  const { getConstructionsByTypeAndTile, resolveConstructionAtTile } = await import('../src/services/mapService.js');
  const ocho = await getConstructionsByTypeAndTile(88, 88, tipoA.id);
  check('G10: las 8 del mismo tipo son TODAS localizables', ocho.length === 8);
  let ambiguo = null;
  try { await resolveConstructionAtTile(88, 88, tipoA); } catch (err) { ambiguo = err; }
  check('G10: con 8 iguales, resolver sin id exige decir cual (no elige la primera)',
        ambiguo instanceof UserFacingError);
  const resueltas = await Promise.all(ocho.map(c => resolveConstructionAtTile(88, 88, tipoA, c.id)));
  check('G10: cada una se puede direccionar por su id',
        resueltas.every((r, i) => r.id === ocho[i].id));
}

{
  const { beginTravel, cancelTravel, processTravelTicks, isHeldByEncounter } = await import('../src/services/travelService.js');
  const { getPlayerByDiscordId } = await import('../src/services/playerService.js');
  const { resolveEncounterIfConcluded } = await import('../src/services/npcEncounterService.js');

  const terreno = (await queryOne(`SELECT id FROM ${T.terrain_types} LIMIT 1`)).id;
  for (const [x, y] of [[40, 40], [41, 40], [42, 40], [45, 45]]) {
    await execute(`INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id)
                   VALUES (?, ?, 'Casilla de encuentro', ?)`, [x, y, terreno]);
  }
  const tileId = (x, y) => queryOne(`SELECT id FROM ${T.map_tiles} WHERE coord_x=? AND coord_y=?`, [x, y]).then(r => r.id);

  await execute(`INSERT IGNORE INTO ${T.npc_types} (name, display_name, emoji, max_hp, is_aggressive)
                 VALUES ('fiera_gui','Fiera','🐺',8,1)`);
  await execute(`INSERT IGNORE INTO ${T.npc_types} (name, display_name, emoji, max_hp, is_aggressive)
                 VALUES ('conejo_gui','Conejo','🐇',3,0)`);
  const fieraId = (await queryOne(`SELECT id FROM ${T.npc_types} WHERE name='fiera_gui'`)).id;
  const conejoId = (await queryOne(`SELECT id FROM ${T.npc_types} WHERE name='conejo_gui'`)).id;

  const jugador = await getPlayerByDiscordId(OWNER);
  await execute(`UPDATE ${T.players} SET coord_x=40, coord_y=40, is_alive=1 WHERE discord_id=?`, [OWNER]);

  const spawn = async (typeId, x, y) => {
    const res = await execute(`INSERT INTO ${T.npcs} (tile_id, npc_type_id, current_hp, is_wild, encountered_by_player_id)
                               VALUES (?, ?, 5, 1, ?)`, [await tileId(x, y), typeId, jugador.id]);
    return res.lastInsertRowid;
  };
  const cerrojo = async () => (await queryOne(`SELECT travel_paused_by_npc_id AS v FROM ${T.players} WHERE discord_id=?`, [OWNER])).v;

  const fiera = await spawn(fieraId, 40, 40);
  await execute(`UPDATE ${T.players} SET travel_dest_x=42, travel_dest_y=40, travel_next_tick_at=NOW(), travel_paused_by_npc_id=?
                 WHERE discord_id=?`, [fiera, OWNER]);
  const conejoLejos = await spawn(conejoId, 45, 45);

  check('encuentro: un NPC agresivo en tu casilla te retiene',
        await isHeldByEncounter(await getPlayerByDiscordId(OWNER)) === true);

  let viajeBloqueado = null;
  try { await beginTravel(OWNER, 41, 40); } catch (err) { viajeBloqueado = err; }
  check('encuentro: no puedes empezar otro viaje mientras te retiene', viajeBloqueado instanceof UserFacingError);

  await cancelTravel(OWNER);
  let huidaGratis = null;
  try { await beginTravel(OWNER, 41, 40); } catch (err) { huidaGratis = err; }
  check('encuentro: cancelar el viaje NO es una huida gratis', huidaGratis instanceof UserFacingError);

  check('encuentro: la etiqueta de un NPC pasivo lejano se suelta sola',
        (await queryOne(`SELECT encountered_by_player_id AS v FROM ${T.npcs} WHERE id=?`, [conejoLejos])).v === null);

  await execute(`UPDATE ${T.players} SET travel_dest_x=42, travel_dest_y=40, travel_next_tick_at=NOW(), travel_paused_by_npc_id=?
                 WHERE discord_id=?`, [fiera, OWNER]);
  const fieraRow = await queryOne(`SELECT n.*, nt.is_aggressive FROM ${T.npcs} n JOIN ${T.npc_types} nt ON n.npc_type_id=nt.id WHERE n.id=?`, [fiera]);
  await execute(`DELETE FROM ${T.npcs} WHERE id=?`, [fiera]);
  await processTravelTicks(null);
  check('encuentro: si el NPC desaparece, el tick de viaje suelta el cerrojo', await cerrojo() === null);

  const fiera3 = await spawn(fieraId, 40, 40);
  const conejoResiduo = await spawn(conejoId, 45, 45);
  await execute(`UPDATE ${T.players} SET travel_dest_x=42, travel_dest_y=40, travel_paused_by_npc_id=? WHERE discord_id=?`, [fiera3, OWNER]);
  const fiera3Row = await queryOne(`SELECT * FROM ${T.npcs} WHERE id=?`, [fiera3]);
  await execute(`DELETE FROM ${T.npcs} WHERE id=?`, [fiera3]);
  await resolveEncounterIfConcluded(null, { ...fiera3Row, is_wild: 1 });
  check('encuentro: una etiqueta vieja de otra casilla ya no impide reanudar el viaje', await cerrojo() === null);
  await execute(`DELETE FROM ${T.npcs} WHERE id=?`, [conejoResiduo]);

  const fiera2 = await spawn(fieraId, 40, 40);
  await execute(`UPDATE ${T.players} SET travel_dest_x=42, travel_dest_y=40, travel_paused_by_npc_id=? WHERE discord_id=?`, [fiera2, OWNER]);
  const fiera2Row = await queryOne(`SELECT * FROM ${T.npcs} WHERE id=?`, [fiera2]);
  await resolveEncounterIfConcluded(null, { ...fiera2Row, is_wild: 1 }, null, { release: 'solo' });
  check('encuentro: una rendición aceptada libera aunque el NPC siga vivo', await cerrojo() === null);
  check('encuentro: el NPC perdonado sigue en la casilla',
        (await queryOne(`SELECT COUNT(*) n FROM ${T.npcs} WHERE id=?`, [fiera2])).n === 1);

  await execute(`UPDATE ${T.players} SET travel_paused_by_npc_id=? WHERE discord_id=?`, [fiera2, OWNER]);
  await cancelTravel(OWNER);
  check('encuentro: cancelar un viaje inexistente también suelta el cerrojo', await cerrojo() === null);

  await execute(`DELETE FROM ${T.npcs} WHERE npc_type_id IN (?, ?)`, [fieraId, conejoId]);
  check('encuentro: sin NPCs alrededor ya nada te retiene',
        await isHeldByEncounter(await getPlayerByDiscordId(OWNER)) === false, String(fieraRow?.id));

  const { sendEncounterPopup } = await import('../src/services/npcEncounterService.js');
  const botonesDe = async (npcType) => {
    const componentes = [];
    const clienteFalso = {
      users: { fetch: async () => ({ send: async payload => { componentes.push(payload.components[0].toJSON()); return { id: '1' }; } }) },
      channels: { fetch: async () => null },
    };
    const npcFalso = { id: 0, coord_x: 40, coord_y: 40, current_hp: 5, ...npcType };
    await sendEncounterPopup(clienteFalso, { discord_id: OWNER, modmail_channel_id: null }, npcFalso, npcType);
    return componentes[0].components.map(b => b.label);
  };

  await execute(`UPDATE ${T.npc_types} SET is_tameable=1, tame_bait_item_id=? WHERE id=?`, [itemId, conejoId]);
  const conejoTipo = await queryOne(`SELECT * FROM ${T.npc_types} WHERE id=?`, [conejoId]);
  const fieraTipo = await queryOne(`SELECT * FROM ${T.npc_types} WHERE id=?`, [fieraId]);
  check('domesticar: el animal pasivo domesticable ofrece el botón en el popup',
        (await botonesDe(conejoTipo)).includes('Domesticar'));
  check('domesticar: un hostil no ofrece el botón, ofrece huir y rendirse',
        !(await botonesDe(fieraTipo)).includes('Domesticar'));

  await execute(`UPDATE ${T.npc_types} SET is_tameable=0 WHERE id=?`, [conejoId]);
  const conejoNoDom = await queryOne(`SELECT * FROM ${T.npc_types} WHERE id=?`, [conejoId]);
  check('domesticar: un pasivo NO domesticable tampoco ofrece el botón',
        !(await botonesDe(conejoNoDom)).includes('Domesticar'));

  const { attemptTame } = await import('../src/services/tameService.js');
  let hostilRechazado = null;
  try { await attemptTame(OWNER, { ...fieraTipo, is_tameable: 1, is_aggressive: 1, type_display_name: 'Fiera', tame_bait_item_id: itemId, owner_player_id: null }); }
  catch (err) { hostilRechazado = err; }
  check('domesticar: el servicio rechaza a un hostil aunque esté marcado domesticable',
        hostilRechazado instanceof UserFacingError);
}

console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
