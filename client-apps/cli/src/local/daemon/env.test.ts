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

  it("requires the data dir and server binary", () => {
    expect(() => readDaemonConfig({})).toThrow(/STIGMER_DATA_DIR/);
    expect(() => readDaemonConfig({ STIGMER_DATA_DIR: "/x" })).toThrow(/STIGMER_SERVER_BIN/);
  });
});
