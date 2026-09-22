/**
 * Skill artifact upload slots — the local blob driver's staging mechanism,
 * ported from pkg/domain/skill/transfer/slots.go: an in-memory registry of
 * single-use upload capabilities plus the staging files their bytes land
 * in (#675).
 *
 * A slot is keyed by the STAGING KEY the domain names (`skills/staging/
 * <hex>.zip`, transfer/staging.ts), and its file is that key resolved
 * under the blob driver's root — so the driver's own download(key) reads
 * what the lane received and its delete(key) retires the bytes, exactly
 * as a bucket driver's would. The registry therefore knows nothing of
 * consumption: it reserves, receives, and sweeps; the domain reads and
 * deletes through the driver, one path for every backend.
 *
 * In-memory is deliberate: the local driver is single-instance (the same
 * assumption the in-process router transport and SQLite store already
 * make), and a slot is worthless across restarts anyway — its bytes live
 * in the staging directory, which is swept on boot.
 *
 * Sentinel error classes replace Go's sentinel error values so the HTTP
 * handler maps registry failures onto honest status codes without string
 * matching; their message texts are Go's, verbatim (they ride wire-visible
 * copy: the handler's 404, 409 and 400 bodies).
 *
 * Proven by __tests__/slots.test.ts (injected clock for expiry) and the
 * conformance suite's transfer-lane tests.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

/** Go errSlotUnknown — never existed, expired, or swept. */
export class SlotUnknownError extends Error {
  constructor() {
    super("upload reference unknown or expired");
    this.name = "SlotUnknownError";
  }
}

/** Go errSlotConsumed — the slot already carries an upload. */
export class SlotConsumedError extends Error {
  constructor() {
    super("upload reference already carries an upload");
    this.name = "SlotConsumedError";
  }
}

/** Go errSizeMismatch — the body disagreed with the reserved declaration. */
export class SizeMismatchError extends Error {
  constructor(received: number, declared: number) {
    super(
      `upload size mismatch: received ${received} bytes, declared ${declared}`,
    );
    this.name = "SizeMismatchError";
  }
}

interface Slot {
  readonly declaredSize: number;
  readonly expiresAtMs: number;
  uploaded: boolean;
}

/**
 * The one file-name shape a staging key may carry past its prefix: the
 * domain's hex reference plus the archive suffix. Keys are server-minted,
 * never client-supplied, so this is an invariant check, not input
 * validation — a violation is a programming error and throws.
 */
const STAGED_FILE_NAME = /^[0-9a-f]+\.zip$/;

export class UploadSlots {
  private readonly slots = new Map<string, Slot>();
  private readonly stagingDir: string;
  /** Injectable for expiry tests, mirroring Go's `now` field. */
  private readonly now: () => number;

  /**
   * Creates the registry over `root` (the local blob driver's root) and
   * prepares the staging directory `root/stagingPrefix`. Any file already
   * present is an orphan from a previous process (the registry that knew
   * about it died with that process), so the directory is emptied — this
   * is also the crash-recovery story for uploads that never reached their
   * push.
   */
  constructor(
    private readonly root: string,
    private readonly stagingPrefix: string,
    private readonly ttlMs: number,
    private readonly maxSize: number,
    now: () => number = Date.now,
  ) {
    this.stagingDir = path.join(root, stagingPrefix);
    fs.rmSync(this.stagingDir, { recursive: true, force: true });
    fs.mkdirSync(this.stagingDir, { recursive: true, mode: 0o700 });
    this.now = now;
  }

  /**
   * Reserves an upload slot for an artifact of declaredSize bytes at the
   * staging key; returns the TTL granted. The caller has already
   * authorized the request and validated declaredSize against the skill
   * size limit; the bound here is the registry's own invariant.
   */
  reserve(key: string, declaredSize: number): { ttlMs: number } {
    if (declaredSize <= 0 || declaredSize > this.maxSize) {
      throw new Error(
        `declared size ${declaredSize} outside (0, ${this.maxSize}]`,
      );
    }
    this.stagePath(key);
    if (this.slots.has(key)) {
      throw new Error(`staging key ${key} is already reserved`);
    }
    this.sweep();
    this.slots.set(key, {
      declaredSize,
      expiresAtMs: this.now() + this.ttlMs,
      uploaded: false,
    });
    return { ttlMs: this.ttlMs };
  }

