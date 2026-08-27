/**
 * Skill artifact upload slots — ports pkg/domain/skill/transfer/slots.go.
 * The in-memory registry of single-use upload capabilities plus the
 * staging directory their bytes land in (#675).
 *
 * In-memory is deliberate: the OSS server is single-instance (the same
 * assumption the in-process router transport and SQLite store already
 * make), and a slot is worthless across restarts anyway — its bytes live
 * in the staging directory, which is swept on boot.
 *
 * Sentinel error classes replace Go's sentinel error values so the HTTP
 * handler maps registry failures onto honest status codes without string
 * matching; their message texts are Go's, verbatim (they ride wire-visible
 * copy: push's "artifact_upload_ref not usable: %v" and the handler's 400
 * body).
 *
 * Proven by __tests__/slots.test.ts (injected clock for expiry) and the
 * conformance suite's transfer-lane tests.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

import { REF_BYTE_LEN, REF_PREFIX } from "../constants.js";

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

/** Go errSlotEmpty — minted but never (successfully) uploaded to. */
export class SlotEmptyError extends Error {
  constructor() {
    super("upload reference has no uploaded bytes");
    this.name = "SlotEmptyError";
  }
}

/** Go errSizeMismatch — the body disagreed with the minted declaration. */
export class SizeMismatchError extends Error {
  constructor(received: number, declared: number) {
    super(`upload size mismatch: received ${received} bytes, declared ${declared}`);
    this.name = "SizeMismatchError";
  }
}

interface Slot {
  readonly declaredSize: number;
  readonly expiresAtMs: number;
  uploaded: boolean;
}

export class UploadSlots {
  private readonly slots = new Map<string, Slot>();
  private readonly stagingDir: string;
  private readonly ttlMs: number;
  private readonly maxSize: number;
  /** Injectable for expiry tests, mirroring Go's `now` field. */
  private readonly now: () => number;

  /**
   * Creates the registry and prepares the staging directory. Any file
   * already present is an orphan from a previous process (the registry
   * that knew about it died with that process), so the directory is
   * emptied — this is also the crash-recovery story for uploads that
   * never reached their push.
   */
  constructor(
    stagingDir: string,
    ttlMs: number,
    maxSize: number,
    now: () => number = Date.now,
  ) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    this.stagingDir = stagingDir;
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.now = now;
  }

  /**
   * Reserves an upload slot for an artifact of declaredSize bytes and
   * returns its single-use reference + TTL. The caller has already
   * authorized the request and validated declaredSize against the skill
   * size limit; this guard is the registry's own invariant.
   */
  mint(declaredSize: number): { ref: string; ttlMs: number } {
    if (declaredSize <= 0 || declaredSize > this.maxSize) {
      throw new Error(`declared size ${declaredSize} outside (0, ${this.maxSize}]`);
    }
    const ref = REF_PREFIX + randomBytes(REF_BYTE_LEN).toString("hex");
    this.sweep();
    this.slots.set(ref, {
      declaredSize,
      expiresAtMs: this.now() + this.ttlMs,
      uploaded: false,
    });
    return { ref, ttlMs: this.ttlMs };
  }

  /**
   * Streams an upload's body into the slot's staging file. The body must
   * match the size declared at mint time exactly: a shorter body means a
   * truncated transfer, a longer one means the client lied — both reject
   * rather than staging bytes that would fail (or worse, surprise)
   * validation later. The staged file only becomes consumable once this
   * resolves.
   */
  async receive(ref: string, body: Readable): Promise<void> {
    const slot = this.slots.get(ref);
    if (slot === undefined || this.now() > slot.expiresAtMs) {
      throw new SlotUnknownError();
    }
    if (slot.uploaded) {
      throw new SlotConsumedError();
    }
    const declared = slot.declaredSize;

    const filePath = this.stagePath(ref);
    let written = 0;
    try {
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
    const current = this.slots.get(ref);
    if (current === undefined || this.now() > current.expiresAtMs) {
      await fs.promises.rm(filePath, { force: true });
      throw new SlotUnknownError();
    }
    current.uploaded = true;
  }

  /**
   * Returns the staged bytes for ref and retires the slot — an upload
   * reference is strictly single-use. Push calls this when it sees
   * artifact_upload_ref; whatever happens downstream (validation failure
   * included), the slot is gone and the client must re-mint to retry.
   */
  async consume(ref: string): Promise<Uint8Array> {
    const slot = this.slots.get(ref);
    if (slot === undefined || this.now() > slot.expiresAtMs) {
      throw new SlotUnknownError();
    }
    if (!slot.uploaded) {
      throw new SlotEmptyError();
    }
    this.slots.delete(ref);

    const filePath = this.stagePath(ref);
    try {
      const data = await fs.promises.readFile(filePath);
      return data;
    } catch (error) {
      throw new Error(
        `failed to read staged artifact: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await fs.promises.rm(filePath, { force: true });
    }
  }

  /**
   * Drops expired slots and their staged files. Called from mint, which
   * bounds the registry: it can hold at most the slots minted within one
   * TTL window.
   */
  private sweep(): void {
    const nowMs = this.now();
    for (const [ref, slot] of this.slots) {
      if (nowMs > slot.expiresAtMs) {
        this.slots.delete(ref);
        fs.rmSync(this.stagePath(ref), { force: true });
      }
    }
  }

  /**
   * The staging file name for a reference. Public since O5: the local
   * driver's presigned-PUT arm maps refs onto driver staging keys
   * (boot/compose.ts), and that mapping must come from HERE — a
   * re-declared "<ref>.zip" in the composition would drift from stagePath
   * with nothing to catch it.
   */
  stagedFileName(ref: string): string {
    return `${ref}.zip`;
  }

  /**
   * Maps a reference to its staging file. refs are server-generated hex
   * (never client-supplied paths), so simple joining is safe.
   */
  private stagePath(ref: string): string {
    return path.join(this.stagingDir, this.stagedFileName(ref));
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
  return async function* (source: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
    let remaining = limit;
    for await (const chunk of source) {
      if (remaining <= 0) {
        return;
      }
      const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      remaining -= slice.length;
      onBytes(slice.length);
      yield slice;
    }
  };
}
