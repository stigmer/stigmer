/**
 * The schema negatives: what `helm install` must REFUSE, and with which
 * words. DD-013's "explicit keys, loud fail" lives in docker-compose.yml's
 * `${VAR:?…}` interpolation, not in the server (which would auto-generate a
 * key into its home); the chart carries the same refusal itself, at render,
 * through `values.schema.json` and `required`. These tests pin that the
 * refusal exists and names the fix.
 *
 *   - no `secrets.existingSecret`: the .env.example sentence and the
 *     one-liner to create the Secret;
 *   - an Enterprise key turned on: the sentence naming P4's sp.helm-ee;
 *   - an unknown top-level key (a typo): refused, never silently ignored;
 *   - OIDC on without a runner token: the two-step sentence (F3);
 *   - Postgres disabled without an external host, Temporal likewise.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { helmTemplate } from "./helpers.mjs";

function expectRefusal(result, pattern, label) {
  assert.equal(result.ok, false, `${label}: helm template should have refused`);
  assert.match(
    result.stderr,
    pattern,
    `${label}: the refusal should name the fix`,
  );
}

test("a render without secrets.existingSecret is refused with the .env.example sentence", () => {
  const result = helmTemplate("bundled", { sets: ["secrets.existingSecret="] });
  expectRefusal(result, /secrets\.existingSecret/, "missing Secret");
  expectRefusal(result, /STIGMER_ENCRYPTION_KEY/, "missing Secret");
  expectRefusal(result, /openssl rand -base64 32/, "missing Secret");
});

test("the reserved Enterprise keys are refused when turned on, naming sp.helm-ee", () => {
  for (const key of ["openfga", "redis", "openbao"]) {
    const result = helmTemplate("bundled", { sets: [`${key}.enabled=true`] });
    expectRefusal(result, /Enterprise/, `${key}.enabled=true`);
  }
  const license = helmTemplate("bundled", {
    sets: ["licenseKeySecret=my-license"],
  });
  expectRefusal(license, /Enterprise/, "licenseKeySecret");
});

test("an unknown top-level values key is refused rather than ignored", () => {
  const result = helmTemplate("bundled", { sets: ["postgress.enabled=false"] });
  expectRefusal(result, /postgress|additional propert/i, "typo'd key");
});

test("a sandbox key is refused: the driver has no artifact path in open source (F2, stigmer#1099)", () => {
  const result = helmTemplate("bundled", {
    sets: ["sandbox.provisioner=kubernetes"],
  });
  assert.equal(result.ok, false);
});

test("OIDC on without a runner token is refused with the two-step sentence (F3)", () => {
  const result = helmTemplate("bundled", {
    sets: [
      "server.oidc.issuer=https://issuer.example.com",
      "server.oidc.audience=stigmer",
    ],
  });
  expectRefusal(
    result,
    /runner\.stigmerToken\.existingSecret/,
    "OIDC without a runner token",
  );
  expectRefusal(result, /API key/i, "OIDC without a runner token");
});

test("half an OIDC configuration is refused at render, before the server would refuse it at boot", () => {
  const result = helmTemplate("bundled", {
    sets: ["server.oidc.issuer=https://issuer.example.com"],
  });
  expectRefusal(result, /server\.oidc\.audience/, "issuer without audience");
});

test("postgres.enabled=false without externalDatabase.host is refused", () => {
  const result = helmTemplate("bundled", { sets: ["postgres.enabled=false"] });
  expectRefusal(result, /externalDatabase\.host/, "no database");
});

test("temporal.enabled=false without externalTemporal.hostPort is refused", () => {
  const result = helmTemplate("bundled", { sets: ["temporal.enabled=false"] });
  expectRefusal(result, /externalTemporal\.hostPort/, "no Temporal");
});

test("an Ingress without a host is refused", () => {
  const result = helmTemplate("bundled", { sets: ["ingress.enabled=true"] });
  expectRefusal(result, /ingress\.api\.host/, "ingress without host");
});
