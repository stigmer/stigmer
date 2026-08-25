import { describe, expect, it } from "vitest";
import { buildDaemonEnv, type DaemonEnvInputs, readDaemonConfig } from "./env.js";

const baseInputs: DaemonEnvInputs = {
  dataDir: "/home/u/.stigmer/data",
  logDir: "/home/u/.stigmer/data/logs",
  temporalManaged: true,
  temporalAddress: "127.0.0.1:7233",
  serverOnly: false,
  noWeb: false,
  // The node shape is the served default since the DD-006 cutover (D4 #24).
  server: {
    kind: "node",
    nodeBin: "/usr/bin/node",
    entryPath: "/repo/server-ts/dist/main.js",
    appDir: "/repo/server-ts",
  },
  runner: { nodeBin: "/usr/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
};

describe("buildDaemonEnv + readDaemonConfig", () => {
  it("round-trips the full launcher -> daemon contract (node server shape)", () => {
    const env = buildDaemonEnv(baseInputs, {});
    const config = readDaemonConfig(env);
    expect(config).toEqual({
      dataDir: "/home/u/.stigmer/data",
      logDir: "/home/u/.stigmer/data/logs",
      temporalManaged: true,
      temporalAddress: "127.0.0.1:7233",
      serverOnly: false,
      noWeb: false,
      server: {
        kind: "node",
        nodeBin: "/usr/bin/node",
        entryPath: "/repo/server-ts/dist/main.js",
        appDir: "/repo/server-ts",
      },
      runner: { nodeBin: "/usr/bin/node", entryPath: "/repo/runner/dist/main.js", appDir: "/repo/runner" },
      cursorApiKey: undefined,
      anthropicApiKey: undefined,
      activityRouting: undefined,
      operatorEmail: undefined,
      operatorName: undefined,
    });
  });

  it("round-trips the binary server shape (the Go rollback path)", () => {
    const env = buildDaemonEnv({ ...baseInputs, server: { kind: "binary", bin: "/usr/local/bin/stigmer-server" } }, {});
    const config = readDaemonConfig(env);
    expect(config.server).toEqual({ kind: "binary", bin: "/usr/local/bin/stigmer-server" });
  });

  // The rollback lever's delivery guarantee, both directions:
  // - a caller-exported STIGMER_SERVER_BIN must not leak past a launcher that
  //   resolved the node shape (the launcher already honored the override
  //   upstream — a node-shape contract means it was NOT set);
  // - when both shapes somehow reach the daemon, the binary override wins,
  //   because setting it means "run the Go server".
  it("scrubs a stale STIGMER_SERVER_BIN from the base env when the node shape was resolved", () => {
    const env = buildDaemonEnv(baseInputs, { STIGMER_SERVER_BIN: "/stale/go-server" });
    expect(env.STIGMER_SERVER_BIN).toBeUndefined();
    expect(readDaemonConfig(env).server.kind).toBe("node");
  });

  it("prefers the binary override when both shapes are present in the env", () => {
    const env = buildDaemonEnv(baseInputs, {});
    env.STIGMER_SERVER_BIN = "/operator/override/stigmer-server";
    expect(readDaemonConfig(env).server).toEqual({
      kind: "binary",
      bin: "/operator/override/stigmer-server",
    });
  });

  it("scrubs a stale node triple from the base env when the binary shape was resolved", () => {
    const env = buildDaemonEnv(
      { ...baseInputs, server: { kind: "binary", bin: "/usr/local/bin/stigmer-server" } },
      { STIGMER_SERVER_NODE_BIN: "/stale/node", STIGMER_SERVER_ENTRY: "/stale/main.js", STIGMER_SERVER_APP_DIR: "/stale" },
    );
    expect(env.STIGMER_SERVER_NODE_BIN).toBeUndefined();
    expect(env.STIGMER_SERVER_ENTRY).toBeUndefined();
    expect(env.STIGMER_SERVER_APP_DIR).toBeUndefined();
    expect(readDaemonConfig(env).server.kind).toBe("binary");
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

  // The operator identity rides the same config-file-only delivery path as the
  // Anthropic key (oss#796): persisted by `stigmer setup`, absent from the
  // shell, written into the contract explicitly by the launcher.
  it("delivers a launcher-resolved operator identity with no help from the base env", () => {
    const env = buildDaemonEnv(
      { ...baseInputs, operatorEmail: "ada@example.com", operatorName: "Ada Lovelace" },
      {},
    );
    const config = readDaemonConfig(env);
    expect(config.operatorEmail).toBe("ada@example.com");
    expect(config.operatorName).toBe("Ada Lovelace");
  });

  it("passes a shell-exported operator identity through from the base env", () => {
    const env = buildDaemonEnv(baseInputs, { STIGMER_OPERATOR_EMAIL: "env@example.com" });
    expect(readDaemonConfig(env).operatorEmail).toBe("env@example.com");
    expect(readDaemonConfig(env).operatorName).toBeUndefined();
  });

  // Other provider keys have no contract slot; they reach the runner solely via
  // shell-env inheritance (the child env spreads the base env).
  it("leaves shell-exported non-Anthropic keys in the env without parsing them", () => {
    const env = buildDaemonEnv(baseInputs, { OPENAI_API_KEY: "sk-oai-env" });
    expect(env.OPENAI_API_KEY).toBe("sk-oai-env");
    expect(readDaemonConfig(env)).not.toHaveProperty("openaiApiKey");
  });

  it("requires the data dir and one server launch shape", () => {
    expect(() => readDaemonConfig({})).toThrow(/STIGMER_DATA_DIR/);
    // Neither the binary override nor the full node triple: actionable throw
    // naming both shapes.
    expect(() => readDaemonConfig({ STIGMER_DATA_DIR: "/x" })).toThrow(/STIGMER_SERVER_BIN/);
    expect(() => readDaemonConfig({ STIGMER_DATA_DIR: "/x", STIGMER_SERVER_NODE_BIN: "/usr/bin/node" })).toThrow(
      /STIGMER_SERVER_ENTRY/,
    );
  });
});
