/**
 * Pins the dispatch reader's three answers (dispatch-credential.ts): the
 * minted credential when the provider defines the capability; "" with
 * nothing logged when the capability is absent (an edition credentialed
 * another way) or answers ""; and "" with exactly one warning when the
 * capability throws — a dispatch never fails on a mint. Also pins WHAT
 * the warning carries: the execution id and the error's message, never
 * the credential or the provider. And that the mint is told the turn it
 * mints for (its session, organization and placement), and may answer with
 * a promise, whose rejection degrades like a throw.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import type { LogEntry } from "../../boot/logger.js";
import { runCredentialForDispatch } from "../dispatch-credential.js";
import type { RunCredentialMint } from "../dispatch-credential.js";
import type { RunCredentialTurn } from "../runner-credential-provider.js";
import { newExecutionScopedRunnerCredentialProvider } from "../runner-credential-provider.js";
import {
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

function capturingLogger() {
  const entries: LogEntry[] = [];
  const logger = createLogger({
    level: "debug",
    pretty: false,
    write: () => {},
    sink: (entry) => entries.push(entry),
  });
  return { logger, entries };
}

const TURN: RunCredentialTurn = { sessionId: "ses_1", org: "org_1", runner: "shared" };

describe("runCredentialForDispatch", () => {
  it("answers the provider's run credential, bound to the execution", async () => {
    const service = RunnerAuthService.create(randomBytes(32));
    const provider = newExecutionScopedRunnerCredentialProvider(service);
    const { logger, entries } = capturingLogger();

    const token = await runCredentialForDispatch(provider, "run_dispatch", TURN, logger);

    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, token)).toBe(
      "run_dispatch",
    );
    expect(entries).toEqual([]);
  });

  it('answers "" silently when the capability is absent — the edition\'s runner is credentialed another way', async () => {
    const withoutCapability: RunCredentialMint = {};
    const { logger, entries } = capturingLogger();

    expect(await runCredentialForDispatch(withoutCapability, "run_1", TURN, logger)).toBe("");
    expect(entries).toEqual([]);
  });

  it('answers "" silently when the capability answers "" (keyless)', async () => {
    const keyless = newExecutionScopedRunnerCredentialProvider(
      RunnerAuthService.create(undefined),
    );
    const { logger, entries } = capturingLogger();

    expect(await runCredentialForDispatch(keyless, "run_1", TURN, logger)).toBe("");
    expect(entries).toEqual([]);
  });

  it('a throwing capability degrades to "" with one warning that names the execution and never the credential', async () => {
    const throwing: RunCredentialMint = {
      mintRunCredential(): string {
        throw new Error("signing key unreadable");
      },
    };
    const { logger, entries } = capturingLogger();

    expect(await runCredentialForDispatch(throwing, "run_fault", TURN, logger)).toBe("");

    expect(entries).toHaveLength(1);
    const [warning] = entries;
    expect(warning!.level).toBe("warn");
    expect(warning!.message).toMatch(/dispatching without it/);
    // The field set is the contract: an id and a message, nothing that
    // could be a credential.
    expect(Object.keys(warning!.fields ?? {}).sort()).toEqual([
      "error",
      "execution_id",
    ]);
    expect(warning!.fields).toMatchObject({
      execution_id: "run_fault",
      error: "signing key unreadable",
    });
  });

  it("tells the mint the turn it mints for, and waits for a promised answer", async () => {
    const seen: (RunCredentialTurn | undefined)[] = [];
    const promising: RunCredentialMint = {
      async mintRunCredential(_executionId, turn) {
        seen.push(turn);
        return "minted-later";
      },
    };
    const { logger } = capturingLogger();

    expect(await runCredentialForDispatch(promising, "run_1", TURN, logger)).toBe("minted-later");
    expect(seen).toEqual([TURN]);
  });

  it('a rejected promise degrades to "" with the same one warning', async () => {
    const rejecting: RunCredentialMint = {
      async mintRunCredential(): Promise<string> {
        throw new Error("account lookup failed");
      },
    };
    const { logger, entries } = capturingLogger();

    expect(await runCredentialForDispatch(rejecting, "run_2", TURN, logger)).toBe("");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fields).toMatchObject({ execution_id: "run_2", error: "account lookup failed" });
  });
});
