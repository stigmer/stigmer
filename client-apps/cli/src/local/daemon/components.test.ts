import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { RUNNER_READY_MARKER, RUNNER_TASK_QUEUE } from "../constants.js";
import type { DaemonConfig } from "./env.js";
import { buildComponents, buildRunnerEnv, buildServerEnv } from "./components.js";

const config: DaemonConfig = {
  dataDir: "/home/u/.stigmer/data",
  logDir: "/home/u/.stigmer/data/logs",
  temporalManaged: true,
  temporalAddress: "127.0.0.1:7233",
  serverOnly: false,
  noWeb: false,
  server: { nodeBin: "/bin/node", entryPath: "/repo/server-ts/dist/main.js", appDir: "/repo/server-ts" },
  runner: { nodeBin: "/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
};

describe("buildServerEnv", () => {
  it("pins ports, queues, and db/storage paths under ~/.stigmer", () => {
    const env = buildServerEnv(config, {});
    expect(env.GRPC_PORT).toBe("7234");
    expect(env.TEMPORAL_HOST_PORT).toBe("127.0.0.1:7233");
    expect(env.TEMPORAL_NAMESPACE).toBe("default");
    expect(env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE).toBe(RUNNER_TASK_QUEUE);
    expect(env.TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE).toBe(RUNNER_TASK_QUEUE);
    expect(env.DB_PATH).toBe("/home/u/.stigmer/stigmer.db");
    expect(env.STORAGE_PATH).toBe("/home/u/.stigmer/storage");
  });

  it("forwards the operator identity only when set, resolved value winning over the base env (oss#796)", () => {
    const bare = buildServerEnv(config, {});
    expect(bare.STIGMER_OPERATOR_EMAIL).toBeUndefined();
    expect(bare.STIGMER_OPERATOR_NAME).toBeUndefined();

    // Contract value authoritative over a stale inherited export — the
    // ANTHROPIC_API_KEY precedent in buildRunnerEnv.
    const env = buildServerEnv(
      { ...config, operatorEmail: "ada@example.com", operatorName: "Ada" },
      { STIGMER_OPERATOR_EMAIL: "stale@example.com" },
    );
    expect(env.STIGMER_OPERATOR_EMAIL).toBe("ada@example.com");
    expect(env.STIGMER_OPERATOR_NAME).toBe("Ada");
  });

  it("does not deliver the operator identity to the runner — it resolves identity from session data", () => {
    const env = buildRunnerEnv({ ...config, operatorEmail: "ada@example.com" }, {});
    expect(env.STIGMER_OPERATOR_EMAIL).toBeUndefined();
  });
});

describe("buildRunnerEnv", () => {
  it("configures static mode with the workspace and pinned queue", () => {
    const env = buildRunnerEnv(config, {});
    expect(env.MODE).toBe("local");
    expect(env.STIGMER_RUNNER_MODE).toBeUndefined(); // static mode
    expect(env.STIGMER_BACKEND_ENDPOINT).toBe("http://localhost:7234");
    expect(env.TEMPORAL_SERVICE_ADDRESS).toBe("127.0.0.1:7233");
    expect(env.TEMPORAL_NAMESPACE).toBe("default");
    expect(env.WORKSPACE_ROOT_DIR).toBe("/home/u/.stigmer/data/workspace");
    expect(env.STIGMER_TASK_QUEUE).toBe(RUNNER_TASK_QUEUE);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("forwards CURSOR_API_KEY and activity routing only when set", () => {
    expect(buildRunnerEnv(config, {}).CURSOR_API_KEY).toBeUndefined();
    const withKey = buildRunnerEnv({ ...config, cursorApiKey: "ck", activityRouting: "session" }, {});
    expect(withKey.CURSOR_API_KEY).toBe("ck");
    expect(withKey.STIGMER_ACTIVITY_ROUTING).toBe("session");
  });

  it("forwards the Anthropic key only when set, resolved value winning over the base env", () => {
    const bare = buildRunnerEnv(config, {});
    expect(bare.ANTHROPIC_API_KEY).toBeUndefined();

    // The contract value is authoritative: the launcher already applied the
    // env > config precedence, so whatever sits in the child's base env must
    // not override the resolved key.
    const env = buildRunnerEnv(
      { ...config, anthropicApiKey: "sk-ant-resolved" },
      { ANTHROPIC_API_KEY: "sk-ant-other" },
    );
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-resolved");
  });

  // Anthropic is the only key with a contract slot; other provider keys (for
  // advanced per-agent overrides) flow through shell-env inheritance untouched.
  it("passes other shell-exported provider keys through via the base env spread", () => {
    const env = buildRunnerEnv(config, { OPENAI_API_KEY: "sk-oai-shell" });
    expect(env.OPENAI_API_KEY).toBe("sk-oai-shell");
  });

  // The regression guard for the queue bug: the server dispatches to, and the
  // runner polls, the exact same queue.
  it("pins the runner's poll queue to the server's dispatch queue", () => {
    const serverEnv = buildServerEnv(config, {});
    const runnerEnv = buildRunnerEnv(config, {});
    expect(runnerEnv.STIGMER_TASK_QUEUE).toBe(serverEnv.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE);
    expect(runnerEnv.STIGMER_TASK_QUEUE).toBe(serverEnv.TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE);
  });

  // #285 regression guard: the server's artifact base and the runner's artifact
  // path must be the SAME directory, or a storage-key attachment the server
  // wrote fails to resolve when the runner reads it back. Both must be defined
  // (a naive `runnerEnv.X === serverEnv.Y` would pass vacuously on
  // undefined === undefined) and equal to the ~/.stigmer/data/artifacts root.
  it("pins the runner's artifact path to the server's artifact base", () => {
    const serverEnv = buildServerEnv(config, {});
    const runnerEnv = buildRunnerEnv(config, {});
    const expected = join(config.dataDir, "artifacts");

    expect(serverEnv.ARTIFACT_LOCAL_BASE_PATH).toBe(expected);
    expect(runnerEnv.LOCAL_ARTIFACT_PATH).toBe(expected);
    expect(runnerEnv.LOCAL_ARTIFACT_PATH).toBe(serverEnv.ARTIFACT_LOCAL_BASE_PATH);
    expect(runnerEnv.ARTIFACT_STORAGE_TYPE).toBe("local");
    // Serve URL pinned to the server's artifact HTTP port (GRPC_PORT + 1).
    expect(runnerEnv.LOCAL_ARTIFACT_SERVE_URL).toBe("http://localhost:7235");
  });
});

describe("buildComponents", () => {
  it("orders server (critical, gated) before runner (marker, not critical)", () => {
    const components = buildComponents(config, {});
    expect(components.map((c) => c.name)).toEqual(["stigmer-server", "runner"]);

    const [server, runner] = components;
    expect(server.critical).toBe(true);
    expect(server.gate).toBeDefined();
    expect(server.resolve().readinessMarker).toBeUndefined();

    expect(runner.critical).toBe(false);
    expect(runner.gate).toBeUndefined();
    expect(runner.resolve().readinessMarker).toBe(RUNNER_READY_MARKER);
    expect(runner.resolve().args).toEqual(["/repo/runner/dist/main.js"]);
  });

  // The TS server child is `node <entry>` — the runner's launch shape.
  it("spawns the node-shape server as node + entry", () => {
    const [server] = buildComponents(config, {});
    const spawn = server.resolve();
    expect(spawn.command).toBe("/bin/node");
    expect(spawn.args).toEqual(["/repo/server-ts/dist/main.js"]);
  });

  it("omits the runner in server-only mode", () => {
    const components = buildComponents({ ...config, serverOnly: true }, {});
    expect(components.map((c) => c.name)).toEqual(["stigmer-server"]);
  });
});
