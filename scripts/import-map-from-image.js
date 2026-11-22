









































import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { withTransaction } from '../src/database/index.js';
import { upsertTileTerrain } from '../src/services/mapService.js';
import { regenerateWholeMapTemperatures } from '../src/services/temperatureService.js';
import { listTerrainTypes } from '../src/services/terrainTypeService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRID_MIN = 0;
const GRID_MAX = 100;









const CLASSIFIABLE_TERRAIN_NAMES = ['yermo', 'costa', 'mar', 'mar_profundo', 'montana'];





const CONFIDENCE_THRESHOLD = 60;


function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--image') args.image = argv[++i];
    else if (a === '--origin-x') args.originX = Number(argv[++i]);
    else if (a === '--origin-y') args.originY = Number(argv[++i]);
    else if (a === '--cell-width') args.cellWidth = Number(argv[++i]);
    else if (a === '--cell-height') args.cellHeight = Number(argv[++i]);
  }
  return args;
}


function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}



function isGridPixel(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return lum < 110 && chroma < 30;
}






function findAxisPeaks(png, axis) {
  const { width, height, data } = png;
  const length = axis === 'x' ? width : height;
  const otherLength = axis === 'x' ? height : width;
  const frac = new Array(length).fill(0);

  for (let i = 0; i < length; i++) {
    let dark = 0;
    for (let j = 0; j < otherLength; j++) {
      const x = axis === 'x' ? i : j;
      const y = axis === 'x' ? j : i;
      const idx = (width * y + x) << 2;
      if (isGridPixel(data[idx], data[idx + 1], data[idx + 2])) dark++;
    }
    frac[i] = dark / otherLength;
  }

  const THRESHOLD = 0.2;
  const peaks = [];
  let inPeak = false, peakStart = 0;
  for (let i = 0; i < frac.length; i++) {
    if (frac[i] >= THRESHOLD) {
      if (!inPeak) { inPeak = true; peakStart = i; }
    } else if (inPeak) {
      inPeak = false;
      peaks.push(Math.round((peakStart + i - 1) / 2));
    }
  }
  if (inPeak) peaks.push(Math.round((peakStart + frac.length - 1) / 2));
  return peaks;
}


