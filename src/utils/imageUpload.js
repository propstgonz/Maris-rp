import { writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';

export const ALLOWED_IMAGE_TYPES = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

const _bufferStartsWith = (buffer, bytes, offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);

function _matchesImageSignature(buffer, ext) {
  switch (ext) {
    case 'png':  return _bufferStartsWith(buffer, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    case 'jpg':  return _bufferStartsWith(buffer, [0xFF, 0xD8, 0xFF]);
    case 'gif':  return _bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
                     || _bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    case 'webp': return _bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46])
                     && _bufferStartsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8);
    default:     return false;
  }
}

export const ALLOWED_IMAGE_TYPES_LABEL = 'PNG, JPG, WEBP o GIF';

export function sanitizeFilenameComponent(name) {
  const safe = String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!safe) {
    throw new Error(`"${name}" no contiene ningún carácter válido para un nombre de fichero.`);
  }
  return safe;
}

export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

function _validateImageMeta(mimeType, size, maxSizeBytes) {
  const ext = ALLOWED_IMAGE_TYPES[mimeType];

  if (!ext) {
    return {
      ok: false,
      error:
        `Tipo de archivo no permitido: \`${mimeType || 'desconocido'}\`.\n` +
        `Formatos aceptados: **${ALLOWED_IMAGE_TYPES_LABEL}**.`,
    };
  }

  if (size > maxSizeBytes) {
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    const maxMB  = (maxSizeBytes / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      error: `La imagen pesa **${sizeMB} MB**, pero el límite es **${maxMB} MB**.`,
    };
  }

  return { ok: true, ext, mimeType };
}

export function validateImageAttachment(attachment, maxSizeBytes = MAX_IMAGE_SIZE_BYTES) {
  const mimeType = attachment.contentType?.split(';')[0].trim().toLowerCase() ?? '';
  return _validateImageMeta(mimeType, attachment.size, maxSizeBytes);
}

export async function downloadAndSaveImage(attachment, ext, writeDir, filenameBase) {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(
      `La CDN de Discord devolvió HTTP ${response.status} al intentar descargar la imagen.`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return saveImageBuffer(buffer, ext, writeDir, filenameBase);
}

export function validateImageBuffer(file, maxSizeBytes = MAX_IMAGE_SIZE_BYTES) {
  const mimeType = file.mimetype?.split(';')[0].trim().toLowerCase() ?? '';
  return _validateImageMeta(mimeType, file.size, maxSizeBytes);
}

async function _cleanupOldVariants(writeDir, filenameBase, keepExt) {
  let entries;
  try {
    entries = await readdir(writeDir);
  } catch {
    return;
  }
  const prefix = `${filenameBase}.`;
  const keepName = `${filenameBase}.${keepExt}`;
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry !== keepName) {
      await unlink(join(writeDir, entry)).catch(() => {});
    }
  }
}

export async function saveImageBuffer(buffer, ext, writeDir, filenameBase) {
  if (!_matchesImageSignature(buffer, ext)) {
    throw new Error(
      `El contenido del archivo no coincide con el formato declarado (\`.${ext}\`) — puede estar corrupto o no ser realmente una imagen.`
    );
  }

  await mkdir(writeDir, { recursive: true });
  const filename = `${filenameBase}.${ext}`;
  const filepath = join(writeDir, filename);
  await writeFile(filepath, buffer);
  await _cleanupOldVariants(writeDir, filenameBase, ext);

  return { buffer, filename, filepath };
}
