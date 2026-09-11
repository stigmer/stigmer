/**
 * A complete, inert runner `Config` for tests.
 *
 * `Config` has twenty required fields (plus two optional token refs), so
 * every test that needs one has had to spell all of them out; eight test
 * files carry their own literal today. This is the one place a test-only `Config` is
 * built from now on: {@link testConfig} returns the whole record with values
 * that dial nothing (loopback endpoints on a port nothing listens on, no
 * proxy, no token, the in-memory checkpointer, a temp workspace root) and
 * takes a `Partial<Config>` for the fields a test cares about.
 *
 * Inert means: a component handed this config may READ every field, but a
 * component that tries to ACT on one (connect, authenticate, spawn) fails
 * loudly and immediately rather than reaching a real service. That is the
 * posture the harness contract kit needs for `HarnessAdapter.boot(config)`,
 * and the one the existing inline literals were reaching for one at a time.
 *
 * Not a `vi.mock`: `Config` is plain data, and a fixture that is plain data
 * stays type-checked against the real interface, so a field added to `Config`
 * fails here at `tsc` time instead of at the first test that needed it.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../config.js";
import {
  DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS,
  DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS,
  DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS,
} from "../config.js";

/**
 * Loopback on a port nothing listens on, so a component that dials it fails
 * fast with ECONNREFUSED instead of hanging on a route to nowhere.
 */
const INERT_ENDPOINT = "http://127.0.0.1:1";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    taskQueue: "test-task-queue",
    temporalAddress: "127.0.0.1:1",
    temporalNamespace: "default",
    stigmerBackendEndpoint: INERT_ENDPOINT,
    stigmerToken: null,
    mcpBridgeEndpoint: null,
    cursorApiKey: "",
    workspaceRootDir: join(tmpdir(), "stigmer-runner-test-workspaces"),
    mode: "local",
    proxyEndpoint: null,
    maxConcurrentActivities: 1,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    checkpointerType: "memory",
    checkpointerProxyEndpoint: null,
    artifactProxyEndpoint: null,
    primaryModel: "test-model",
    cursorStreamStallTimeoutMs: DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS,
    agentResolveTimeoutMs: DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS,
    workspaceLockTimeoutMs: DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS,
    ...overrides,
  };
}
