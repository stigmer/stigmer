import { gzipSync, gunzipSync } from "node:zlib";

export function compress(data: Buffer): Buffer<ArrayBuffer> {
  return gzipSync(data) as Buffer<ArrayBuffer>;
}

export function decompress(data: Buffer): Buffer<ArrayBuffer> {
  return gunzipSync(data) as Buffer<ArrayBuffer>;
}
