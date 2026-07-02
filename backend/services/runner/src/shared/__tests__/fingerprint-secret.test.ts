import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_VAR = "STIGMER_RUNNER_HITL_SECRET";

// The module memoizes its secret, so each test re-imports a fresh module copy via
// vi.resetModules() to exercise the source-precedence + fallback paths cleanly.
async function freshSecretModule() {
  vi.resetModules();
  return import("../fingerprint-secret.js");
}

describe("getRunnerHitlMasterSecret", () => {
  const original = process.env[ENV_VAR];

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
    vi.restoreAllMocks();
  });

  it("uses the env var (UTF-8) when set", async () => {
    process.env[ENV_VAR] = "my-stable-secret";
    const { getRunnerHitlMasterSecret } = await freshSecretModule();
    expect(Buffer.from(getRunnerHitlMasterSecret() as Buffer).toString("utf-8")).toBe("my-stable-secret");
  });

  it("falls back to a per-process random secret and warns once when unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getRunnerHitlMasterSecret } = await freshSecretModule();

    const a = Buffer.from(getRunnerHitlMasterSecret() as Buffer);
    const b = Buffer.from(getRunnerHitlMasterSecret() as Buffer);

    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true); // memoized: stable within the process
    expect(warn).toHaveBeenCalledTimes(1); // warned once, not per call
  });

  it("two separate processes (module loads) get different random fallbacks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m1 = await freshSecretModule();
    const s1 = Buffer.from(m1.getRunnerHitlMasterSecret() as Buffer);
    const m2 = await freshSecretModule();
    const s2 = Buffer.from(m2.getRunnerHitlMasterSecret() as Buffer);
    expect(s1.equals(s2)).toBe(false);
  });
});
