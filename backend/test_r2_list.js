require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID_1}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_1,
    secretAccessKey: process.env.R2_SECRET_KEY_1,
  },
});

async function run() {
  try {
    console.log("🔍 Listando archivos en R2...");
    const cmd = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME_1,
      Prefix: 'rechazos/'
    });
    const res = await s3.send(cmd);
    if (res.Contents) {
      res.Contents.forEach(obj => console.log(`- ${obj.Key} (${obj.Size} bytes)`));
    } else {
      console.log("No se encontraron archivos con el prefijo 'rechazos/'");
    }
  } catch (err) {
    console.error("❌ Error en R2:", err.message);
  } finally {
    process.exit();
  }
}

run();
