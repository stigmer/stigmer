/**
 * Pins a tools listing's connect attempt row: a listing sweeps the expired
 * attempts first and says how many it swept, then records its own with the
 * expiry its budget sets, the person defaulting to none; ending an attempt
 * removes it, and a failed removal is logged and never thrown, because the
 * listing's answer is already given and the row expires on its own.
 */
import { describe, expect, it } from "vitest";

import type { Logger, LogFields } from "../../../../boot/logger.js";
import type { ConnectAttemptRecord, ConnectAttemptStore } from "../../../../store/interface.js";
import { endConnectAttempt, recordConnectAttempt } from "../attempt.js";

interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(): Logger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at = (level: string) => (message: string, fields?: LogFields) => {
    lines.push({ level, message, fields });
  };
  return { lines, debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

class FakeAttempts implements ConnectAttemptStore {
  readonly created: ConnectAttemptRecord[] = [];
  readonly sweptBefore: number[] = [];
  constructor(
    private readonly expired: number,
    private readonly deleteFailure?: unknown,
  ) {}
  create(attempt: ConnectAttemptRecord): Promise<void> {
    this.created.push(attempt);
    return Promise.resolve();
  }
  findLive(): Promise<ConnectAttemptRecord | undefined> {
    return Promise.resolve(undefined);
  }
  delete(): Promise<void> {
    return this.deleteFailure === undefined ? Promise.resolve() : Promise.reject(this.deleteFailure);
  }
  deleteExpired(now: number): Promise<number> {
    this.sweptBefore.push(now);
    return Promise.resolve(this.expired);
  }
  deleteByOrg(): Promise<number> {
    return Promise.resolve(0);
  }
}

const START = {
  id: "connect-plg_1-0a1b2c3d",
  org: "org_acme",
  createdBy: "acc_person",
  pluginId: "plg_1",
  server: "github",
  ttlMs: 90_500,
};

describe("recordConnectAttempt", () => {
  it("sweeps the expired attempts, says how many, and records this one with its expiry", async () => {
    const attempts = new FakeAttempts(3);
    const logger = recordingLogger();

    await recordConnectAttempt({ connectAttempts: attempts }, logger, { ...START, person: "acc_person" }, 1_000_999);

    expect(attempts.sweptBefore).toEqual([1_000]);
    expect(logger.lines).toEqual([{ level: "info", message: "Swept expired connect attempts", fields: { count: 3 } }]);
    expect(attempts.created).toEqual([
      {
        id: START.id,
        org: "org_acme",
        createdBy: "acc_person",
        person: "acc_person",
        pluginId: "plg_1",
        server: "github",
        createdAt: 1_000,
        expiresAt: 1_091,
      },
    ]);
  });

  it("says nothing when nothing expired, and records no person for none", async () => {
    const attempts = new FakeAttempts(0);
    const logger = recordingLogger();

    await recordConnectAttempt({ connectAttempts: attempts }, logger, { ...START, person: undefined }, 5_000);

    expect(logger.lines).toEqual([]);
    expect(attempts.created[0]?.person).toBe("");
  });
});

describe("endConnectAttempt", () => {
  it("removes the attempt quietly", async () => {
    const logger = recordingLogger();
    await endConnectAttempt({ connectAttempts: new FakeAttempts(0) }, logger, START.id);
    expect(logger.lines).toEqual([]);
  });

  it("logs a failed removal and never throws it", async () => {
    const logger = recordingLogger();

    await endConnectAttempt({ connectAttempts: new FakeAttempts(0, new Error("database gone")) }, logger, START.id);
    await endConnectAttempt({ connectAttempts: new FakeAttempts(0, "socket closed") }, logger, START.id);

    expect(logger.lines).toEqual([
      {
        level: "warn",
        message: "Failed to end a connect attempt (non-fatal; it expires)",
        fields: { execution_id: START.id, error: "database gone" },
      },
      {
        level: "warn",
        message: "Failed to end a connect attempt (non-fatal; it expires)",
        fields: { execution_id: START.id, error: "socket closed" },
      },
    ]);
  });
});
