import type { StorageDriver } from './driver.js';
import type { ResolvedMediaConfig } from './config.js';
import { LocalDriver } from './local-driver.js';
import { S3Driver, type S3Config } from './s3-driver.js';

/** Filesystem base dir for the local driver (shared volume in Swarm). */
export function localBaseDir(): string {
  return process.env.MEDIA_LOCAL_PATH || '/data/media';
}

// Cache one driver instance per process, keyed by a signature of its config so
// a reconfiguration (e.g. switching to S3) rebuilds it.
let cached: { sig: string; driver: StorageDriver } | undefined;

function signature(cfg: ResolvedMediaConfig): string {
  if (cfg.driver === 's3' && cfg.s3) {
    const s = cfg.s3;
    return `s3:${s.endpoint ?? ''}:${s.region}:${s.bucket}:${s.accessKeyId}:${s.forcePathStyle ? 1 : 0}`;
  }
  return `local:${localBaseDir()}`;
}

export function getStorageDriver(cfg: ResolvedMediaConfig): StorageDriver {
  const sig = signature(cfg);
  if (cached?.sig === sig) return cached.driver;
  const driver: StorageDriver =
    cfg.driver === 's3' && cfg.s3 ? new S3Driver(cfg.s3) : new LocalDriver(localBaseDir());
  cached = { sig, driver };
  return driver;
}

/** Validate an S3 config (HeadBucket) before persisting it. */
export async function testS3(cfg: S3Config): Promise<{ ok: boolean; detail?: string }> {
  try {
    const sdk = await import('@aws-sdk/client-s3');
    const client = new sdk.S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    await client.send(new sdk.HeadBucketCommand({ Bucket: cfg.bucket }));
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
