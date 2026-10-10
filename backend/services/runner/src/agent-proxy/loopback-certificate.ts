/**
 * The certificate the local proxy's Cursor lane serves TLS with
 * (`cursor-lane.ts`): one self-signed certificate for `127.0.0.1`, made at
 * each runner start, whose private key never leaves the runner's memory.
 *
 * Why TLS on loopback at all: the Cursor SDK opens its agent run as an
 * HTTP/2 bidirectional stream only for an `https:` backend; for an `http:`
 * one it falls back to HTTP/1.1 and an emulation of the stream that the
 * Stigmer platform's proxy does not serve. So the host's SDK is pointed at
 * an `https://127.0.0.1` lane, and the host trusts exactly this certificate
 * (`NODE_EXTRA_CA_CERTS`, `agent-host/hosting.ts`).
 *
 * Node can generate the key but not the certificate, so the certificate is
 * encoded here, in the few DER structures X.509 needs: an EC P-256 key, a
 * subject alternative name of IP 127.0.0.1, a ten-year validity (the
 * certificate lives as long as one runner process, and its key with it),
 * signed with ECDSA over SHA-256. The tests prove it the way the host uses
 * it: Node's own X.509 parser reads it, and a TLS handshake that trusts it
 * succeeds against `127.0.0.1`.
 */

import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** A certificate and its key, both PEM; the key is the runner's alone. */
export interface LoopbackCertificate {
  readonly certPem: string;
  readonly keyPem: string;
}

const OID_COMMON_NAME = "2.5.4.3";
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const VALIDITY_YEARS = 10;

/** Make a fresh key and a self-signed certificate for `127.0.0.1`; `serial` is random but for a test's. */
export function mintLoopbackCertificate(now: Date = new Date(), serial: Buffer = randomBytes(16)): LoopbackCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const name = sequence(set(sequence(oid(OID_COMMON_NAME), utf8("stigmer agent proxy"))));
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime());
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALIDITY_YEARS);
  const signatureAlgorithm = sequence(oid(OID_ECDSA_SHA256));
  const extensions = sequence(
    sequence(oid(OID_SUBJECT_ALT_NAME), octetString(sequence(tlv(0x87, Buffer.from([127, 0, 0, 1]))))),
    sequence(oid(OID_EXT_KEY_USAGE), octetString(sequence(oid(OID_SERVER_AUTH)))),
  );
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    signatureAlgorithm,
    name,
    sequence(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, extensions),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certificate = sequence(tbs, signatureAlgorithm, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return {
    certPem: pem("CERTIFICATE", certificate),
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

// ─── DER ──────────────────────────────────────────────────────────────────

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function sequence(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts));
}

/**
 * A non-negative INTEGER in DER's minimal form: leading zero bytes dropped
 * (a parser refuses them as padding), then one zero put back when the first
 * byte's high bit would read as a sign.
 */
function integer(value: Buffer): Buffer {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const minimal = value.subarray(start);
  return tlv(0x02, minimal[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), minimal]) : minimal);
}

function octetString(content: Buffer): Buffer {
  return tlv(0x04, content);
}

function utf8(text: string): Buffer {
  return tlv(0x0c, Buffer.from(text, "utf8"));
}

/**
 * A validity date as RFC 5280 requires: UTCTime (`YYMMDDHHMMSSZ`) through
 * 2049, GeneralizedTime (`YYYYMMDDHHMMSSZ`) from 2050.
 */
function time(date: Date): Buffer {
  const two = (n: number): string => String(n).padStart(2, "0");
  const year = date.getUTCFullYear();
  const text =
    (year < 2050 ? two(year % 100) : String(year)) +
    two(date.getUTCMonth() + 1) +
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes()) +
    two(date.getUTCSeconds()) +
    "Z";
  return tlv(year < 2050 ? 0x17 : 0x18, Buffer.from(text, "ascii"));
}

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const groups: number[] = [];
    for (let value = arc; ; value = Math.floor(value / 128)) {
      groups.unshift(value % 128);
      if (value < 128) break;
    }
    bytes.push(...groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g)));
  }
  return tlv(0x06, Buffer.from(bytes));
}

function pem(label: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
