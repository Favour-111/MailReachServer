// Attachment storage: S3-compatible bucket when S3_BUCKET is set, otherwise local ./uploads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

const { s3: s3cfg } = config;
const useS3 = Boolean(s3cfg.bucket);
const s3 = useS3
  ? new S3Client({
      region: s3cfg.region,
      endpoint: s3cfg.endpoint,
      forcePathStyle: Boolean(s3cfg.endpoint),
      credentials: { accessKeyId: s3cfg.accessKeyId, secretAccessKey: s3cfg.secretAccessKey },
    })
  : null;
const localDir = path.resolve('uploads');

const localPath = (key) => path.join(localDir, path.basename(key));

export async function putFile(key, buffer, contentType) {
  if (useS3) {
    await s3.send(new PutObjectCommand({ Bucket: s3cfg.bucket, Key: key, Body: buffer, ContentType: contentType }));
  } else {
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(localPath(key), buffer);
  }
}

export async function getFile(key) {
  if (useS3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: s3cfg.bucket, Key: key }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  return fs.readFile(localPath(key));
}

export async function deleteFile(key) {
  try {
    if (useS3) await s3.send(new DeleteObjectCommand({ Bucket: s3cfg.bucket, Key: key }));
    else await fs.unlink(localPath(key));
  } catch {
    /* already gone */
  }
}
