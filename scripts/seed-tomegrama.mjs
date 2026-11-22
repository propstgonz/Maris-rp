import 'dotenv/config';
import { GOODS_CATEGORIES, GOODS } from './seed/goods.mjs';
import { PROPERTY_TYPES } from './seed/properties.mjs';

const db = await import('../src/database/index.js');
const { T } = await import('../src/database/tables.js');
await db.whenReady;

let categories = 0;
let goods = 0;
let propertyTypes = 0;

await db.withTransaction(async () => {
  for (const category of GOODS_CATEGORIES) {
    const { changes } = await db.execute(
      `INSERT IGNORE INTO ${T.item_categories} (name, display_name) VALUES (?, ?)`,
      [category.name, category.displayName]
    );
    categories += changes;
  }

  for (const item of GOODS) {
    const { changes } = await db.execute(
      `INSERT IGNORE INTO ${T.items} (name, display_name, category_id)
       SELECT ?, ?, id FROM ${T.item_categories} WHERE name = ?`,
      [item.name, item.displayName, item.category]
    );
    goods += changes;
  }

  for (const type of PROPERTY_TYPES) {
    const { changes } = await db.execute(
      `INSERT IGNORE INTO ${T.property_types} (name, display_name, category, description) VALUES (?, ?, ?, ?)`,
      [type.name, type.displayName, type.category, type.description]
    );
    propertyTypes += changes;
  }
});

console.log(`Catálogo del Tomegrama: ${categories} categorías, ${goods} bienes y ${propertyTypes} tipos de propiedad nuevos.`);
console.log('Lo que ya existía con el mismo nombre no se ha tocado.');
await db.closePool();
