/**
 * The receipt signing key (receipts.ts): one row in the server's own store,
 * created on first use, first writer wins, so every replica sharing the
 * database signs with the same key and no install carries a new secret.
 * It is independent of every other key's rotation: a receipt outlives a
 * runner token's renewal and a runner-auth key's change.
 *
 * Read once per process and cached. A failed read is not cached, so the
 * next call tries again; the lane answers UNAVAILABLE meanwhile.
 */
import { randomBytes } from "node:crypto";

import type { BootstrapStateStore } from "../../store/interface.js";

/** The bootstrap-state key the row lives under. Pinned: changing it orphans every in-flight receipt. */
export const RECEIPT_KEY_STATE_KEY = "temporal-worker-door.receipt-key";

const KEY_BYTES = 32;

export type ReceiptKeySource = () => Promise<Buffer>;

export function newReceiptKeySource(state: Pick<BootstrapStateStore, "claim">): ReceiptKeySource {
  let cached: Promise<Buffer> | undefined;
  return () => {
    cached ??= load(state).catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
}

async function load(state: Pick<BootstrapStateStore, "claim">): Promise<Buffer> {
  const won = await state.claim(RECEIPT_KEY_STATE_KEY, randomBytes(KEY_BYTES).toString("base64"));
  const key = Buffer.from(won, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`the stored receipt key is not ${KEY_BYTES} bytes`);
  }
  return key;
}
