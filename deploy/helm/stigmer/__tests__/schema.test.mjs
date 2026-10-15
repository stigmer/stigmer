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
 *   - a retired reserved key turned on: the sentence saying no edition uses
 *     it, or, for the old license value, where the license goes now;
 *   - an Enterprise setting with no license, which the server would never
 *     read; a license with sign-in off, which the server refuses at boot;
 *     allowedCidrs with no fence to open;
 *   - under a license, a bundled dependency's fence turned off, or an
 *     external Temporal that authenticates nothing;
 *   - an Enterprise setting of the wrong shape: an account id that is not
 *     one, a retention under a day, an egress posture that is neither;
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
 *   - an extraEnv entry that repeats a name the chart sets, or sets an
 *     Enterprise name the chart renders from its enterprise values, on
 *     every edition.
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

test("the retired reserved keys are refused when turned on, each naming what replaced it", () => {
  for (const key of ["openfga", "redis", "openbao"]) {
    const result = helmTemplate("bundled", { sets: [`${key}.enabled=true`] });
    expectRefusal(result, new RegExp(`${key}\\.enabled is retired: no Stigmer edition runs`), `${key}.enabled=true`);
    expectRefusal(result, /remove it from your values/, `${key}.enabled=true`);
  }
  const license = helmTemplate("bundled", { sets: ["licenseKeySecret=my-license"] });
  expectRefusal(license, /licenseKeySecret is retired.*enterprise\.license\.existingSecret=my-license/s, "licenseKeySecret");
});

test("an Enterprise setting with no license is refused: the open-source server never reads it", () => {
  for (const set of [
    "enterprise.organizationCreators={ida_01jq3v8k6m2n4p5r7s9t0v1w2x}",
    "enterprise.accessHistoryRetentionDays=30",
    "enterprise.outboundEgress=relaxed",
  ]) {
    const result = helmTemplate("bundled", { sets: [set] });
    expectRefusal(result, /but enterprise\.license\.existingSecret is empty/, set);
    expectRefusal(result, /never reads/, set);
  }
});

test("a license with sign-in off is refused, before the server would refuse it at boot", () => {
  const result = helmTemplate("bundled", { sets: ["enterprise.license.existingSecret=stigmer-license"] });
  expectRefusal(result, /Stigmer Enterprise signs every caller in.*server\.oidc\.issuer/s, "license without issuer");
});

test("allowedCidrs with no fence to open is refused", () => {
  const result = helmTemplate("bundled", { sets: ["egressPolicy.allowedCidrs={10.0.0.0/8}"] });
  expectRefusal(result, /egressPolicy\.allowedCidrs is set, but no fence renders/, "allowedCidrs alone");
  const relaxed = helmTemplate("enterprise", {
    sets: ["enterprise.outboundEgress=relaxed", "egressPolicy.allowedCidrs={10.0.0.0/8}"],
  });
  expectRefusal(relaxed, /egressPolicy\.allowedCidrs is set, but no fence renders/, "a relaxed license");
  assert.equal(helmTemplate("enterprise", { sets: ["egressPolicy.allowedCidrs={10.0.0.0/8}"] }).ok, true);
});

const ENTERPRISE_BYO = ["postgres.enabled=false", "externalDatabase.host=db.internal"];

test("under a license the bundled dependencies stay fenced and an external Temporal authenticates", () => {
  for (const component of ["postgres", "temporal"]) {
    const result = helmTemplate("enterprise", { sets: [`${component}.networkPolicy.enabled=false`] });
    expectRefusal(result, new RegExp(`${component}\\.networkPolicy\\.enabled is false under a Stigmer Enterprise license`), component);
  }
  const external = [
    ...ENTERPRISE_BYO,
    "temporal.enabled=false",
    "externalTemporal.hostPort=temporal.internal:7233",
  ];
  expectRefusal(
    helmTemplate("enterprise", { sets: external }),
    /an external Temporal that authenticates nothing/,
    "plaintext external Temporal",
  );
  for (const auth of [["externalTemporal.tls.enabled=true"], ["externalTemporal.apiKey.existingSecret=temporal-api-key"]]) {
    const result = helmTemplate("enterprise", { sets: [...external, ...auth] });
    assert.equal(result.ok, true, `${auth}: ${result.stderr}`);
  }
  // Open source keeps the operator's choice.
  assert.equal(helmTemplate("bundled", { sets: ["temporal.networkPolicy.enabled=false"] }).ok, true);
});

test("an Enterprise setting of the wrong shape is refused by the schema", () => {
  for (const [set, pattern] of [
    ["enterprise.organizationCreators={alice@example.com}", /organizationCreators|does not match pattern/i],
    ["enterprise.organizationCreators={ida_01JQ3V8K6M2N4P5R7S9T0V1W2X}", /organizationCreators|does not match pattern/i],
    ["enterprise.accessHistoryRetentionDays=0", /accessHistoryRetentionDays|minimum/i],
    ["enterprise.accessHistoryRetentionDays=1.5", /accessHistoryRetentionDays|integer/i],
    ["enterprise.outboundEgress=open", /outboundEgress|must be one of/i],
    ["egressPolicy.allowedCidrs={db.internal}", /allowedCidrs|does not match pattern/i],
    ["egressPolicy.allowedCidrs={10.0.0.7}", /allowedCidrs|does not match pattern/i],
  ]) {
    expectRefusal(helmTemplate("enterprise", { sets: [set] }), pattern, set);
  }
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

test("an external Temporal address that is not host:port is refused at render", () => {
  for (const hostPort of ["temporal.internal", "fd00::1:7233", "temporal.internal:", "temporal.internal:port"]) {
    const result = helmTemplate("byo", { sets: [`externalTemporal.hostPort=${hostPort}`] });
    expectRefusal(result, /externalTemporal\.hostPort .* is not host:port/, hostPort);
  }
  for (const hostPort of ["temporal.internal:7233", "[fd00::1]:7233", "10.0.0.5:7233"]) {
    assert.equal(helmTemplate("byo", { sets: [`externalTemporal.hostPort=${hostPort}`] }).ok, true, hostPort);
  }
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
  for (const profile of ["bundled", "enterprise"]) {
    expectRefusal(
      helmTemplate(profile, {
        sets: ["server.extraEnv[0].name=STIGMER_LICENSE_KEY", "server.extraEnv[0].value=key"],
      }),
      /server\.extraEnv sets STIGMER_LICENSE_KEY, a Stigmer Enterprise setting.*enterprise\.license\.existingSecret/s,
      `${profile}: the license key smuggled`,
    );
  }
  expectRefusal(
    helmTemplate("bundled", {
      sets: ["server.extraEnv[0].name=STIGMER_ORGANIZATION_CREATORS", "server.extraEnv[0].value=anyone"],
    }),
    /server\.extraEnv sets STIGMER_ORGANIZATION_CREATORS, a Stigmer Enterprise setting/,
    "a setting smuggled",
  );
  expectRefusal(
    helmTemplate("enterprise", {
      sets: ["runner.extraEnv[0].name=STIGMER_WEB_FETCH_ALLOW_PRIVATE", "runner.extraEnv[0].value=true"],
    }),
    /runner\.extraEnv sets STIGMER_WEB_FETCH_ALLOW_PRIVATE, a name the chart sets itself/,
    "the fence's fetch guard undone",
  );
  const unowned = helmTemplate("bundled", {
    sets: ["server.extraEnv[0].name=LOG_LEVEL", "server.extraEnv[0].value=debug"],
  });
  assert.equal(unowned.ok, true, unowned.stderr);
});
