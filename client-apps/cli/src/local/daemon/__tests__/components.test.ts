import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { RUNNER_READY_MARKER, RUNNER_TASK_QUEUE } from "../../constants.js";
import type { DaemonConfig } from "../env.js";
import { buildComponents, buildRunnerEnv, buildServerEnv, localRunnerReach } from "../components.js";
import { GRACEFUL_STOP_TIMEOUT_MS } from "../supervisor.js";

const config: DaemonConfig = {
  dataDir: "/home/u/.stigmer/data",
  logDir: "/home/u/.stigmer/data/logs",
  temporalManaged: true,
  temporalAddress: "127.0.0.1:7233",
  serverOnly: false,
  noWeb: false,
  server: { nodeBin: "/bin/node", entryPath: "/repo/server/dist/main.js", appDir: "/repo/server" },
  runner: { nodeBin: "/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
};

describe("buildServerEnv", () => {
  it("pins ports, queues, and db/storage paths under ~/.stigmer", () => {
    const env = buildServerEnv(config, {});
    expect(env.GRPC_PORT).toBe("7234");
    expect(env.TEMPORAL_HOST_PORT).toBe("127.0.0.1:7233");
    expect(env.TEMPORAL_NAMESPACE).toBe("default");
    expect(env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE).toBe(RUNNER_TASK_QUEUE);
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
  it("keeps the runner's drain grace under the supervisor's stop bound, whatever the shell exported", () => {
    const env = buildRunnerEnv(config, { STIGMER_DRAIN_GRACE_MS: "600000" });
    const grace = Number(env.STIGMER_DRAIN_GRACE_MS);
    expect(grace).toBeGreaterThan(0);
    expect(grace).toBeLessThan(GRACEFUL_STOP_TIMEOUT_MS);
  });

  it("configures static mode with the workspace and pinned queue", () => {
    const env = buildRunnerEnv(config, {});
    expect(env.MODE).toBe("local");
    expect(env.STIGMER_RUNNER_MODE).toBeUndefined(); // static mode
    expect(env.STIGMER_BACKEND_ENDPOINT).toBe("http://localhost:7234");
    expect(env.STIGMER_MCP_PUBLIC_ENDPOINT, "remote MCP servers get the local server's address").toBe(
      "http://localhost:7234",
    );
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

  // The Anthropic key is the only one with a contract slot (`stigmer setup`
  // saves it); every other provider key flows through shell-env inheritance.
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
  });

  // #285 regression guard: the server's artifact base and the runner's artifact
  // path must be the SAME directory, or bytes the server stored under a
  // storage key fail to resolve when the runner reads them back. Both must be defined
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
    // The runner mints no download links, so the daemon hands it no serve URL.
    expect(runnerEnv).not.toHaveProperty("LOCAL_ARTIFACT_SERVE_URL");
  });
});

describe("the server's STIGMER_RUNNER_PROVIDERS", () => {
  // The server refuses a run whose provider no runner reaches; the daemon
  // tells it what its own runner reaches, judged over the environment that
  // runner is given (stigmer#1084).
  it("is empty when the runner holds no provider", () => {
    expect(buildServerEnv(config, {}).STIGMER_RUNNER_PROVIDERS).toBe("");
  });

  it("names the providers the runner's environment reaches, the saved key included", () => {
    const env = buildServerEnv({ ...config, anthropicApiKey: "sk-ant-saved" }, { CURSOR_API_KEY: "ck" });
    expect(env.STIGMER_RUNNER_PROVIDERS).toBe("anthropic,cursor");
  });

  it("counts a cloud backend or a gateway as reaching Anthropic", () => {
    const vertex = buildServerEnv(config, { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global" });
    expect(vertex.STIGMER_RUNNER_PROVIDERS).toBe("anthropic");
    const gateway = buildServerEnv(config, { ANTHROPIC_BASE_URL: "http://127.0.0.1:4242", OPENAI_API_KEY: "sk-oai" });
    expect(gateway.STIGMER_RUNNER_PROVIDERS).toBe("anthropic,openai");
  });

  it("keeps a value the operator exported, an empty one included", () => {
    expect(buildServerEnv(config, { STIGMER_RUNNER_PROVIDERS: "openai", CURSOR_API_KEY: "ck" }).STIGMER_RUNNER_PROVIDERS).toBe(
      "openai",
    );
    expect(buildServerEnv(config, { STIGMER_RUNNER_PROVIDERS: "", CURSOR_API_KEY: "ck" }).STIGMER_RUNNER_PROVIDERS).toBe("");
  });

  it("is left unset when the daemon starts no runner, so the server refuses nothing", () => {
    const env = buildServerEnv({ ...config, serverOnly: true }, { CURSOR_API_KEY: "ck" });
    expect(env).not.toHaveProperty("STIGMER_RUNNER_PROVIDERS");
    expect(localRunnerReach({ ...config, runner: undefined }, {})).toBeUndefined();
  });

  it("reports how each provider is reached, from the runner's environment", () => {
    expect(localRunnerReach({ ...config, cursorApiKey: "ck" }, { ANTHROPIC_BASE_URL: "https://gw.example" })).toEqual([
      { provider: "anthropic", via: "gateway" },
      { provider: "cursor", via: "key" },
    ]);
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
    expect(spawn.args).toEqual(["/repo/server/dist/main.js"]);
  });

  it("omits the runner in server-only mode", () => {
    const components = buildComponents({ ...config, serverOnly: true }, {});
    expect(components.map((c) => c.name)).toEqual(["stigmer-server"]);
  });
});
