import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { StorageDriver, PutOptions } from './driver.js';

/**
 * Filesystem-backed storage. Keys are relative paths under `baseDir`; in Docker
 * Swarm the worker (writer) and panel-api (reader) MUST mount the same volume at
 * this path, otherwise the panel can't serve what the worker stored.
 */
export class LocalDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private abs(key: string): string {
    // Prevent path traversal: keys are always relative, no `..` segments.
    const safe = key.replace(/\\/g, '/').replace(/(^|\/)\.\.(\/|$)/g, '/');
    return join(this.baseDir, safe);
  }

  async put(key: string, body: Buffer, _opts: PutOptions): Promise<void> {
    const path = this.abs(key);
    await mkdir(dirname(path), { recursive: true });
    // Atomic write: stage to a temp file then rename into place.
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, path);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.abs(key));
  }

  async stream(key: string): Promise<Readable> {
    return createReadStream(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.abs(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.abs(key)).catch(() => undefined);
  }

  async presignedUrl(): Promise<string | null> {
    return null;
  }
}
