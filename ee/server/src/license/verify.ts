/**
 * The license verifier: reads a Stigmer Enterprise license key offline and
 * either trusts its claims or says, in an operator's words, why not.
 *
 * A key is a compact JWS (RFC 7515) the issuer writes:
 *   base64url({"alg":"EdDSA","typ":"JWT","kid":"<key id>"})
 *   . base64url(proto JSON of ai.stigmer.platform.v1.LicenseClaims)
 *   . base64url(Ed25519 signature over the ASCII of the first two joined by ".")
 *
 * The verifier accepts exactly that shape and nothing a general JOSE
 * library would also accept, because every extra freedom is a way to make
 * an unsigned key look signed:
 *   - three unpadded base64url segments in canonical form; padding, any
 *     other alphabet, or a segment that does not round-trip is refused;
 *   - a header with exactly the members `alg: "EdDSA"`, `typ: "JWT"` and a
 *     non-empty `kid`; a `crit`, a second algorithm or any other member is
 *     refused, so no header can ask for processing this code does not do;
 *   - the `kid` looked up in the trusted ring before any signature work, so
 *     a key naming an untrusted signer costs nothing to refuse;
 *   - a 64-byte signature verified with node:crypto against a key built
 *     from the ring's raw 32 bytes as an Ed25519 JWK (no hand-written DER
 *     prefix to get wrong);
 *   - only then the payload, read with the generated LicenseClaims schema
 *     with unknown fields refused, and checked by the contract's own
 *     protovalidate rules (required fields, `expires_at > issued_at`,
 *     `grace_until >= expires_at`).
 *
 * A refusal is typed by what went wrong (malformed, unknown-key,
 * bad-signature, bad-claims) and carries one sentence an operator can act
 * on. No sentence echoes the key or any part of it: the key is a
 * credential, and a boot error ends up in logs.
 *
 * The ring is a parameter so tests pass their own; the server passes the
 * compiled ring (trusted-keys.ts) and nothing else.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { createValidator, type Validator } from "@bufbuild/protovalidate";

import {
  LicenseClaimsSchema,
  type LicenseClaims,
} from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";

/** Why a key was refused. */
export type LicenseRefusalKind =
  | "malformed"
  | "unknown-key"
  | "bad-signature"
  | "bad-claims";

export interface LicenseRefusal {
  readonly kind: LicenseRefusalKind;
  /** One sentence for the operator; never contains the key or a part of it. */
  readonly message: string;
}

export type LicenseVerification =
  | { readonly ok: true; readonly keyId: string; readonly claims: LicenseClaims }
  | { readonly ok: false; readonly refusal: LicenseRefusal };

/** The only header a key may carry, member for member. */
const HEADER_ALG = "EdDSA";
const HEADER_TYP = "JWT";
const HEADER_MEMBERS: ReadonlyArray<string> = ["alg", "kid", "typ"];

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

const REFUSALS: Readonly<Record<LicenseRefusalKind, string>> = {
  malformed:
    "The Stigmer Enterprise license key is not in the form a license key takes; paste the whole key exactly as it was issued.",
  "unknown-key":
    "The Stigmer Enterprise license key was signed by a key this build of Stigmer Enterprise does not trust; check that the key was issued for this release.",
  "bad-signature":
    "The Stigmer Enterprise license key's signature does not match its contents; the key was altered after it was issued, or was not issued by Stigmer.",
  "bad-claims":
    "The Stigmer Enterprise license key is signed, but its license contents do not read; ask Stigmer for a new key.",
};

function refuse(kind: LicenseRefusalKind): LicenseVerification {
  return { ok: false, refusal: { kind, message: REFUSALS[kind] } };
}

let sharedValidator: Validator | undefined;

function validator(): Validator {
  if (sharedValidator === undefined) {
    sharedValidator = createValidator();
  }
  return sharedValidator;
}

/** Verifies `ticket` against the trusted `ring` (key id to raw Ed25519 public key). */
export function verifyLicenseTicket(
  ticket: string,
  ring: ReadonlyMap<string, Uint8Array>,
): LicenseVerification {
  const segments = ticket.split(".");
  if (segments.length !== 3) {
    return refuse("malformed");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments as [
    string,
    string,
    string,
  ];
  const header = decodeSegment(headerSegment);
  const payload = decodeSegment(payloadSegment);
  const signature = decodeSegment(signatureSegment);
  if (header === undefined || payload === undefined || signature === undefined) {
    return refuse("malformed");
  }
  const kid = keyIdOf(header);
  if (kid === undefined) {
    return refuse("malformed");
  }

  const rawKey = ring.get(kid);
  if (rawKey === undefined) {
    return refuse("unknown-key");
  }
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    return refuse("bad-signature");
  }
  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, "ascii");
  if (!verify(null, signingInput, publicKeyOf(kid, rawKey), signature)) {
    return refuse("bad-signature");
  }

  const claims = claimsOf(payload);
  if (claims === undefined) {
    return refuse("bad-claims");
  }
  return { ok: true, keyId: kid, claims };
}

/** A segment's bytes, or undefined when it is not canonical unpadded base64url. */
function decodeSegment(segment: string): Buffer | undefined {
  if (!BASE64URL_SEGMENT.test(segment)) {
    return undefined;
  }
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : undefined;
}

/** The header's `kid`, or undefined unless the header is exactly the one shape a key carries. */
function keyIdOf(header: Buffer): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(header.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const members = Object.keys(parsed).sort();
  if (
    members.length !== HEADER_MEMBERS.length ||
    members.some((member, index) => member !== HEADER_MEMBERS[index])
  ) {
    return undefined;
  }
  const { alg, typ, kid } = parsed as Record<string, unknown>;
  if (alg !== HEADER_ALG || typ !== HEADER_TYP || typeof kid !== "string" || kid === "") {
    return undefined;
  }
  return kid;
}

/** The ring's raw key as a node:crypto public key; a wrong-sized ring entry is a build defect. */
function publicKeyOf(kid: string, raw: Uint8Array): KeyObject {
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `the trusted license key '${kid}' is ${raw.length} bytes; an Ed25519 public key is ${ED25519_PUBLIC_KEY_BYTES}`,
    );
  }
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
}

/** The payload's claims, or undefined when they do not parse strictly or break the contract's rules. */
function claimsOf(payload: Buffer): LicenseClaims | undefined {
  let json: JsonValue;
  try {
    json = JSON.parse(payload.toString("utf8")) as JsonValue;
  } catch {
    return undefined;
  }
  let claims: LicenseClaims;
  try {
    claims = fromJson(LicenseClaimsSchema, json, { ignoreUnknownFields: false });
  } catch {
    return undefined;
  }
  return validator().validate(LicenseClaimsSchema, claims).kind === "valid"
    ? claims
    : undefined;
}
