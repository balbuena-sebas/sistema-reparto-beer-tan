const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

function bufferReplacer(key, value) {
  if (Buffer.isBuffer(value)) {
    return { __type: 'Buffer', data: value.toString('base64') };
  }
  return value;
}

function bufferReviver(key, value) {
  if (value && value.__type === 'Buffer' && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64');
  }
  return value;
}

/**
 * Gestor de almacenamiento multi-cuenta para Cloudflare R2
 * Permite distribuir archivos en diferentes cuentas para maximizar el almacenamiento gratuito.
 */
class StorageManager {
  constructor() {
    this.buckets = [];
    this._initBuckets();
    this.retentionDays = parseInt(process.env.R2_RETENTION_DAYS || "365");
  }

  _initBuckets() {
    // Configuración Cuenta 1
    if (process.env.R2_ACCOUNT_ID_1) {
      this.buckets.push({
        id: 'account_1',
        client: new S3Client({
          region: "auto",
          endpoint: `https://${process.env.R2_ACCOUNT_ID_1}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_1,
            secretAccessKey: process.env.R2_SECRET_KEY_1,
          },
        }),
        bucketName: process.env.R2_BUCKET_NAME_1
      });
    }

    // Configuración Cuenta 2
    if (process.env.R2_ACCOUNT_ID_2) {
      this.buckets.push({
        id: 'account_2',
        client: new S3Client({
          region: "auto",
          endpoint: `https://${process.env.R2_ACCOUNT_ID_2}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_2,
            secretAccessKey: process.env.R2_SECRET_KEY_2,
          },
        }),
        bucketName: process.env.R2_BUCKET_NAME_2
      });
    }
  }

  /**
   * Sube un archivo a R2. Intenta en la cuenta 1, si falla, intenta en la 2.
   * @param {string} key Nombre/Ruta del archivo (ej: 'historial/2024-03-excel.json')
   * @param {any} body Contenido (Buffer o string)
   * @param {string} contentType Tipo de archivo
   */
  async upload(key, body, contentType = "application/json", options = {}) {
    if (this.buckets.length === 0) throw new Error("No hay storage configurado");

    const isJsonObject = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const shouldCompress = options.compress !== false && isJsonObject && contentType === 'application/json';
    let payload = body;
    const extraParams = {};

    if (isJsonObject) {
      const json = JSON.stringify(body, bufferReplacer);
      if (shouldCompress) {
        payload = await gzip(Buffer.from(json, 'utf8'));
        extraParams.ContentEncoding = 'gzip';
        if (!key.endsWith('.gz')) key = `${key}.gz`;
      } else {
        payload = json;
      }
    }

    let lastError;
    // Intentamos en cada bucket disponible
    for (const storage of this.buckets) {
      try {
        const command = new PutObjectCommand({
          Bucket: storage.bucketName,
          Key: key,
          Body: payload,
          ContentType: contentType,
          ...extraParams,
        });

        await storage.client.send(command);
        console.log(`✅ Archivo subido con éxito a ${storage.id}: ${key}`);
        
        // Ejecutar limpieza automática en segundo plano cada vez que subimos algo
        this.autoCleanup(storage).catch(err => console.error("⚠ Falló la limpieza automática:", err.message));

        return { 
          ok: true, 
          key, 
          accountId: storage.id,
          url: `${key}?acc=${storage.id}` // Guardamos referencia de qué cuenta lo tiene
        };
      } catch (err) {
        console.error(`❌ Error subiendo a ${storage.id}:`, err.message);
        lastError = err;
      }
    }
    throw lastError;
  }

  /**
   * Borra archivos viejos según la política de retención para evitar cargos
   */
  async autoCleanup(storage) {
    if (!this.retentionDays || this.retentionDays <= 0) return;

    try {
      let continuationToken;
      const now = new Date();
      const expirationDate = new Date(now.getTime() - (this.retentionDays * 24 * 60 * 60 * 1000));

      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: storage.bucketName,
          MaxKeys: 100,
          ContinuationToken: continuationToken,
        });

        const data = await storage.client.send(listCommand);
        if (!data.Contents) break;

        for (const object of data.Contents) {
          if (object.LastModified < expirationDate) {
            console.log(`🗑 Borrando archivo viejo para liberar espacio: ${object.Key} (Modificado: ${object.LastModified})`);
            await storage.client.send(new DeleteObjectCommand({
              Bucket: storage.bucketName,
              Key: object.Key
            }));
          }
        }

        continuationToken = data.NextContinuationToken;
      } while (continuationToken);
    } catch (err) {
      console.error("Error en autoCleanup:", err.message);
    }
  }

  /**
   * Descarga un archivo de R2 y devuelve su contenido parseado
   */
  async download(key) {
    if (this.buckets.length === 0) throw new Error("No hay storage configurado");

    const candidateKeys = key.endsWith('.gz') ? [key] : [key, `${key}.gz`];
    let lastError;

    for (const storage of this.buckets) {
      for (const candidateKey of candidateKeys) {
        try {
          const command = new GetObjectCommand({
            Bucket: storage.bucketName,
            Key: candidateKey,
          });

          const response = await storage.client.send(command);
          let rawBody;

          if (response.Body?.transformToByteArray) {
            rawBody = Buffer.from(await response.Body.transformToByteArray());
          } else if (response.Body?.transformToString) {
            rawBody = Buffer.from(await response.Body.transformToString(), 'utf8');
          } else if (Buffer.isBuffer(response.Body)) {
            rawBody = response.Body;
          } else if (typeof response.Body === 'string') {
            rawBody = Buffer.from(response.Body, 'utf8');
          } else {
            throw new Error('No se pudo leer el cuerpo del archivo R2');
          }

          const isGzip = response.ContentEncoding === 'gzip' || candidateKey.endsWith('.gz') || response.ContentType === 'application/gzip';
          const jsonText = isGzip ? (await gunzip(rawBody)).toString('utf8') : rawBody.toString('utf8');
          return JSON.parse(jsonText, bufferReviver);
        } catch (err) {
          lastError = err;
        }
      }
    }
    return null; // Si no se encuentra en ninguna cuenta
  }

  async list(prefix = "") {
    if (this.buckets.length === 0) return [];
    const allKeys = new Set();
    for (const storage of this.buckets) {
      try {
        let continuationToken;
        do {
          const command = new ListObjectsV2Command({
            Bucket: storage.bucketName,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          });
          const data = await storage.client.send(command);
          (data.Contents || []).forEach(obj => allKeys.add(obj.Key));
          continuationToken = data.NextContinuationToken;
        } while (continuationToken);
      } catch (err) {
        console.error(`❌ Error listando R2 ${storage.id}:`, err.message);
      }
    }
    return [...allKeys];
  }
}

module.exports = new StorageManager();
