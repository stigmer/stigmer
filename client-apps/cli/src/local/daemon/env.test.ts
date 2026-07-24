import { describe, expect, it } from "vitest";
import { buildDaemonEnv, type DaemonEnvInputs, readDaemonConfig } from "./env.js";

const baseInputs: DaemonEnvInputs = {
  dataDir: "/home/u/.stigmer/data",
  logDir: "/home/u/.stigmer/data/logs",
  temporalManaged: true,
  temporalAddress: "127.0.0.1:7233",
  serverOnly: false,
  noWeb: false,
  serverBin: "/usr/local/bin/stigmer-server",
  runner: { nodeBin: "/usr/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
};

describe("buildDaemonEnv + readDaemonConfig", () => {
  it("round-trips the full launcher -> daemon contract", () => {
    const env = buildDaemonEnv(baseInputs, {});
    const config = readDaemonConfig(env);
    expect(config).toEqual({
      dataDir: "/home/u/.stigmer/data",
      logDir: "/home/u/.stigmer/data/logs",
      temporalManaged: true,
      temporalAddress: "127.0.0.1:7233",
      serverOnly: false,
      noWeb: false,
      serverBin: "/usr/local/bin/stigmer-server",
      runner: { nodeBin: "/usr/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
      cursorApiKey: undefined,
      anthropicApiKey: undefined,
      activityRouting: undefined,
    });
  });

  it("omits runner coordinates in server-only mode", () => {
    const env = buildDaemonEnv({ ...baseInputs, serverOnly: true }, {});
    const config = readDaemonConfig(env);
    expect(config.serverOnly).toBe(true);
    expect(config.runner).toBeUndefined();
  });

  it("passes CURSOR_API_KEY and activity routing through from the base env", () => {
    const env = buildDaemonEnv(baseInputs, { CURSOR_API_KEY: "ck", STIGMER_ACTIVITY_ROUTING: "session" });
    const config = readDaemonConfig(env);
    expect(config.cursorApiKey).toBe("ck");
    expect(config.activityRouting).toBe("session");
  });

  // The config-file-only delivery path: a key from `stigmer setup` is not in the
  // shell env, so the launcher must write it into the contract explicitly.
  // Anthropic is the only provider with this path — the local stack executes
  // on Anthropic only.
  it("delivers a launcher-resolved Anthropic key with no help from the base env", () => {
    const env = buildDaemonEnv({ ...baseInputs, anthropicApiKey: "sk-ant-cfg" }, {});
    const config = readDaemonConfig(env);
    expect(config.anthropicApiKey).toBe("sk-ant-cfg");
  });

  it("passes a shell-exported Anthropic key through from the base env", () => {
    const env = buildDaemonEnv(baseInputs, { ANTHROPIC_API_KEY: "sk-ant-env" });
    const config = readDaemonConfig(env);
    expect(config.anthropicApiKey).toBe("sk-ant-env");
  });

  // Other provider keys have no contract slot; they reach the runner solely via
  // shell-env inheritance (the child env spreads the base env).
  it("leaves shell-exported non-Anthropic keys in the env without parsing them", () => {
    const env = buildDaemonEnv(baseInputs, { OPENAI_API_KEY: "sk-oai-env" });
    expect(env.OPENAI_API_KEY).toBe("sk-oai-env");
    expect(readDaemonConfig(env)).not.toHaveProperty("openaiApiKey");
  });

  it("requires the data dir and server binary", () => {
    expect(() => readDaemonConfig({})).toThrow(/STIGMER_DATA_DIR/);
    expect(() => readDaemonConfig({ STIGMER_DATA_DIR: "/x" })).toThrow(/STIGMER_SERVER_BIN/);
  });
});
