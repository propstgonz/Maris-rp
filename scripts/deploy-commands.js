import 'dotenv/config';
import { REST, Routes, Collection } from 'discord.js';
import { loadCommands } from '../src/loaders/commandLoader.js';
import { buildCommandDefs } from '../src/services/commandDeployService.js';

console.log('\n🔍  Escaneando comandos…\n');

const fakeClient = { commands: new Collection() };
const { skipped } = await loadCommands(fakeClient);

if (fakeClient.commands.size === 0) {
  console.error('\n❌  No se encontraron comandos válidos. Revisa src/commands/\n');
  process.exit(1);
}

if (skipped > 0) {
  console.error(`\n❌  ${skipped} fichero(s) de comando se omitieron al cargar — revisa los avisos [CommandLoader] de arriba antes de desplegar (si sigues, Discord se queda SIN ese comando en silencio).\n`);
  process.exit(1);
}

for (const command of fakeClient.commands.values()) {
  const scope = command.category === 'player' ? 'jugador → global + MD' : 'staff → guild, oculto por defecto';
  console.log(`  ✓  /${command.data.name} (${scope})`);
}

const { staffDefs, playerDefs } = buildCommandDefs(fakeClient.commands);

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN) {
  console.error('\n❌  DISCORD_TOKEN no está definido en el .env\n');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('\n❌  CLIENT_ID no está definido en el .env\n');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const globalRoute = Routes.applicationCommands(CLIENT_ID);

async function put(route, body, label) {
  console.log(`\n📡  Registrando ${body.length} comando(s) → ${label}\n`);
  try {
    const result = await rest.put(route, { body });
    console.log(`✅  ${result.length} comando(s) registrados correctamente (${label}).\n`);
  } catch (err) {
    console.error(`\n❌  Error al registrar comandos (${label}): ${err.message}\n`);
    console.error(err);
    process.exit(1);
  }
}

if (GUILD_ID) {
  await put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), staffDefs, `staff → guild ${GUILD_ID} (instantáneo)`);
  await put(globalRoute, playerDefs, 'jugador → global + MD (hasta 1h de propagación)');
} else {
  await put(globalRoute, [...staffDefs, ...playerDefs], 'todos (sin GUILD_ID) → global (hasta 1h de propagación)');
}
