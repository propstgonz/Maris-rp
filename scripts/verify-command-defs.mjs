import { Collection } from 'discord.js';
import { loadCommands } from '../src/loaders/commandLoader.js';

const SUB = 1, SUB_GROUP = 2;

const client = { commands: new Collection() };
const { skipped } = await loadCommands(client);
const list = [...client.commands.values()];

let bad = 0;
const fail = (...m) => { console.error('  ✗', ...m); bad++; };

if (skipped > 0) fail(`${skipped} fichero(s) de comando se omitieron al cargar — revisa los avisos de [CommandLoader] arriba.`);

const byCategory = {};
const seenNames = new Map();

for (const cmd of list) {
  const label = cmd?.data?.name ?? '(sin nombre)';
  (byCategory[cmd.category ?? '?'] ??= []).push(label);

  if (seenNames.has(label)) fail(`nombre duplicado: /${label} (${seenNames.get(label)} y ${cmd.category})`);
  seenNames.set(label, cmd.category);

  let json;
  try {
    json = cmd.data.toJSON();
  } catch (err) {
    fail(`/${label}: toJSON() lanza — ${err.message}`);
    continue;
  }

  const options = json.options ?? [];
  const groups  = options.filter(o => o.type === SUB || o.type === SUB_GROUP);

  if (groups.length && groups.length !== options.length) {
    fail(`/${label}: mezcla subcomandos con opciones sueltas — Discord lo rechaza`);
  }

  const leaves = groups.flatMap(o =>
    o.type === SUB_GROUP
      ? (o.options ?? []).map(s => [`${o.name} ${s.name}`, s.options ?? []])
      : [[o.name, o.options ?? []]]
  );
  const targets = leaves.length ? leaves : [['', options]];

  for (const [path, opts] of targets) {
    let seenOptional = null;
    for (const opt of opts) {
      if (opt.required) {
        if (seenOptional) fail(`/${label} ${path}: "${opt.name}" es obligatoria pero va tras la opcional "${seenOptional}"`);
      } else {
        seenOptional ??= opt.name;
      }
    }
  }
}

console.log(`Comandos cargados: ${list.length}`);
for (const [cat, names] of Object.entries(byCategory)) {
  console.log(`  ${cat} (${names.length}): ${names.sort().join(', ')}`);
}
console.log(bad ? `\n${bad} problema(s) de definición` : '\nDefiniciones válidas — 0 problemas');
process.exit(bad ? 1 : 0);
