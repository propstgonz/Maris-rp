




import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationCommandOptionType } from 'discord.js';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { tokenize, parseCommandArgs, buildSyntheticInteraction } = await import('../src/services/terminalJobService.js');



test('tokenize separa por espacios en el caso simple', () => {
  assert.deepEqual(tokenize('effect add'), ['effect', 'add']);
});

test('tokenize conserva pares clave:valor sin espacios', () => {
  assert.deepEqual(tokenize('jugador:123456789012345678'), ['jugador:123456789012345678']);
});

test('tokenize agrupa clave:"valor con espacios" en un único token', () => {
  assert.deepEqual(
    tokenize('motivo:"un motivo con espacios"'),
    ['motivo:un motivo con espacios']
  );
});

test('tokenize acepta un valor "suelto" entre comillas', () => {
  assert.deepEqual(tokenize('"solo esto"'), ['solo esto']);
});

test('tokenize combina comando + subcomando + varias opciones clave:valor', () => {
  assert.deepEqual(
    tokenize('stat modify jugador:123 stat:hp valor:10'),
    ['stat', 'modify', 'jugador:123', 'stat:hp', 'valor:10']
  );
});

test('tokenize acepta comillas mezcladas con pares normales', () => {
  assert.deepEqual(
    tokenize('effect add jugador:123 efecto:herido duracion_horas:24 motivo:"caída de un puente"'),
    ['effect', 'add', 'jugador:123', 'efecto:herido', 'duracion_horas:24', 'motivo:caída de un puente']
  );
});



const effectCommandJSON = {
  name: 'effect',
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand, name: 'add',
      options: [
        { type: ApplicationCommandOptionType.User, name: 'jugador' },
        { type: ApplicationCommandOptionType.String, name: 'efecto' },
        { type: ApplicationCommandOptionType.Integer, name: 'duracion_horas' },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand, name: 'remove',
      options: [{ type: ApplicationCommandOptionType.User, name: 'jugador' }],
    },
  ],
};


const killCommandJSON = {
  name: 'kill',
  options: [
    { type: ApplicationCommandOptionType.User, name: 'jugador' },
    { type: ApplicationCommandOptionType.String, name: 'motivo' },
  ],
};

test('parseCommandArgs resuelve subcomando + opciones de un comando con subcomandos', () => {
  const result = parseCommandArgs('effect add jugador:123 efecto:herido duracion_horas:24', effectCommandJSON);
  assert.equal(result.subcommandName, 'add');
  assert.equal(result.rawOptions.get('jugador'), '123');
  assert.equal(result.rawOptions.get('efecto'), 'herido');
  assert.equal(result.rawOptions.get('duracion_horas'), '24');


  assert.deepEqual(result.optionSchema, effectCommandJSON.options[0].options);
});

test('parseCommandArgs lanza con un subcomando que no existe', () => {
  assert.throws(
    () => parseCommandArgs('effect volar jugador:123', effectCommandJSON),
    /Subcomando desconocido/
  );
});

test('parseCommandArgs con un comando SIN subcomandos no consume ningún token como subcomando', () => {
  const result = parseCommandArgs('kill jugador:123 motivo:"traición a la corona"', killCommandJSON);
  assert.equal(result.subcommandName, null);
  assert.equal(result.rawOptions.get('jugador'), '123');
  assert.equal(result.rawOptions.get('motivo'), 'traición a la corona');
});

test('parseCommandArgs lanza ante un token sin clave:valor', () => {
  assert.throws(
    () => parseCommandArgs('kill 123', killCommandJSON),
    /las opciones van como clave:valor/
  );
});







function makeFakeClient({ users = {}, channels = {} } = {}) {
  return {
    users: { fetch: async (id) => users[id] ?? null },
    channels: { fetch: async (id) => channels[id] ?? null },
    guilds: { cache: new Map() },
  };
}

const requestingUser = { id: 'requester1', tag: 'Requester#0001' };





const optionsCommandJSON = {
  name: 'stub',
  options: [
    { type: ApplicationCommandOptionType.String, name: 'motivo' },
    { type: ApplicationCommandOptionType.Integer, name: 'cantidad' },
    { type: ApplicationCommandOptionType.User, name: 'jugador' },
  ],
};
const optionsCommand = { data: { name: 'stub', toJSON: () => optionsCommandJSON } };

test('getX(nombre, true) devuelve el valor normalmente cuando la opción llegó', async () => {
  const client = makeFakeClient({ users: { requester1: requestingUser, '42': { id: '42', tag: 'Alguien#0001' } } });
  const job = { command_line: 'stub motivo:"caída de un puente" cantidad:5 jugador:42', requested_by_discord_id: 'requester1' };
  const { interaction } = await buildSyntheticInteraction(client, optionsCommand, job);
  assert.equal(interaction.options.getString('motivo', true), 'caída de un puente');
  assert.equal(interaction.options.getInteger('cantidad', true), 5);
  assert.equal(interaction.options.getUser('jugador', true).id, '42');
});

test('getX(nombre, true) lanza con un mensaje claro cuando la opción NO llegó — antes devolvía null en silencio', async () => {
  const client = makeFakeClient({ users: { requester1: requestingUser } });
  const job = { command_line: 'stub', requested_by_discord_id: 'requester1' };
  const { interaction } = await buildSyntheticInteraction(client, optionsCommand, job);
  assert.throws(() => interaction.options.getString('motivo', true), /Falta la opción obligatoria "motivo"/);
  assert.throws(() => interaction.options.getInteger('cantidad', true), /Falta la opción obligatoria "cantidad"/);
  assert.throws(() => interaction.options.getUser('jugador', true), /Falta la opción obligatoria "jugador"/);
});

test('getX(nombre) sin `required` (u omitido) sigue devolviendo null si falta, como antes — sin regresión', async () => {
  const client = makeFakeClient({ users: { requester1: requestingUser } });
  const job = { command_line: 'stub', requested_by_discord_id: 'requester1' };
  const { interaction } = await buildSyntheticInteraction(client, optionsCommand, job);
  assert.equal(interaction.options.getString('motivo'), null);
  assert.equal(interaction.options.getInteger('cantidad'), null);
  assert.equal(interaction.options.getUser('jugador'), null);
});

test('getAttachment(nombre, true) lanza explicando que el terminal no admite adjuntos, en vez de dejar pasar null', async () => {
  const client = makeFakeClient({ users: { requester1: requestingUser } });
  const job = { command_line: 'stub', requested_by_discord_id: 'requester1' };
  const { interaction } = await buildSyntheticInteraction(client, optionsCommand, job);
  assert.equal(interaction.options.getAttachment('foto'), null);
  assert.throws(() => interaction.options.getAttachment('foto', true), /adjunto/);
});

test('getFocused() siempre lanza — el terminal nunca dispara autocompletado', async () => {
  const client = makeFakeClient({ users: { requester1: requestingUser } });
  const job = { command_line: 'stub', requested_by_discord_id: 'requester1' };
  const { interaction } = await buildSyntheticInteraction(client, optionsCommand, job);
  assert.throws(() => interaction.options.getFocused(), /autocompletado/);
});
