/**
 * The compose-parity test: the chart is `docker-compose.yml` translated, and
 * this file is where that sentence stops being a sentence. For the server and
 * the runner, the rendered container's env must equal the compose service's
 * env, name for name, under one explicit rule set:
 *
 *   - a compose value written `${X:?…}` (a required input) is a secretKeyRef
 *     with key X in the chart;
 *   - a compose value written `${X:-}` (an optional input) may be absent in a
 *     profile that names no Secret for it, or a secretKeyRef, or a value;
 *   - a compose value written `${X:-default}` (an optional input with a
 *     default) equals the chart's after the address table, the default
 *     standing in for the unset input, so a `.env` line and a chart value
 *     are two spellings of one setting;
 *   - a plain compose value equals the chart's after the address table for
 *     the profile (one host became one pod; the artifact path moved out of
 *     `/data`, F11; a bring-your-own profile names its own addresses; the
 *     public URLs follow the Ingress hosts when there are any);
 *   - the chart may add exactly the names listed in CHART_ONLY (the
 *     `$(POSTGRES_PASSWORD)` expansion source) and, per profile, the names the
 *     profile's own values introduce beyond compose (none today: compose
 *     carries OIDC and the runner token as optional inputs).
 *
 * A variable added to compose without the chart, or the reverse, is red here.
 * The compose file stays the canonical statement; this test makes it binding.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import {
  containerNamed,
  envMap,
  findOne,
  profileValuesPath,
  readCompose,
  RELEASE,
  renderProfile,
} from "./helpers.mjs";

const REQUIRED = /^\$\{([A-Z_]+):\?/;
const OPTIONAL = /^\$\{([A-Z_]+):-\}$/;
// Checked after OPTIONAL, so the empty default never reaches it.
const DEFAULTED = /^\$\{([A-Z_]+):-(.+)\}$/;
const EMBEDDED = /\$\{([A-Z_]+):\?[^}]*\}/g;

/**
 * The default of a `${X:-default}` compose value, read from the file rather
 * than restated here: where the address table says "compose's default", it
 * must mean the literal compose carries, or two copies of one URL would
 * agree by luck, the drift this test exists to catch.
 */
function composeDefault(composeValue) {
  const defaulted = String(composeValue).match(DEFAULTED);
  assert.ok(
    defaulted,
    `expected a \${X:-default} compose value, got ${composeValue}`,
  );
  return defaulted[2];
}

/**
 * Compose addresses and paths, and what they become for a profile: the
 * bundled dependencies take the release's Service names; a bring-your-own
 * profile takes the addresses its values name; the two public URLs follow
 * the Ingress hosts when there are any, and stay compose's own defaults
 * (the port-forward posture) when there are none.
 */
function addressTable(profile) {
  const values = parse(readFileSync(profileValuesPath(profile), "utf8")) ?? {};
  const compose = readCompose();
  const dbHost = values.externalDatabase?.host ?? `${RELEASE}-postgres`;
  const dbPort = values.externalDatabase?.port ?? 5432;
  const temporal =
    values.externalTemporal?.hostPort ?? `${RELEASE}-temporal:7233`;
  const scheme = (entry) => (entry?.tlsSecretName ? "https" : "http");
  const publicUrl =
    values.server?.publicUrl ??
    (values.ingress?.enabled
      ? `${scheme(values.ingress.api)}://${values.ingress.api.host}`
      : composeDefault(
          compose.services["stigmer-server"].environment
            .SKILL_TRANSFER_BASE_URL,
        ));
  const artifactPublicUrl =
    values.server?.artifactPublicUrl ??
    (values.ingress?.enabled
      ? `${scheme(values.ingress.artifacts)}://${values.ingress.artifacts.host}`
      : composeDefault(compose["x-artifact-serve-url"]));
  return {
    strings: new Map([
      ["postgres:5432", `${dbHost}:${dbPort}`],
      ["temporal:7233", temporal],
      ["http://stigmer-server:7234", "http://localhost:7234"],
      ["/data/.stigmer/data/artifacts", "/artifacts"],
    ]),
    byName: new Map([
      ["SKILL_TRANSFER_BASE_URL", publicUrl],
      ["ARTIFACT_LOCAL_SERVE_URL", artifactPublicUrl],
      ["LOCAL_ARTIFACT_SERVE_URL", artifactPublicUrl],
    ]),
  };
}

/** Names the chart carries that compose does not, and why. */
const CHART_ONLY = {
  server: new Set(["POSTGRES_PASSWORD"]), // the $(POSTGRES_PASSWORD) expansion source for DATABASE_URL
  runner: new Set(),
};

