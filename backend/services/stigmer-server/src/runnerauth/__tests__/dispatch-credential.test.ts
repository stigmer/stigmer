/**
 * Pins the dispatch reader's three answers (dispatch-credential.ts): the
 * minted credential when the provider defines the capability; "" with
 * nothing logged when the capability is absent (an edition credentialed
 * another way) or answers ""; and "" with exactly one warning when the
 * capability throws — a dispatch never fails on a mint. Also pins WHAT
 * the warning carries: the execution id and the error's message, never
 * the credential or the provider.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import type { LogEntry } from "../../boot/logger.js";
import { runCredentialForDispatch } from "../dispatch-credential.js";
import type { RunCredentialMint } from "../dispatch-credential.js";
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

describe("runCredentialForDispatch", () => {
  it("answers the provider's run credential, bound to the execution", () => {
    const service = RunnerAuthService.create(randomBytes(32));
    const provider = newExecutionScopedRunnerCredentialProvider(service);
    const { logger, entries } = capturingLogger();

    const token = runCredentialForDispatch(provider, "aex_dispatch", logger);

    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, token)).toBe(
      "aex_dispatch",
    );
    expect(entries).toEqual([]);
  });

  it('answers "" silently when the capability is absent — the edition\'s runner is credentialed another way', () => {
    const withoutCapability: RunCredentialMint = {};
    const { logger, entries } = capturingLogger();

    expect(runCredentialForDispatch(withoutCapability, "aex_1", logger)).toBe(
      "",
    );
    expect(entries).toEqual([]);
  });

  it('answers "" silently when the capability answers "" (keyless)', () => {
    const keyless = newExecutionScopedRunnerCredentialProvider(
      RunnerAuthService.create(undefined),
    );
    const { logger, entries } = capturingLogger();

    expect(runCredentialForDispatch(keyless, "aex_1", logger)).toBe("");
    expect(entries).toEqual([]);
  });

  it('a throwing capability degrades to "" with one warning that names the execution and never the credential', () => {
    const throwing: RunCredentialMint = {
      mintRunCredential(): string {
        throw new Error("signing key unreadable");
      },
    };
    const { logger, entries } = capturingLogger();

    expect(runCredentialForDispatch(throwing, "aex_fault", logger)).toBe("");

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
      execution_id: "aex_fault",
      error: "signing key unreadable",
    });
  });
});
