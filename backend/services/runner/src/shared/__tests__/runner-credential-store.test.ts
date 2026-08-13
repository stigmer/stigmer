import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  captureRunnerSecrets,
  getRunnerSecret,
  setRunnerSecret,
  runnerSecretsEnvView,
  resetRunnerSecretsForTests,
} from "../runner-credential-store.js";
import {
  RUNNER_CREDENTIAL_ENV_KEYS,
  RUNNER_ENCRYPTION_ENV_KEYS,
  RUNNER_SECRET_ENV_KEYS,
} from "../runner-credential-keys.js";

/** Snapshot/restore of every env slot these tests touch. */
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  resetRunnerSecretsForTests();
  for (const key of RUNNER_SECRET_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  resetRunnerSecretsForTests();
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
});

describe("captureRunnerSecrets", () => {
  it("moves every listed secret out of process.env and into the store", () => {
    // Plant a value for every name in the source-of-truth list, so a key
    // added to runner-credential-keys.ts is covered here automatically —
    // the #385 test idiom, applied to custody.
    for (const key of RUNNER_SECRET_ENV_KEYS) {
      process.env[key] = `boot-${key}`;
    }

    captureRunnerSecrets();

    for (const key of RUNNER_SECRET_ENV_KEYS) {
      expect(
        process.env[key],
        `'${key}' must not remain in process.env after capture — anything ` +
        `left there is readable by every agent shell command (issue #508)`,
      ).toBeUndefined();
      expect(getRunnerSecret(key)).toBe(`boot-${key}`);
    }
  });

  it("is idempotent — a second capture cannot re-freeze rotated values", () => {
    process.env.STIGMER_TOKEN = "boot-token";
    captureRunnerSecrets();
    setRunnerSecret("STIGMER_TOKEN", "rotated-token");

    // A late (buggy or racing) boot-door call must be a no-op.
    process.env.STIGMER_TOKEN = "stale-replant";
    captureRunnerSecrets();

    expect(getRunnerSecret("STIGMER_TOKEN")).toBe("rotated-token");
    // The replant stays in env (capture did not consume it) — the live-env
    // fallback below deliberately does NOT apply when the store holds a
    // value, so rotation always wins.
    expect(process.env.STIGMER_TOKEN).toBe("stale-replant");
    delete process.env.STIGMER_TOKEN;
  });

  it("scrubs the encryption keys, not only the #385 credentials (issue #508)", () => {
    // Pins the #508 scope widening by name. The parameterized test above
    // would pass even if the combined list regressed to the 8 credentials;
    // this one cannot.
    for (const key of [
      "STIGMER_PAYLOAD_ENCRYPTION_KEY",
      "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY",
    ]) {
      expect(RUNNER_ENCRYPTION_ENV_KEYS, `'${key}' must be a captured secret`).toContain(key);
    }
    for (const key of [...RUNNER_CREDENTIAL_ENV_KEYS, ...RUNNER_ENCRYPTION_ENV_KEYS]) {
      expect(RUNNER_SECRET_ENV_KEYS, `'${key}' must be in the scrub list`).toContain(key);
    }
  });
});

describe("getRunnerSecret", () => {
  it("falls back to a live process.env value the capture never saw", () => {
    captureRunnerSecrets();
    // Custody rule 2: a value planted after boot behaves like the env read
    // the store replaced (test/embedder compatibility) — production only
    // sets these at process start, so this path is dead there.
    process.env.STIGMER_TOKEN = "late-planted";

    expect(getRunnerSecret("STIGMER_TOKEN")).toBe("late-planted");
  });

  it("returns undefined for an absent secret", () => {
    captureRunnerSecrets();
    expect(getRunnerSecret("STIGMER_TOKEN")).toBeUndefined();
  });
});

describe("setRunnerSecret", () => {
  it("carries the rotation channel: set updates, null clears", () => {
    captureRunnerSecrets();

    setRunnerSecret("STIGMER_TOKEN", "minted-1");
    expect(getRunnerSecret("STIGMER_TOKEN")).toBe("minted-1");

    setRunnerSecret("STIGMER_TOKEN", "minted-2");
    expect(getRunnerSecret("STIGMER_TOKEN")).toBe("minted-2");

    setRunnerSecret("STIGMER_TOKEN", null);
    expect(getRunnerSecret("STIGMER_TOKEN")).toBeUndefined();
  });

  it("never lets a rotated value sit in process.env, even if a writer beats the boot capture", () => {
    process.env.STIGMER_TOKEN = "boot-token";

    // No captureRunnerSecrets() call yet — the writer forces it.
    setRunnerSecret("STIGMER_TOKEN", "rotated-early");

    expect(process.env.STIGMER_TOKEN).toBeUndefined();
    expect(getRunnerSecret("STIGMER_TOKEN")).toBe("rotated-early");
  });
});

describe("runnerSecretsEnvView", () => {
  it("merges captured secrets over process.env without writing them back", () => {
    process.env.STIGMER_TOKEN = "boot-token";
    captureRunnerSecrets();

    const view = runnerSecretsEnvView();

    expect(view.STIGMER_TOKEN).toBe("boot-token");
    expect(view.PATH).toBe(process.env.PATH);
    expect(
      process.env.STIGMER_TOKEN,
      "building the view must not re-plant secrets into process.env",
    ).toBeUndefined();
  });

  it("reflects rotation", () => {
    captureRunnerSecrets();
    setRunnerSecret("STIGMER_TOKEN", "rotated");

    expect(runnerSecretsEnvView().STIGMER_TOKEN).toBe("rotated");
  });
});
