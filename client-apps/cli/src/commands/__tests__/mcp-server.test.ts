// Unit tests for how `stigmer mcp-server` bridges CLI configuration into the
// embedded server's environment (commands/mcp-server.ts). Pinned: the active
// named backend supplies the endpoint and its credential (a cloud login's token,
// a self-hosted entry's API key), read from a config file as `stigmer auth login`
// writes it; the local daemon gets its fixed address and no credential; a value
// already in the environment or set by a flag always wins, and a stored
// credential is never bridged to an address other than its own backend's.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Config, getDefault, load, save } from "../../config/config.js";
import { applyConfigEnv, applyFlagsEnv, registerMcpServer } from "../mcp-server.js";

// The embedded server, replaced so the command's action runs to completion:
// it records the environment the server would read its configuration from.
const started = vi.hoisted(() => ({ env: [] as NodeJS.ProcessEnv[] }));
vi.mock("@stigmer/mcp-server", () => ({
  defaultConfig: () => ({}),
  run: async () => {
    started.env.push({ ...process.env });
  },
}));

/** Save a config the way the CLI's own commands do, then read it back from disk. */
function roundTrip(config: Config): Config {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-mcp-config-"));
  try {
    const path = join(dir, "config.yaml");
    save(config, path);
    return load(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("applyConfigEnv", () => {
  it("points a local backend at the local server", () => {
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(getDefault(), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("bridges the signed-in cloud backend's endpoint and token from the saved config", () => {
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(roundTrip(signedIn), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBe("tok-cloud");
  });

  it("bridges a self-hosted backend's endpoint and API key from the saved config", () => {
    const selfHosted = getDefault();
    selfHosted.backends = {
      staging: { type: "selfhost", endpoint: "stigmer.example.com:7234", api_key: "stk_x" },
    };
    selfHosted.current_backend = "staging";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(roundTrip(selfHosted), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("stigmer.example.com:7234");
    expect(env.STIGMER_API_KEY).toBe("stk_x");
  });

  it("bridges no stored credential to an address other than its backend's", () => {
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    // A runner spawning `stigmer mcp-server` names its own server and passes
    // its own credential, if any, through the environment.
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "localhost:7234" };
    applyConfigEnv(roundTrip(signedIn), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("points a signed-in cloud backend with no endpoint of its own at Stigmer Cloud", () => {
    const signedIn = getDefault();
    signedIn.backends = { cloud: { type: "cloud", token: "tok-cloud" } };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(roundTrip(signedIn), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBe("tok-cloud");
  });

  it("names no address and no credential for a self-hosted backend without an endpoint", () => {
    const config = getDefault();
    config.backends = { staging: { type: "selfhost", api_key: "stk_x" } };
    config.current_backend = "staging";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(config, env);
    expect(env).toEqual({});
  });

  it("never overrides a value already present in the environment", () => {
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "preset:7234" };
    applyConfigEnv(getDefault(), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("preset:7234");
  });
});

describe("applyFlagsEnv", () => {
  it("maps every set flag to its environment variable", () => {
    const env: NodeJS.ProcessEnv = {};
    applyFlagsEnv(
      {
        transport: "http",
        port: "9090",
        serverAddress: "host:7234",
        apiKey: "key",
        logFormat: "json",
        logLevel: "debug",
      },
      env,
    );
    expect(env).toMatchObject({
      STIGMER_MCP_TRANSPORT: "http",
      STIGMER_MCP_HTTP_PORT: "9090",
      STIGMER_SERVER_ADDRESS: "host:7234",
      STIGMER_API_KEY: "key",
      STIGMER_MCP_LOG_FORMAT: "json",
      STIGMER_MCP_LOG_LEVEL: "debug",
    });
  });

  it("overrides config-derived values (flags win)", () => {
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "from-config:7234" };
    applyFlagsEnv({ serverAddress: "from-flag:7234" }, env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("from-flag:7234");
  });

  it("ignores unset flags", () => {
    const env: NodeJS.ProcessEnv = {};
    applyFlagsEnv({}, env);
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe("stigmer mcp-server", () => {
  const BRIDGED = ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY"] as const;
  afterEach(() => {
    for (const key of BRIDGED) delete process.env[key];
    started.env.length = 0;
  });

  it("starts the server on the flag's address without the signed-in backend's token", async () => {
    for (const key of BRIDGED) delete process.env[key];
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    save(signedIn);
    const program = new Command();
    registerMcpServer(program);
    await program.parseAsync(["mcp-server", "--server-address", "localhost:7234"], { from: "user" });
    expect(started.env).toHaveLength(1);
    expect(started.env[0]?.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(started.env[0]?.STIGMER_API_KEY).toBeUndefined();
  });

  it("starts the server on the signed-in backend with its token when nothing else names one", async () => {
    for (const key of BRIDGED) delete process.env[key];
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    save(signedIn);
    const program = new Command();
    registerMcpServer(program);
    await program.parseAsync(["mcp-server"], { from: "user" });
    expect(started.env[0]?.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(started.env[0]?.STIGMER_API_KEY).toBe("tok-cloud");
  });
});
