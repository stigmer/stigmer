/**
 * Pins the credential last-use rule (credential-use.ts):
 *   - staleness is measured against the stored stamp, a never-used
 *     credential is stale, and exactly one resolution is stale again;
 *   - the stamp only moves forward, and a write bumps the status audit's
 *     updated_at + event while keeping who created the slot;
 *   - recordCredentialUse writes only when stale, treats a row deleted
 *     meanwhile as nothing to record, and logs any other failure without
 *     throwing.
 */
import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  ApiResourceAuditActorSchema,
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { createLogger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import {
  LAST_USED_RESOLUTION_MS,
  lastUseIsStale,
  recordCredentialUse,
  stampLastUsed,
  type CredentialUseStatus,
} from "../credential-use.js";

const NOW = new Date("2026-09-28T12:00:00Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function capturingLogger(): {
  lines: string[];
  logger: ReturnType<typeof createLogger>;
} {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({
      level: "debug",
      pretty: false,
      write: (line) => lines.push(line),
    }),
  };
}

describe("lastUseIsStale", () => {
  it("is stale for a credential never used", () => {
    expect(lastUseIsStale(undefined, NOW)).toBe(true);
  });

  it("is fresh inside one resolution and stale from exactly one resolution on", () => {
    const justInside = timestampFromDate(ago(LAST_USED_RESOLUTION_MS - 1));
    const exactly = timestampFromDate(ago(LAST_USED_RESOLUTION_MS));
    expect(lastUseIsStale(justInside, NOW)).toBe(false);
    expect(lastUseIsStale(exactly, NOW)).toBe(true);
  });

  it("is fresh for a stamp ahead of this replica's clock", () => {
    expect(lastUseIsStale(timestampFromDate(new Date(NOW.getTime() + 5_000)), NOW)).toBe(false);
  });
});

describe("stampLastUsed", () => {
  it("stamps a never-used status and bumps the status audit", () => {
    const status: CredentialUseStatus = {};
    expect(stampLastUsed(status, NOW)).toBe(true);
    expect(timestampDate(status.lastUsedAt!)).toEqual(NOW);
    expect(status.audit?.statusAudit?.event).toBe("updated");
    expect(status.audit?.statusAudit?.updatedAt).toBeDefined();
  });

  it("keeps who created the status-audit slot and never touches the spec audit", () => {
    const createdBy = create(ApiResourceAuditActorSchema, { id: "ida_creator" });
    const createdAt = timestampFromDate(ago(86_400_000));
    const specAudit = create(ApiResourceAuditInfoSchema, { createdBy, createdAt, event: "created" });
    const priorSlot = create(ApiResourceAuditInfoSchema, { createdBy, createdAt, event: "created" });
    const status: CredentialUseStatus = {
      audit: create(ApiResourceAuditSchema, { specAudit, statusAudit: priorSlot }),
    };

    stampLastUsed(status, NOW);

    expect(status.audit?.statusAudit?.createdBy?.id).toBe("ida_creator");
    expect(status.audit?.statusAudit?.createdAt).toEqual(createdAt);
    expect(status.audit?.statusAudit?.event).toBe("updated");
    expect(status.audit?.specAudit).toBe(specAudit);
    expect(priorSlot.event, "a new slot is set, the old one is not mutated").toBe("created");
  });

  it("only moves forward: a stamp at or after the use is kept, audit untouched", () => {
    const later = timestampFromDate(new Date(NOW.getTime() + 1_000));
    const status: CredentialUseStatus = { lastUsedAt: later };
    expect(stampLastUsed(status, NOW)).toBe(false);
    expect(status.lastUsedAt).toBe(later);
    expect(status.audit).toBeUndefined();

    const same = timestampFromDate(NOW);
    const atSameInstant: CredentialUseStatus = { lastUsedAt: same };
    expect(stampLastUsed(atSameInstant, NOW)).toBe(false);
  });
});

describe("recordCredentialUse", () => {
  function use(overrides: {
    lastUsedAt?: Date;
    write: (stamp: (status: CredentialUseStatus) => void) => Promise<unknown>;
    logger?: ReturnType<typeof createLogger>;
  }) {
    return {
      credential: "api key",
      id: "key_1",
      lastUsedAt:
        overrides.lastUsedAt === undefined ? undefined : timestampFromDate(overrides.lastUsedAt),
      now: NOW,
      logger: overrides.logger ?? capturingLogger().logger,
      write: overrides.write,
    };
  }

  it("writes the stamp through the kind's atomic write when stale", async () => {
    const row: CredentialUseStatus = {};
    let writes = 0;
    await recordCredentialUse(
      use({
        write: async (stamp) => {
          writes += 1;
          stamp(row);
        },
      }),
    );
    expect(writes).toBe(1);
    expect(timestampDate(row.lastUsedAt!)).toEqual(NOW);
  });

  it("does not write inside the resolution", async () => {
    let writes = 0;
    await recordCredentialUse(
      use({
        lastUsedAt: ago(LAST_USED_RESOLUTION_MS / 2),
        write: async () => {
          writes += 1;
        },
      }),
    );
    expect(writes).toBe(0);
  });

  it("treats a row deleted meanwhile as nothing to record, silently", async () => {
    const { lines, logger } = capturingLogger();
    await recordCredentialUse(
      use({
        logger,
        write: async () => {
          throw new ResourceNotFoundError("api_key/key_1");
        },
      }),
    );
    expect(lines).toEqual([]);
  });

  it("logs any other failure with the credential id and never throws", async () => {
    const { lines, logger } = capturingLogger();
    await expect(
      recordCredentialUse(
        use({
          logger,
          write: async () => {
            throw new Error("database unavailable");
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.level).toBe("warn");
    expect(entry.credential).toBe("api key");
    expect(entry.id).toBe("key_1");
    expect(entry.error).toBe("database unavailable");
  });
});
