// Pins what the compose driver writes for a stack: the env file keeps the
// same keys across an upgrade and carries STIGMER_VERSION only for a
// published release (a source build carries the staged CLI's version
// instead); the override maps host.docker.internal into the runner, and
// hands it ANTHROPIC_BASE_URL only when the compose file does not pass it
// through (a release from before that line); and `docker compose ps --format
// json` is read in both of the shapes compose has printed. Run via
// `npm run test:scripts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { composeEnvText, composeOverrideText, serviceImages } from "./install-compose.mjs";

const KEYS = { postgresPassword: "pw", encryptionKey: "ek", runnerTokenKey: "rk" };
const MODEL = { ANTHROPIC_API_KEY: "sk-fake", ANTHROPIC_BASE_URL: "http://host.docker.internal:4000" };

test("a published release's env file sets STIGMER_VERSION with the tag's v, and the model", () => {
  assert.equal(
    composeEnvText({ keys: KEYS, release: { kind: "published", version: "3.41.0" }, runnerCliVersion: "", model: MODEL }),
    [
      "POSTGRES_PASSWORD=pw",
      "STIGMER_ENCRYPTION_KEY=ek",
      "STIGMER_RUNNER_TOKEN_KEY=rk",
      "STIGMER_VERSION=v3.41.0",
      "ANTHROPIC_API_KEY=sk-fake",
      "ANTHROPIC_BASE_URL=http://host.docker.internal:4000",
      "",
    ].join("\n"),
  );
});

test("a source build's env file carries the staged CLI version and no STIGMER_VERSION, with the same keys", () => {
  const text = composeEnvText({ keys: KEYS, release: { kind: "build" }, runnerCliVersion: "0.0.0-dev.abc1234", model: MODEL });
  assert.match(text, /^POSTGRES_PASSWORD=pw\nSTIGMER_ENCRYPTION_KEY=ek\nSTIGMER_RUNNER_TOKEN_KEY=rk\n/);
  assert.match(text, /\nSTIGMER_CLI_VERSION=0\.0\.0-dev\.abc1234\n/);
  assert.doesNotMatch(text, /STIGMER_VERSION=/);
});

test("the override maps the host gateway, and adds the base URL only for a compose file without it", () => {
  const withLine = composeOverrideText("services:\n  stigmer-runner:\n    environment:\n      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL:-}\n", MODEL);
  assert.equal(
    withLine,
    'services:\n  stigmer-runner:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n',
  );
  const withoutLine = composeOverrideText("services:\n  stigmer-runner:\n    environment:\n      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}\n", MODEL);
  assert.equal(
    withoutLine,
    'services:\n  stigmer-runner:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n' +
      '    environment:\n      ANTHROPIC_BASE_URL: "http://host.docker.internal:4000"\n',
  );
});

test("docker compose ps --format json is read as one object per line and as one array", () => {
  const rows = [
    { Service: "stigmer-server", Image: "ghcr.io/stigmer/stigmer-server:v3.41.0" },
    { Service: "postgres", Image: "postgres:16" },
  ];
  const want = { "stigmer-server": "ghcr.io/stigmer/stigmer-server:v3.41.0", postgres: "postgres:16" };
  assert.deepEqual(serviceImages(rows.map((row) => JSON.stringify(row)).join("\n")), want);
  assert.deepEqual(serviceImages(JSON.stringify(rows)), want);
  assert.deepEqual(serviceImages(""), {});
});
