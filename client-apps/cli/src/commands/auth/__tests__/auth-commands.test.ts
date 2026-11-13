// `stigmer auth login|logout` at the command layer (commands/auth/index.ts,
// commands/auth/login.ts), over the real config file in a throwaway home:
// logout clears a sign-in on any backend (its token set and the provider it
// came from) and, on a self-hosted backend with no sign-in, its API key;
// login hands its flags to the sign-in and renders where it landed once the
// account step ran. `config backend status|list` say a self-hosted backend
// is logged in when it holds a sign-in.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load, save } from "../../../config/index.js";
import { buildProgram } from "../../../program.js";

const signIn = vi.hoisted(() => ({ login: vi.fn(), ensure: vi.fn() }));
vi.mock("../../../auth/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../auth/index.js")>()),
  login: signIn.login,
}));
vi.mock("../../../backend.js", () => ({ connectBackend: () => ({ stigmer: {} }) }));
vi.mock("@stigmer/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/client")>()),
  ensureMyIdentityAccount: signIn.ensure,
}));

let home: string | undefined;

beforeEach(() => {
  home = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "stigmer-auth-cmd-"));
  signIn.login.mockReset();
  signIn.ensure.mockReset();
});

afterEach(() => {
  process.env.HOME = home;
});

async function run(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  let out = "";
  const write = (chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(write);
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(write);
  try {
    await program.parseAsync(["node", "stigmer", ...args]);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return out;
}

const SIGNED_IN = {
  token: "t",
  refresh_token: "r",
  token_expiry: "2099-01-01T00:00:00.000Z",
  oidc_issuer: "https://id.acme.test/",
  oidc_client_id: "native",
};

describe("stigmer auth logout", () => {
  it("clears a self-hosted backend's sign-in and the provider it came from, keeping its API key", async () => {
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "acme:443", api_key: "stk_x", ...SIGNED_IN } } });
    expect(await run("auth", "logout")).toContain('Logged out from backend "acme"');
    expect(load().backends?.acme).toEqual({ type: "selfhost", endpoint: "acme:443", api_key: "stk_x" });
  });

  it("clears a self-hosted backend's API key when it holds no sign-in", async () => {
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "acme:443", api_key: "stk_x" } } });
    expect(await run("auth", "logout")).toContain('Cleared the stored API key for backend "acme"');
    expect(load().backends?.acme?.api_key).toBeUndefined();
  });
});

describe("stigmer auth login", () => {
  it("hands its flags to the sign-in and names where it landed", async () => {
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "acme:443" } } });
    signIn.login.mockResolvedValue({ backendName: "acme", type: "selfhost", address: "acme:443", provider: "id.acme.test" });
    signIn.ensure.mockResolvedValue({ account: {}, created: false });
    const out = await run("auth", "login", "--device", "--trust-provider");
    expect(signIn.login).toHaveBeenCalledWith({ device: true, trustProvider: true });
    expect(out).toContain("Authenticated with acme");
    expect(out).toContain('Run commands against backend "acme"');
  });
});

describe("stigmer config backend status|list", () => {
  it("say a self-hosted backend that holds a sign-in is logged in", async () => {
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "acme:443", ...SIGNED_IN } } });
    expect(await run("config", "backend", "status")).toMatch(/Auth\s+Logged in/);
    expect(await run("config", "backend", "list")).toMatch(/Auth\s+Logged in/);
  });
});
