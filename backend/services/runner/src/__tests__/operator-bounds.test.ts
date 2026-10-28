/**
 * The operator's bounds reach the runtime `Config` on both boot paths
 * (stigmer#1731): `loadConfig` reads their variables, `main.ts` spreads
 * `operatorBounds(config)` into each root's options, and each root's mapper
 * carries them into the `Config` its turns read. Before this, both option
 * lists left the bounds out and the defaults always applied.
 *
 * `main.ts` is a process entry with side effects on import, so its half is
 * read off its source: one spread per boot path, in the function that
 * builds that path's root.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, type TokenRef } from "../config.js";
import { operatorBounds } from "../operator-bounds.js";
import { mapOptionsToConfig } from "../runner.js";
import { mapManagerOptionsToConfig } from "../runner-manager.js";

const MAIN_SOURCE = readFileSync(fileURLToPath(new URL("../main.ts", import.meta.url)), "utf8");

const SET = {
  CURSOR_STREAM_STALL_TIMEOUT_MS: "90000",
  STIGMER_OPEN_OPERATION_MAX_MS: "1200000",
  STIGMER_LIVENESS_INTERVAL_MS: "45000",
  STIGMER_SHELL_TIMEOUT_MAX_SECONDS: "900",
  STIGMER_SHELL_BACKGROUND_ENABLED: "false",
  WORKSPACE_LOCK_TIMEOUT_MS: "60000",
};

const EXPECTED = {
  cursorStreamStallTimeoutMs: 90_000,
  openOperationMaxMs: 1_200_000,
  livenessIntervalMs: 45_000,
  shellTimeoutMaxSeconds: 900,
  shellBackgroundEnabled: false,
  workspaceLockTimeoutMs: 60_000,
};

const refs = (): [TokenRef, TokenRef] => [{ current: null }, { current: null }];

/** The body of `main.ts`'s function `name`, up to the next top-level function. */
function bodyOf(name: string): string {
  const start = MAIN_SOURCE.indexOf(`async function ${name}(`);
  expect(start, `main.ts declares ${name}`).toBeGreaterThanOrEqual(0);
  const next = MAIN_SOURCE.slice(start + 1).search(/\n(async )?function /);
  return next === -1 ? MAIN_SOURCE.slice(start) : MAIN_SOURCE.slice(start, start + 1 + next);
}

describe("the operator's bounds on both boot paths", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { HOME: originalEnv.HOME, PATH: originalEnv.PATH, WORKSPACE_ROOT_DIR: "/tmp/test-workspace", ...SET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads every one from the environment", () => {
    expect(operatorBounds(loadConfig())).toEqual(EXPECTED);
  });

  it("static mode: main.ts spreads them into the runner's options, and the runner's Config carries them", () => {
    expect(bodyOf("runStaticMode")).toContain("...operatorBounds(config)");
    const config = mapOptionsToConfig(
      { taskQueue: "q", temporalAddress: "localhost:7233", stigmerEndpoint: "http://localhost:7234", ...operatorBounds(loadConfig()) },
      ...refs(),
    );
    expect(operatorBounds(config)).toEqual(EXPECTED);
  });

  it("manager mode: main.ts spreads them into the manager's options, and the manager's Config carries them", () => {
    expect(bodyOf("runManagerMode")).toContain("...operatorBounds(config)");
    const config = mapManagerOptionsToConfig(
      { temporalAddress: "localhost:7233", stigmerEndpoint: "http://localhost:7234", ...operatorBounds(loadConfig()) },
      ...refs(),
    );
    expect(operatorBounds(config)).toEqual(EXPECTED);
  });
});
