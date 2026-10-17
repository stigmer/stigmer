/**
 * Test support for the license suites: a fresh Ed25519 signer per call, a
 * ticket writer that builds the issuer's exact format from parts, so a
 * suite can sign good keys and hand-craft every malformed one, and the
 * claims a current or lapsed license carries. The composed suites and the
 * conformance suite's licensed server (this package's
 * test/conformance/licensed-server.ts) sign with these; nothing here
 * imports a test runner, so a process can.
 *
 * The private key lives only in the test's memory; the public half is
 * exported raw (the JWK `x`), the form the trusted ring holds.
 */
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import { clone, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import {
  LicenseClaimsSchema,
  type LicenseClaims,
} from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";

export interface TestSigner {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  /** The raw 32-byte public key, as the ring holds it. */
  readonly publicKey: Uint8Array;
  /** A ring trusting only this signer. */
  readonly ring: ReadonlyMap<string, Uint8Array>;
}

export function newTestSigner(keyId = "license-signing:test"): TestSigner {
  const pair = generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") {
    throw new Error("an Ed25519 public key exports a JWK x");
  }
  const publicKey = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  return {
    keyId,
    privateKey: pair.privateKey,
    publicKey,
    ring: new Map([[keyId, publicKey]]),
  };
}

export function segment(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export interface TicketParts {
  /** The header object, serialized as given. */
  readonly header?: Record<string, unknown>;
  /** The payload JSON, serialized as given. */
  readonly payload?: JsonValue;
  /** Replaces the signature bytes. */
  readonly signature?: Uint8Array;
}

/** Writes a ticket: the issuer's header and the claims' proto JSON by default, signed by `signer`. */
export function writeTicket(
  signer: TestSigner,
  claims: LicenseClaims,
  parts: TicketParts = {},
): string {
  const header = segment(
    JSON.stringify(parts.header ?? { alg: "EdDSA", typ: "JWT", kid: signer.keyId }),
  );
  const payload = segment(
    JSON.stringify(parts.payload ?? toJson(LicenseClaimsSchema, claims)),
  );
  const signingInput = `${header}.${payload}`;
  const signature =
    parts.signature ?? new Uint8Array(sign(null, Buffer.from(signingInput, "ascii"), signer.privateKey));
  return `${signingInput}.${segment(signature)}`;
}

export interface GoldenVector {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
  readonly claims: LicenseClaims;
  readonly ticket: string;
}

/** The issuer's golden vector, copied beside this file. */
export function goldenVector(): GoldenVector {
  const raw = JSON.parse(
    readFileSync(new URL("./golden/license-ticket.json", import.meta.url), "utf8"),
  ) as { keyId: string; publicKeyBase64: string; claims: JsonValue; ticket: string };
  return {
    keyId: raw.keyId,
    publicKey: new Uint8Array(Buffer.from(raw.publicKeyBase64, "base64")),
    claims: fromJson(LicenseClaimsSchema, raw.claims),
    ticket: raw.ticket,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Claims valid from `issuedAt` for `days`, then a grace period of `graceDays`; `maxOrgs` absent grants no limit. */
export function licenseClaims(options: {
  readonly issuedAt: Date;
  readonly days: number;
  readonly graceDays: number;
  readonly maxOrgs?: number;
}): LicenseClaims {
  const claims = clone(LicenseClaimsSchema, goldenVector().claims);
  const expires = new Date(options.issuedAt.getTime() + options.days * DAY_MS);
  claims.issuedAt = timestampFromDate(options.issuedAt);
  claims.expiresAt = timestampFromDate(expires);
  claims.graceUntil = timestampFromDate(new Date(expires.getTime() + options.graceDays * DAY_MS));
  const limits = claims.entitlements?.limits;
  if (limits !== undefined) {
    limits.maxOrgs = options.maxOrgs;
  }
  return claims;
}