  /**
   * Streams an upload's body into the slot's staging file. The body must
   * match the size declared at reservation exactly: a shorter body means a
   * truncated transfer, a longer one means the client lied — both reject
   * rather than staging bytes that would fail (or worse, surprise)
   * validation later. The staged file only becomes readable through the
   * driver once this resolves.
   */
  async receive(key: string, body: Readable): Promise<void> {
    const slot = this.slots.get(key);
    if (slot === undefined || this.now() > slot.expiresAtMs) {
      throw new SlotUnknownError();
    }
    if (slot.uploaded) {
      throw new SlotConsumedError();
    }
    const declared = slot.declaredSize;

    const filePath = this.stagePath(key);
    let written = 0;
    try {
      // The driver's delete(key) prunes directories it empties, so the
      // staging directory may be gone between two uploads; recreate it
      // rather than fail the second one.
      await fs.promises.mkdir(path.dirname(filePath), {
        recursive: true,
        mode: 0o700,
      });
      // Consume at most declared+1 bytes: seeing the extra byte proves the
      // body exceeds the declaration without buffering an unbounded stream
      // (Go's io.LimitReader(declared+1) + written != declared check).
      await pipeline(
        body,
        limitBytes(declared + 1, (n) => {
          written += n;
        }),
        fs.createWriteStream(filePath, { flags: "w", mode: 0o600 }),
      );
    } catch (error) {
      await fs.promises.rm(filePath, { force: true });
      throw new Error(
        `failed to receive upload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (written !== declared) {
      await fs.promises.rm(filePath, { force: true });
      throw new SizeMismatchError(written, declared);
    }

    // Re-check after the write: the slot may have expired mid-upload
    // (Go re-checks under the lock for the same reason).
    const current = this.slots.get(key);
    if (current === undefined || this.now() > current.expiresAtMs) {
      await fs.promises.rm(filePath, { force: true });
      throw new SlotUnknownError();
    }
    current.uploaded = true;
  }

  /**
   * Drops expired slots and their staged files. Called from reserve, which
   * bounds the registry: it can hold at most the slots reserved within one
   * TTL window.
   */
  private sweep(): void {
    const nowMs = this.now();
    for (const [key, slot] of this.slots) {
      if (nowMs > slot.expiresAtMs) {
        this.slots.delete(key);
        fs.rmSync(this.stagePath(key), { force: true });
      }
    }
  }

  /**
   * Maps a staging key to its file: the key resolved under the driver's
   * root, which is how the driver's download(key) will look for it. The
   * key must carry the staging prefix and a plain hex file name — anything
   * else is a caller bug, refused before it touches the filesystem.
   */
  private stagePath(key: string): string {
    if (!key.startsWith(this.stagingPrefix)) {
      throw new Error(`staging key ${key} is outside ${this.stagingPrefix}`);
    }
    const fileName = key.slice(this.stagingPrefix.length);
    if (!STAGED_FILE_NAME.test(fileName)) {
      throw new Error(`staging key ${key} does not name a staged archive`);
    }
    return path.join(this.root, key);
  }
}

/**
 * A byte-capped pass-through: forwards up to `limit` bytes (counting via
 * onBytes) and then stops consuming — the TS analogue of piping through
 * io.LimitReader.
 */
function limitBytes(
  limit: number,
  onBytes: (count: number) => void,
): (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer> {
  return async function* (
    source: AsyncIterable<Buffer>,
  ): AsyncIterable<Buffer> {
    let remaining = limit;
    for await (const chunk of source) {
      if (remaining <= 0) {
        return;
      }
      const slice =
        chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      remaining -= slice.length;
      onBytes(slice.length);
      yield slice;
    }
  };
}
