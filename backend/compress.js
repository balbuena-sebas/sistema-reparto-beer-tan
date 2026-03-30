// compress.js — Utilidades de compresión para optimizar espacio en DB
const zlib = require('zlib');
const { promisify } = require('util');

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

async function comprimir(obj) {
  if (obj === null || obj === undefined) return null;
  const json   = JSON.stringify(obj);
  const buffer = await gzip(Buffer.from(json, 'utf8'));
  return buffer;
}

async function descomprimir(buffer) {
  if (!buffer) return null;
  const buf  = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const json = await gunzip(buf);
  return JSON.parse(json.toString('utf8'));
}

/**
 * Versión segura: si el buffer está vacío o falla, devuelve el fallback
 * NUNCA devuelve null si se pasa un fallback
 */
async function descomprimirSafe(buffer, fallback = null) {
  if (!buffer) return fallback;           // <-- si no hay buffer, devuelve fallback directo
  try {
    const result = await descomprimir(buffer);
    return result !== null && result !== undefined ? result : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { comprimir, descomprimir, descomprimirSafe };