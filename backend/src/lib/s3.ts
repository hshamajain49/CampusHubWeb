// One S3 client for Neon Object Storage (venue photos and complaint photos share the branch credential).
import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/env.js';

let client: S3Client | undefined;

export function neonS3(): S3Client {
  client ??= new S3Client({
    endpoint: config.AWS_ENDPOINT_URL_S3,
    region: config.AWS_REGION,
    credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID!, secretAccessKey: config.AWS_SECRET_ACCESS_KEY! },
    forcePathStyle: true, // required by Neon: path-style addressing only
    maxAttempts: 2,
  });
  return client;
}
