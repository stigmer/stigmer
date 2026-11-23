/**
 * The run credential's wire reader and its store (`run-credential.ts`,
 * `run-credential-store.ts`).
 *
 * The property that matters is the last arm: two activities whose awaits
 * interleave in one process each see their own credential and never the
 * other's. That is what lets one shared `StigmerClient` — one per worker for
 * the turn activities — present the right run's credential per request.
 *
 * Beside it: the sealed key's reader, and the runner's own calls during a
 * turn reading the turn's credential before the runner's token
 * (`credentialForTurn`, `turnCredentialRef`), per request.
 */

import { describe, expect, it } from "vitest";

import {
  RUN_CREDENTIAL_INPUT_KEY,
  SEALED_RUN_CREDENTIAL_INPUT_KEY,
  readRunCredentialFromInput,
  readSealedRunCredentialFromInput,
} from "../run-credential.js";
import {
  credentialForTurn,
  currentRunCredential,
  turnCredentialRef,
  withRunCredential,
} from "../run-credential-store.js";

describe("readRunCredentialFromInput", () => {
  it("reads a non-empty string under the wire key", () => {
    expect(
      readRunCredentialFromInput({ [RUN_CREDENTIAL_INPUT_KEY]: "cred-1" }),
    ).toBe("cred-1");
  });

  it("answers undefined for a positional string argument (EnsureThread's)", () => {
    expect(readRunCredentialFromInput("run_123")).toBeUndefined();
  });

  it("answers undefined for a credential-less object — the cloud's dispatch", () => {
    expect(
      readRunCredentialFromInput({ execution_id: "run_123", thread_id: "" }),
    ).toBeUndefined();
  });

  it("answers undefined for an empty string, null, undefined and a non-string value", () => {
    expect(
      readRunCredentialFromInput({ [RUN_CREDENTIAL_INPUT_KEY]: "" }),
    ).toBeUndefined();
    expect(readRunCredentialFromInput(null)).toBeUndefined();
    expect(readRunCredentialFromInput(undefined)).toBeUndefined();
    expect(
      readRunCredentialFromInput({ [RUN_CREDENTIAL_INPUT_KEY]: 42 }),
    ).toBeUndefined();
  });

  it("does not read the connect lane's camelCase per-call token", () => {
    expect(
      readRunCredentialFromInput({ executionContextToken: "connect-token" }),
    ).toBeUndefined();
  });

  it("pins the wire key as bytes", () => {
    expect(RUN_CREDENTIAL_INPUT_KEY).toBe("execution_context_token");
  });
});

describe("run-credential store", () => {
  it("is empty outside any activity", () => {
    expect(currentRunCredential()).toBeUndefined();
  });

  it("is visible to everything the wrapped function awaits, and gone after", async () => {
    let inner: string | undefined;
    await withRunCredential("cred-a", async () => {
      await Promise.resolve();
      inner = await (async () => currentRunCredential())();
    });
    expect(inner).toBe("cred-a");
    expect(currentRunCredential()).toBeUndefined();
  });

  it("is inherited by a promise created inside the scope and settled after it", async () => {
    let detached: Promise<string | undefined> | undefined;
    await withRunCredential("cred-b", async () => {
      detached = new Promise((resolve) =>
        setTimeout(() => resolve(currentRunCredential()), 5),
      );
    });
    expect(await detached).toBe("cred-b");
  });

  it("never crosses between two activities whose awaits interleave", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const activity = async (name: string, ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push([name, currentRunCredential()]);
      }
    };
    await Promise.all([
      withRunCredential("cred-1", () => activity("one", 4)),
      withRunCredential("cred-2", () => activity("two", 4)),
      activity("none", 4),
    ]);
    expect(seen.filter(([name]) => name === "one").map(([, c]) => c)).toEqual(
      Array(4).fill("cred-1"),
    );
    expect(seen.filter(([name]) => name === "two").map(([, c]) => c)).toEqual(
      Array(4).fill("cred-2"),
    );
    expect(seen.filter(([name]) => name === "none").map(([, c]) => c)).toEqual(
      Array(4).fill(undefined),
    );
  });
});

describe("readSealedRunCredentialFromInput", () => {
  it("reads a non-empty string under the sealed key, and nothing else", () => {
    expect(readSealedRunCredentialFromInput({ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: "c2VhbGVk" })).toBe("c2VhbGVk");
    expect(readSealedRunCredentialFromInput({ [SEALED_RUN_CREDENTIAL_INPUT_KEY]: "" })).toBeUndefined();
    expect(readSealedRunCredentialFromInput({ [RUN_CREDENTIAL_INPUT_KEY]: "clear" })).toBeUndefined();
    expect(readSealedRunCredentialFromInput("ses_1")).toBeUndefined();
  });
});

describe("the runner's own calls during a turn", () => {
  const runnerToken = { current: "shared-runner-key" };

  it("present the turn's credential first, and the runner's token outside a turn or for a turn that carried none", async () => {
    expect(credentialForTurn(runnerToken)).toBe("shared-runner-key");
    expect(await withRunCredential("cred-a", async () => credentialForTurn(runnerToken))).toBe("cred-a");
    expect(credentialForTurn({ current: null })).toBeUndefined();
  });

  it("read the credential per request through the ref, so one client serves two turns at once as each", async () => {
    const ref = turnCredentialRef(runnerToken);
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));
    const seen = await Promise.all([
      withRunCredential("cred-a", async () => {
        await tick();
        return ref.current;
      }),
      withRunCredential("cred-b", async () => {
        await tick();
        return ref.current;
      }),
    ]);
    expect(seen).toEqual(["cred-a", "cred-b"]);
    expect(ref.current).toBe("shared-runner-key");
  });
});
