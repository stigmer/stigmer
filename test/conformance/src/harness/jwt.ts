// RS256 compact JWS over node:crypto — the ONE signer the harness's issuers
// share. Domain: conformance harness.
//
// Two fixtures mint tokens a server under test must verify: the platform
// tenant's mint for the direct-login suite (direct-login-tenant.ts) and the
// hermetic local OIDC issuer (local-oidc-issuer.ts). Each owns its claim
// shape; neither owns the signature, which is the same bytes for both, so
// it lives here under a name that says what it is. jose is the OSS
// server's dependency, not the suite's — the package deliberately carries
// no JOSE library, so a token the suite mints is verified by code the
// suite did not write.
import { createSign } from "node:crypto";

export interface SignRs256JwtInput {
  // PKCS#8 PEM of the signing key.
  privateKeyPem: string;
  // The `kid` the token's header names; the issuer's JWKS must carry it.
  kid: string;
  claims: Record<string, unknown>;
}

export function signRs256Jwt(input: SignRs256JwtInput): string {
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
