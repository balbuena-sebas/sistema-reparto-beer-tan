const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

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
  async upload(key, body, contentType = "application/json") {
    if (this.buckets.length === 0) throw new Error("No hay storage configurado");

    let lastError;
    // Intentamos en cada bucket disponible
    for (const storage of this.buckets) {
      try {
        const command = new PutObjectCommand({
          Bucket: storage.bucketName,
          Key: key,
          Body: typeof body === 'object' ? JSON.stringify(body) : body,
          ContentType: contentType,
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
      const listCommand = new ListObjectsV2Command({
        Bucket: storage.bucketName,
        MaxKeys: 100 // Limpiamos de a poco para no saturar las operaciones de Clase A
      });

      const data = await storage.client.send(listCommand);
      if (!data.Contents) return;

      const now = new Date();
      const expirationDate = new Date(now.getTime() - (this.retentionDays * 24 * 60 * 60 * 1000));

      for (const object of data.Contents) {
        if (object.LastModified < expirationDate) {
          console.log(`🗑 Borrando archivo viejo para liberar espacio: ${object.Key} (Modificado: ${object.LastModified})`);
          await storage.client.send(new DeleteObjectCommand({
            Bucket: storage.bucketName,
            Key: object.Key
          }));
        }
      }
    } catch (err) {
      console.error("Error en autoCleanup:", err.message);
    }
  }

  /**
   * Obtiene una URL firmada para leer el archivo
   * @param {string} key El key guardado (con prefijo de cuenta si es necesario)
   */
  async getDownloadUrl(fileRef) {
    // Si guardamos la referencia como "key?acc=account_2", la parseamos
    const [key, query] = fileRef.split('?');
    const accountId = query?.split('=')[1] || 'account_1';
    
    const storage = this.buckets.find(b => b.id === accountId) || this.buckets[0];
    if (!storage) throw new Error("Storage no encontrado");

    const command = new GetObjectCommand({
      Bucket: storage.bucketName,
      Key: key,
    });

    // La URL expira en 1 hora por seguridad
    return await getSignedUrl(storage.client, command, { expiresIn: 3600 });
  }
}

module.exports = new StorageManager();
