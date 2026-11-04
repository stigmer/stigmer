// Unit tests for how `stigmer mcp-server` bridges CLI configuration into the
// embedded server's environment (commands/mcp-server.ts). Pinned: the active
// named backend supplies the endpoint, read from a config file as `stigmer auth
// login` writes it. A self-hosted entry's API key is bridged as a fixed key; a
// cloud login's token is not copied into the environment, because it expires
// while the server runs: the command names the signed-in backend instead and
// hands the server a token provider over it, which refreshes the sign-in. The
// local daemon gets its fixed address and no credential; a value already in the
// environment or set by a flag always wins, and a stored credential is never
// used for an address other than its own backend's. When both are already
// given, the config is not read at all.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Config, getDefault, load, save } from "../../config/config.js";
import { applyConfigEnv, applyFlagsEnv, registerMcpServer } from "../mcp-server.js";

// The embedded server, replaced so the command's action runs to completion:
// it records the environment the server would read its configuration from,
// and the options the command passed beside it.
interface StartOptions {
  readonly getAccessToken?: () => Promise<string | null> | string | null;
}
const started = vi.hoisted(() => ({
  env: [] as NodeJS.ProcessEnv[],
  options: [] as Array<StartOptions | undefined>,
}));
vi.mock("@stigmer/mcp-server", () => ({
  defaultConfig: () => ({}),
  run: async (_cfg: unknown, _signal: AbortSignal, options?: StartOptions) => {
    started.env.push({ ...process.env });
    started.options.push(options);
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
    expect(applyConfigEnv(getDefault(), env)).toBeUndefined();
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("bridges the signed-in cloud backend's endpoint and names its sign-in, copying no token", () => {
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = {};
    expect(applyConfigEnv(roundTrip(signedIn), env)).toEqual({
      name: "cloud",
      endpoint: "api.stigmer.ai:443",
    });
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("names no sign-in when the environment already gives a key", () => {
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = { STIGMER_API_KEY: "given-key" };
    expect(applyConfigEnv(roundTrip(signedIn), env)).toBeUndefined();
    expect(env).toEqual({ STIGMER_SERVER_ADDRESS: "api.stigmer.ai:443", STIGMER_API_KEY: "given-key" });
  });

  it("bridges a self-hosted backend's endpoint and API key from the saved config", () => {
    const selfHosted = getDefault();
    selfHosted.backends = {
      staging: { type: "selfhost", endpoint: "stigmer.example.com:7234", api_key: "stk_x" },
    };
    selfHosted.current_backend = "staging";
    const env: NodeJS.ProcessEnv = {};
    expect(applyConfigEnv(roundTrip(selfHosted), env)).toBeUndefined();
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
    expect(applyConfigEnv(roundTrip(signedIn), env)).toBeUndefined();
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("points a signed-in cloud backend with no endpoint of its own at Stigmer Cloud", () => {
    const signedIn = getDefault();
    signedIn.backends = { cloud: { type: "cloud", token: "tok-cloud" } };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = {};
    expect(applyConfigEnv(roundTrip(signedIn), env)).toEqual({
      name: "cloud",
      endpoint: "api.stigmer.ai:443",
    });
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBeUndefined();
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

  it("reads no config when the environment already gives the address and the key", () => {
    const dangling: Config = { ...getDefault(), current_backend: "gone" };
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "runner:7234", STIGMER_API_KEY: "key" };
    applyConfigEnv(dangling, env);
    expect(env).toEqual({ STIGMER_SERVER_ADDRESS: "runner:7234", STIGMER_API_KEY: "key" });
    expect(() => applyConfigEnv(dangling, { STIGMER_SERVER_ADDRESS: "runner:7234" })).toThrow(/does not exist/);
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
    started.options.length = 0;
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
    expect(started.options[0]?.getAccessToken).toBeUndefined();
  });

  it("starts the server on the signed-in backend with a provider over its sign-in", async () => {
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
    expect(started.env[0]?.STIGMER_API_KEY).toBeUndefined();
    expect(await started.options[0]?.getAccessToken?.()).toBe("tok-cloud");
  });

  it("starts the server with a given key and no provider", async () => {
    for (const key of BRIDGED) delete process.env[key];
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    save(signedIn);
    const program = new Command();
    registerMcpServer(program);
    await program.parseAsync(["mcp-server", "--api-key", "stk_given"], { from: "user" });
    expect(started.env[0]?.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(started.env[0]?.STIGMER_API_KEY).toBe("stk_given");
    expect(started.options[0]?.getAccessToken).toBeUndefined();
  });
});
