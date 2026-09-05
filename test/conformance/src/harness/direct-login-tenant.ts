// The platform identity tenant's MINT for the direct-login suite
// (stigmer-cloud#604, the S1 lane). Domain: conformance harness.
//
// The suite never forges the platform tenant's tokens from thin air: the
// readout substrate runs a mock tenant whose JWKS the server under test
// discovered at boot, and hands THIS process the private half of that key
// through CLOUD_ENV.directLogin* (base64 PKCS#8 PEM, the composition's
// `*_BASE64` custody pattern). What is minted is shaped exactly like what
// Auth0 issues a first-party client for an API audience: RS256 under the
// tenant's kid, `iss` exactly as published (trailing slash), `aud` in the
// ARRAY form beside the tenant's userinfo entry, `iat`/`exp`, `scope`,
// `azp`, `jti` — and NO profile claims (an access token, not an id token;
// the profile comes from /userinfo, which is why a first login has to call
// provisionMyAccount). Anything the suite wants to be WRONG about a token
// (a foreign audience, an expired lifetime) is a parameter here; a token
// signed by a stranger is minted by the suite with its own throwaway key
// and this module's shape helpers.
//
// node:crypto only — jose is the OSS server's dependency, not the suite's.
import { createSign, randomUUID } from "node:crypto";

import type { DirectLoginTenant } from "../targets/target";

import { CLOUD_ENV } from "./cloud-env";

// What a console session lives for; the suite's tokens are short by construction.
const DEFAULT_TTL_SECONDS = 5 * 60;

export interface DirectLoginTenantMaterial {
  readonly issuer: string;
  readonly signingKeyPem: string;
  readonly kid: string;
  readonly apiAudience: string;
  readonly mcpAudience: string | undefined;
}

// Reads the CLOUD_ENV.directLogin* group. Undefined when the issuer is unset
// (the environment does not own a tenant key); a PARTIAL group throws — a
// readout that set the issuer but forgot the key must not skip quietly.
export function readDirectLoginTenantMaterial(
  env: NodeJS.ProcessEnv = process.env,
): DirectLoginTenantMaterial | undefined {
  const issuer = env[CLOUD_ENV.directLoginIssuer] ?? "";
  if (issuer === "") {
    return undefined;
  }
  const required = (name: string): string => {
    const value = env[name] ?? "";
    if (value === "") {
      throw new Error(
        `${CLOUD_ENV.directLoginIssuer} is set but ${name} is not — the direct-login tenant group is all-or-nothing`,
      );
    }
    return value;
  };
  const signingKeyPem = Buffer.from(
    required(CLOUD_ENV.directLoginSigningKeyBase64),
    "base64",
  ).toString("utf8");
  if (!signingKeyPem.includes("-----BEGIN")) {
    throw new Error(
      `${CLOUD_ENV.directLoginSigningKeyBase64} does not decode to a PEM private key`,
    );
  }
  const mcpAudience = env[CLOUD_ENV.directLoginMcpAudience] ?? "";
  return {
    issuer,
    signingKeyPem,
    kid: required(CLOUD_ENV.directLoginKid),
    apiAudience: required(CLOUD_ENV.directLoginApiAudience),
    mcpAudience: mcpAudience === "" ? undefined : mcpAudience,
  };
}

export function newDirectLoginTenant(
  material: DirectLoginTenantMaterial,
): DirectLoginTenant {
  return {
    issuer: material.issuer,
    apiAudience: material.apiAudience,
    mcpAudience: material.mcpAudience,
    mint(input) {
      return signDirectLoginToken({
        privateKeyPem: material.signingKeyPem,
        kid: material.kid,
        claims: directLoginClaims({
          issuer: material.issuer,
          subject: input.subject,
          audience: input.audience ?? [
            material.apiAudience,
            `${material.issuer}userinfo`,
          ],
          ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        }),
      });
    },
  };
}

// The claim set Auth0 mints for a first-party client — exported so the suite's
// stranger-signed arm carries the same shape and fails for the signature alone.
export function directLoginClaims(input: {
  issuer: string;
  subject: string;
  audience: string | ReadonlyArray<string>;
  ttlSeconds: number;
}): Record<string, unknown> {
  const iat = Math.floor(Date.now() / 1000);
  return {
    iss: input.issuer,
    sub: input.subject,
    aud:
      typeof input.audience === "string" ? input.audience : [...input.audience],
    iat,
    exp: iat + input.ttlSeconds,
    scope: "openid profile email offline_access",
    azp: "conformance-first-party-client",
    jti: randomUUID(),
  };
}

// RS256 compact JWS over node:crypto.
export function signDirectLoginToken(input: {
  privateKeyPem: string;
  kid: string;
  claims: Record<string, unknown>;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: input.kid }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(input.claims)).toString(
    "base64url",
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(input.privateKeyPem).toString("base64url")}`;
}