function calibrateAxis(peaks) {
  if (peaks.length < 2) return null;
  const spacings = [];
  for (let i = 1; i < peaks.length; i++) spacings.push(peaks[i] - peaks[i - 1]);
  const sorted = [...spacings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const good = [peaks[0]];
  for (let i = 1; i < peaks.length; i++) {
    const gap = peaks[i] - peaks[i - 1];
    if (Math.abs(gap - median) <= median * 0.25) good.push(peaks[i]);
  }
  if (good.length < 2) return null;

  const originPx = good[0];
  const lastPx = good[good.length - 1];
  const cellPx = (lastPx - originPx) / ((good.length - 1) * 10);
  return { originPx, cellPx, detectedLines: good.length };
}






function classifyCell(png, centerPxX, centerPxY, cellWidthPx, cellHeightPx, palette) {
  const { width, height, data } = png;
  const x0 = Math.max(0, Math.round(centerPxX - cellWidthPx / 2));
  const x1 = Math.min(width - 1, Math.round(centerPxX + cellWidthPx / 2));
  const y0 = Math.max(0, Math.round(centerPxY - cellHeightPx / 2));
  const y1 = Math.min(height - 1, Math.round(centerPxY + cellHeightPx / 2));
  if (x1 < x0 || y1 < y0) return null;

  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (width * y + x) << 2;
      if (isGridPixel(data[idx], data[idx + 1], data[idx + 2])) continue;
      rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2];
      n++;
    }
  }
  if (n === 0) return null;
  const avg = { r: rSum / n, g: gSum / n, b: bSum / n };

  let best = null, bestDist = Infinity;
  for (const t of palette) {
    const d = colorDistance(avg, t.rgb);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return { terrain: best, distance: bestDist };
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.image) {
    console.error(
      'Uso: node scripts/import-map-from-image.js --image <ruta> [--commit]\n' +
      '     [--origin-x N --origin-y N --cell-width N --cell-height N]'
    );
    process.exit(1);
  }
  if (!fs.existsSync(args.image)) {
    console.error(`❌ No existe el fichero: ${args.image}`);
    process.exit(1);
  }

  const png = PNG.sync.read(fs.readFileSync(args.image));
  console.log(`🖼️  Imagen: ${png.width}×${png.height}px`);

  const calibX = (args.originX != null && args.cellWidth != null)
    ? { originPx: args.originX, cellPx: args.cellWidth }
    : calibrateAxis(findAxisPeaks(png, 'x'));
  const calibY = (args.originY != null && args.cellHeight != null)
    ? { originPx: args.originY, cellPx: args.cellHeight }
    : calibrateAxis(findAxisPeaks(png, 'y'));

  if (!calibX) { console.error('❌ No se pudo autodetectar la cuadrícula en X — pasa --origin-x y --cell-width a mano.'); process.exit(1); }
  if (!calibY) { console.error('❌ No se pudo autodetectar la cuadrícula en Y — pasa --origin-y y --cell-height a mano.'); process.exit(1); }

  console.log(
    `📐 Calibración X: origen=${calibX.originPx}px, celda=${calibX.cellPx.toFixed(2)}px/unidad` +
    (calibX.detectedLines ? ` (${calibX.detectedLines} líneas detectadas)` : ' (manual)')
  );
  console.log(
    `📐 Calibración Y: origen=${calibY.originPx}px, celda=${calibY.cellPx.toFixed(2)}px/unidad` +
    (calibY.detectedLines ? ` (${calibY.detectedLines} líneas detectadas)` : ' (manual)')
  );

  const allTerrainTypes = await listTerrainTypes();
  const palette = CLASSIFIABLE_TERRAIN_NAMES
    .map(name => allTerrainTypes.find(t => t.name === name))
    .filter(Boolean)
    .map(t => ({ name: t.name, displayName: t.display_name, hex: t.color, rgb: hexToRgb(t.color) }));
  if (palette.length === 0) {
    console.error('❌ Ninguno de los tipos de terreno clasificables existe en el catálogo (terrain_types) — ¿BD vacía o sin sembrar?');
    process.exit(1);
  }
  console.log(`🎨 Paleta (${palette.length} tipos): ${palette.map(t => `${t.name}=${t.hex}`).join(', ')}`);

  const results = [];
  const counts = {};
  let lowConfidence = 0;

  for (let y = GRID_MIN; y <= GRID_MAX; y++) {
    for (let x = GRID_MIN; x <= GRID_MAX; x++) {




      const pxX = calibX.originPx + (x + 0.5) * calibX.cellPx;
      const pxY = calibY.originPx + (y + 0.5) * calibY.cellPx;
      const classified = classifyCell(png, pxX, pxY, calibX.cellPx, calibY.cellPx, palette);
      if (!classified) continue;
      if (classified.distance > CONFIDENCE_THRESHOLD) lowConfidence++;
      results.push({ x, y, terrain: classified.terrain });
      counts[classified.terrain.name] = (counts[classified.terrain.name] ?? 0) + 1;
    }
  }

  console.log(`\n📊 Resumen (${results.length} casillas clasificadas de ${(GRID_MAX - GRID_MIN + 1) ** 2} posibles):`);
  for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${name}: ${count}`);
  }
  console.log(`   ⚠️  Confianza baja (posible texto/icono/borde de la imagen): ${lowConfidence}`);


  const previewDir = path.join(__dirname, 'map-import');
  fs.mkdirSync(previewDir, { recursive: true });
  const SCALE = 8;
  const gridSize = GRID_MAX - GRID_MIN + 1;
  const preview = new PNG({ width: gridSize * SCALE, height: gridSize * SCALE });
  for (const { x, y, terrain } of results) {
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const px = x * SCALE + dx, py = y * SCALE + dy;
        const idx = (preview.width * py + px) << 2;
        preview.data[idx]     = terrain.rgb.r;
        preview.data[idx + 1] = terrain.rgb.g;
        preview.data[idx + 2] = terrain.rgb.b;
        preview.data[idx + 3] = 255;
      }
    }
  }
  const previewPath = path.join(previewDir, 'preview.png');
  fs.writeFileSync(previewPath, PNG.sync.write(preview));
  console.log(`\n🖼️  Preview escrito en: ${previewPath}`);
  console.log('   Ábrelo y compáralo con la imagen original ANTES de aplicar nada.');

  if (!args.commit) {
    console.log('\n(Modo dry-run — la base de datos NO se ha tocado. Vuelve a ejecutar con --commit para aplicar de verdad.)');
    return;
  }

  await withTransaction(async () => {
    for (const { x, y, terrain } of results) {
      await upsertTileTerrain(x, y, terrain.name, `${terrain.displayName} (${x},${y})`);
    }
  });
  console.log(`✅ ${results.length} casillas escritas en la base de datos (terreno + nombre; owner/recurso/nación/efecto de las que ya existieran no se han tocado).`);

  const withTemperature = await regenerateWholeMapTemperatures();
  console.log(`🌡️  Temperatura recalculada en ${withTemperature} casillas.`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
