/**
 * The schema negatives: what `helm install` must REFUSE, and with which
 * words. Compose's "explicit keys, loud fail" lives in docker-compose.yml's
 * `${VAR:?…}` interpolation, not in the server (which would auto-generate a
 * key into its home); the chart carries the same refusal itself, at render,
 * through `values.schema.json` and `required`. These tests pin that the
 * refusal exists and names the fix.
 *
 *   - no `secrets.existingSecret`: the .env.example sentence and the
 *     one-liner to create the Secret;
 *   - an Enterprise key turned on: the sentence saying it is reserved for
 *     Stigmer Enterprise and what to leave it at;
 *   - an unknown top-level key (a typo): refused, never silently ignored;
 *   - Postgres disabled without an external host, Temporal likewise;
 *   - Temporal authentication against the bundled Temporal, TLS keys without
 *     TLS or without their Secret, half a mutual-TLS pair, and a server name
 *     when nothing asks for TLS;
 *   - an install reachable from outside the cluster (an Ingress, a NodePort
 *     or LoadBalancer Service, a public URL off loopback) while sign-in is
 *     off, unless server.allowUnauthenticatedExposure states it on purpose;
 *   - an issuer that is not https;
 *   - a misspelled securityContext field;
 *   - an extraEnv entry that repeats a name the chart sets.
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

test("the reserved Enterprise keys are refused when turned on", () => {
  for (const key of ["openfga", "redis", "openbao"]) {
    const result = helmTemplate("bundled", { sets: [`${key}.enabled=true`] });
    expectRefusal(result, /reserved for Stigmer Enterprise.*leave openfga\/redis\/openbao at enabled: false/s, `${key}.enabled=true`);
  }
  const license = helmTemplate("bundled", {
    sets: ["licenseKeySecret=my-license"],
  });
  expectRefusal(license, /reserved for Stigmer Enterprise.*licenseKeySecret empty/s, "licenseKeySecret");
});

test("an unknown top-level values key is refused rather than ignored", () => {
  const result = helmTemplate("bundled", { sets: ["postgress.enabled=false"] });
  expectRefusal(result, /postgress|additional propert/i, "typo'd key");
});

test("a sandbox key is refused: the driver has no artifact path in open source (stigmer#1099)", () => {
  const result = helmTemplate("bundled", {
    sets: ["sandbox.provisioner=agent-sandbox"],
  });
  assert.equal(result.ok, false);
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

test("Temporal authentication is refused against the bundled Temporal", () => {
  for (const set of ["externalTemporal.tls.enabled=true", "externalTemporal.apiKey.existingSecret=k"]) {
    const result = helmTemplate("bundled", { sets: [set] });
    expectRefusal(result, /the bundled Temporal speaks neither/, set);
  }
});

test("TLS keys without TLS, or without their Secret, are refused", () => {
  expectRefusal(
    helmTemplate("byo", { sets: ["externalTemporal.tls.caKey=ca.crt", "externalTemporal.tls.existingSecret=s"] }),
    /externalTemporal\.tls\.enabled is false/,
    "keys without TLS",
  );
  expectRefusal(
    helmTemplate("byo", { sets: ["externalTemporal.tls.enabled=true", "externalTemporal.tls.caKey=ca.crt"] }),
    /names keys but not their Secret/,
    "keys without a Secret",
  );
});

test("half a mutual-TLS pair is refused", () => {
  const result = helmTemplate("byo", {
    sets: [
      "externalTemporal.tls.enabled=true",
      "externalTemporal.tls.existingSecret=s",
      "externalTemporal.tls.certKey=tls.crt",
    ],
  });
  expectRefusal(result, /certKey and keyKey go together/, "cert without key");
});

test("an Ingress without a host is refused", () => {
  const result = helmTemplate("bundled", { sets: ["ingress.enabled=true"] });
  expectRefusal(result, /ingress\.api\.host/, "ingress without host");
});

test("a server name with neither TLS nor an API key is refused", () => {
  expectRefusal(
    helmTemplate("byo", { sets: ["externalTemporal.tls.serverName=temporal.internal"] }),
    /externalTemporal\.tls\.serverName is set, but nothing asks for TLS/,
    "server name alone",
  );
});

const EXPOSURE_FIX = /sign-in off.*server\.oidc\.issuer.*server\.allowUnauthenticatedExposure=true/s;

test("an install reachable from outside the cluster is refused while sign-in is off, naming each exposure", () => {
  const cases = [
    [
      ["ingress.enabled=true", "ingress.api.host=stigmer.example.com", "ingress.artifacts.host=artifacts.example.com"],
      /ingress\.enabled is true/,
    ],
    [["service.type=NodePort"], /service\.type is NodePort/],
    [["service.type=LoadBalancer"], /service\.type is LoadBalancer/],
    [["server.publicUrl=https://stigmer.example.com"], /server\.publicUrl names https:\/\/stigmer\.example\.com/],
    [["server.artifactPublicUrl=http://10.0.0.7:7235"], /server\.artifactPublicUrl names http:\/\/10\.0\.0\.7:7235/],
  ];
  for (const [sets, named] of cases) {
    const result = helmTemplate("bundled", { sets });
    expectRefusal(result, EXPOSURE_FIX, sets.join(" "));
    expectRefusal(result, named, sets.join(" "));
  }
});

test("loopback public URLs, a stated exposure, or sign-in let an install render", () => {
  for (const sets of [
    ["server.publicUrl=http://localhost:7234", "server.artifactPublicUrl=http://127.0.0.1:7235"],
    ["server.publicUrl=http://[::1]:7234"],
    ["service.type=LoadBalancer", "server.allowUnauthenticatedExposure=true"],
    [
      "ingress.enabled=true",
      "ingress.api.host=stigmer.example.com",
      "ingress.artifacts.host=artifacts.example.com",
      "server.oidc.issuer=https://issuer.example.com",
      "server.oidc.audience=https://stigmer.example.com",
    ],
  ]) {
    const result = helmTemplate("bundled", { sets });
    assert.equal(result.ok, true, `${sets.join(" ")}: ${result.stderr}`);
  }
});

test("an issuer that is not https is refused by the schema", () => {
  const result = helmTemplate("bundled", {
    sets: ["server.oidc.issuer=http://issuer.example.com", "server.oidc.audience=https://stigmer.example.com"],
  });
  expectRefusal(result, /server\.oidc\.issuer|issuer.*pattern|does not match pattern/is, "http issuer");
});

test("a misspelled securityContext field is refused on every container that takes one", () => {
  for (const key of [
    "server.securityContext",
    "runner.securityContext",
    "postgres.securityContext",
    "temporal.securityContext",
    "waitForDependencies.securityContext",
  ]) {
    const result = helmTemplate("bundled", { sets: [`${key}.runAsUsr=1000`] });
    expectRefusal(result, /runAsUsr|additional propert/i, key);
  }
});

test("an extraEnv entry that repeats a name the chart sets is refused, for the server and the runner", () => {
  expectRefusal(
    helmTemplate("ingress-oidc", {
      sets: ["server.extraEnv[0].name=STIGMER_OIDC_ISSUER", "server.extraEnv[0].value="],
    }),
    /server\.extraEnv sets STIGMER_OIDC_ISSUER, a name the chart sets itself/,
    "server repeat",
  );
  expectRefusal(
    helmTemplate("bundled", {
      sets: ["runner.extraEnv[0].name=LOCAL_ARTIFACT_PATH", "runner.extraEnv[0].value=/tmp"],
    }),
    /runner\.extraEnv sets LOCAL_ARTIFACT_PATH, a name the chart sets itself/,
    "runner repeat",
  );
  const unowned = helmTemplate("bundled", {
    sets: ["server.extraEnv[0].name=LOG_LEVEL", "server.extraEnv[0].value=debug"],
  });
  assert.equal(unowned.ok, true, unowned.stderr);
});
