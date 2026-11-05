/**
 * Receipts: what a sandboxed runner holds in place of Temporal's task
 * tokens.
 *
 * Temporal's task token is unsigned: whoever holds one can complete, fail
 * or heartbeat that activity, whatever queue it was polled from. So the
 * lane never hands a sandbox Temporal's token. It hands a receipt that
 * binds the token to the sandbox's own task queue under the server's key,
 * and on every reply it opens the receipt, checks the queue is the
 * caller's own, and forwards Temporal's token. The lane never decodes
 * Temporal's token: it is the vendor's private message.
 *
 * Layout (version 1): `0x01`, the queue's UTF-8 length (two bytes, big
 * endian), the queue, HMAC-SHA256 over the version byte, the queue and
 * Temporal's token, then Temporal's token. The receipt binds the sandbox's
 * QUEUE, not its credential, so a renewed sandbox token keeps its
 * in-flight tasks.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = 0x01;
const MAC_BYTES = 32;

/** A receipt for Temporal's `token`, issued to the sandbox serving `queue`. */
export function issueReceipt(key: Buffer, queue: string, token: Uint8Array): Buffer {
  const queueBytes = Buffer.from(queue, "utf8");
  const header = Buffer.alloc(3);
  header.writeUInt8(VERSION, 0);
  header.writeUInt16BE(queueBytes.length, 1);
  const mac = macOf(key, queueBytes, token);
  return Buffer.concat([header, queueBytes, mac, token]);
}

/** What a genuine receipt carries. */
export interface OpenedReceipt {
  readonly queue: string;
  readonly token: Uint8Array;
}

/** The receipt's queue and Temporal's token, or undefined for anything the server did not issue. */
export function openReceipt(key: Buffer, receipt: Uint8Array): OpenedReceipt | undefined {
  const bytes = Buffer.from(receipt);
  if (bytes.length < 3 || bytes.readUInt8(0) !== VERSION) {
    return undefined;
  }
  const queueLength = bytes.readUInt16BE(1);
  const macStart = 3 + queueLength;
  const tokenStart = macStart + MAC_BYTES;
  if (bytes.length <= tokenStart) {
    return undefined;
  }
  const queueBytes = bytes.subarray(3, macStart);
  const mac = bytes.subarray(macStart, tokenStart);
  const token = bytes.subarray(tokenStart);
  if (!timingSafeEqual(mac, macOf(key, queueBytes, token))) {
    return undefined;
  }
  return { queue: queueBytes.toString("utf8"), token: new Uint8Array(token) };
}

function macOf(key: Buffer, queue: Buffer, token: Uint8Array): Buffer {
  return createHmac("sha256", key).update(Buffer.from([VERSION])).update(queue).update(token).digest();
}