/**
 * Names a profile's own values introduce, beyond compose. Empty for every
 * profile today; the shape stays so the next chart-only value has a place
 * to be declared and explained rather than a rule to be bent.
 */
const PROFILE_EXTRAS = {
  bundled: { server: new Set(), runner: new Set() },
  byo: { server: new Set(), runner: new Set() },
  "ingress-oidc": { server: new Set(), runner: new Set() },
};

function translate(table, name, composeValue) {
  if (table.byName.has(name)) {
    return table.byName.get(name);
  }
  let value = String(composeValue).replace(EMBEDDED, (_, key) => `$(${key})`);
  for (const [from, to] of table.strings) {
    value = value.split(from).join(to);
  }
  return value;
}

function assertParity(profile, composeService, chartContainer, role) {
  const compose = readCompose().services[composeService].environment;
  const table = addressTable(profile);
  const docs = renderProfile(profile);
  const pod = findOne(docs, "Deployment", RELEASE).spec.template.spec;
  const chart = envMap(containerNamed(pod, chartContainer));

  const allowedExtra = new Set([
    ...CHART_ONLY[role],
    ...PROFILE_EXTRAS[profile][role],
  ]);
  for (const name of chart.keys()) {
    assert.ok(
      name in compose || allowedExtra.has(name),
      `${role}: the chart sets ${name}, which docker-compose.yml does not set and no rule allows`,
    );
  }

  for (const [name, composeValue] of Object.entries(compose)) {
    const entry = chart.get(name);
    const raw = String(composeValue);
    const required = raw.match(REQUIRED);
    const optional = raw.match(OPTIONAL);
    if (required) {
      assert.ok(
        entry,
        `${role}: ${name} is a required compose input and must be set by the chart`,
      );
      assert.equal(
        entry.valueFrom?.secretKeyRef?.key,
        required[1],
        `${role}: ${name} must come from a Secret key named ${required[1]}`,
      );
      continue;
    }
    if (optional) {
      if (entry !== undefined) {
        assert.ok(
          entry.valueFrom?.secretKeyRef || typeof entry.value === "string",
          `${role}: ${name} must be a Secret reference or a value`,
        );
      }
      continue;
    }
    const defaulted = raw.match(DEFAULTED);
    const composeLiteral = defaulted ? defaulted[2] : raw;
    assert.ok(entry, `${role}: compose sets ${name}; the chart does not`);
    assert.equal(
      entry.value,
      translate(table, name, composeLiteral),
      `${role}: ${name} differs from docker-compose.yml after the address table`,
    );
  }

  for (const name of PROFILE_EXTRAS[profile][role]) {
    assert.ok(
      chart.has(name),
      `${role}: profile '${profile}' should set ${name}`,
    );
  }
}

for (const profile of ["bundled", "byo", "ingress-oidc"]) {
  test(`server env equals docker-compose.yml's stigmer-server env (${profile})`, () => {
    assertParity(profile, "stigmer-server", "server", "server");
  });
  test(`runner env equals docker-compose.yml's stigmer-runner env (${profile})`, () => {
    assertParity(profile, "stigmer-runner", "runner", "runner");
  });
}

test("the runner task queue is one value on both sides, as compose anchors it", () => {
  const compose = readCompose();
  const anchored =
    compose.services["stigmer-runner"].environment.STIGMER_TASK_QUEUE;
  const docs = renderProfile("bundled");
  const pod = findOne(docs, "Deployment", RELEASE).spec.template.spec;
  const server = envMap(containerNamed(pod, "server"));
  const runner = envMap(containerNamed(pod, "runner"));
  assert.equal(runner.get("STIGMER_TASK_QUEUE")?.value, anchored);
  assert.equal(
    server.get("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE")?.value,
    anchored,
  );
  assert.equal(
    server.get("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE")?.value,
    anchored,
  );
});

test("the artifact root is the same path in both containers and is not nested under /data (F11)", () => {
  const docs = renderProfile("bundled");
  const pod = findOne(docs, "Deployment", RELEASE).spec.template.spec;
  const server = envMap(containerNamed(pod, "server"));
  const runner = envMap(containerNamed(pod, "runner"));
  const serverRoot = server.get("ARTIFACT_LOCAL_BASE_PATH")?.value;
  const runnerRoot = runner.get("LOCAL_ARTIFACT_PATH")?.value;
  assert.equal(
    serverRoot,
    runnerRoot,
    "the runner must read where the server writes (stigmer#285)",
  );
  assert.equal(serverRoot, "/artifacts");
});
