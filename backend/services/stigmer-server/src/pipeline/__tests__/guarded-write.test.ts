/**
 * Pins the guarded write's retry budget and what it retries
 * (pipeline/guarded-write.ts):
 *   - runGuardedWrite runs an attempt that lands once, retries a lost
 *     compare-and-swap, and lets the third conflict reach the caller as it
 *     was thrown: ABORTED, reason WRITE_CONFLICT, the message naming the
 *     kind and its org/slug;
 *   - an ABORTED without the reason, and any other error, reaches the
 *     caller from the first attempt, never retried;
 *   - isWriteConflict answers true only for ABORTED carrying the reason in
 *     the server's error domain;
 *   - changeThroughGuardedPort re-applies the change on each fresh read,
 *     answers the stored row when a swap lands, answers undefined for a
 *     missing row, and over a row that always moves answers ABORTED
 *     WRITE_CONFLICT after exactly GUARDED_WRITE_ATTEMPTS reads.
 * The per-kind races, where a write lands inside a composed update chain,
 * live beside each domain.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import type { GuardedRead, GuardedWritePort } from "../../store/guarded-port.js";
import { abortedError, ERROR_REASON_DOMAIN } from "../errors.js";
import {
  changeThroughGuardedPort,
  GUARDED_WRITE_ATTEMPTS,
  isWriteConflict,
  runGuardedWrite,
  WRITE_CONFLICT_REASON,
  writeConflictError,
} from "../guarded-write.js";

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
}

function expectWriteConflict(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(ConnectError);
  const conflict = error as ConnectError;
  expect(conflict.code).toBe(Code.Aborted);
  expect(conflict.rawMessage).toBe(message);
  const [info] = conflict.findDetails(ErrorInfoSchema);
  expect(info?.reason).toBe(WRITE_CONFLICT_REASON);
  expect(info?.domain).toBe(ERROR_REASON_DOMAIN);
}

describe("runGuardedWrite", () => {
  it("runs an attempt that lands once", async () => {
    let attempts = 0;
    const result = await runGuardedWrite(() => {
      attempts += 1;
      return Promise.resolve("landed");
    });
    expect(result).toBe("landed");
    expect(attempts).toBe(1);
  });

  it("retries a lost swap and answers the attempt that lands", async () => {
    let attempts = 0;
    const result = await runGuardedWrite(() => {
      attempts += 1;
      return attempts < GUARDED_WRITE_ATTEMPTS
        ? Promise.reject(
            writeConflictError(ApiResourceKind.agent, "org_acme", "helper"),
          )
        : Promise.resolve(attempts);
    });
    expect(result).toBe(GUARDED_WRITE_ATTEMPTS);
    expect(attempts).toBe(GUARDED_WRITE_ATTEMPTS);
  });

  it("lets the third conflict reach the caller unchanged", async () => {
    let attempts = 0;
    const thrown: ConnectError[] = [];
    const error = await failureOf(
      runGuardedWrite(() => {
        attempts += 1;
        const conflict = writeConflictError(
          ApiResourceKind.agent,
          "org_acme",
          "helper",
        );
        thrown.push(conflict);
        return Promise.reject(conflict);
      }),
    );
    expect(GUARDED_WRITE_ATTEMPTS).toBe(3);
    expect(attempts).toBe(3);
    expect(error).toBe(thrown[2]);
    expectWriteConflict(
      error,
      "Agent 'org_acme/helper' kept changing while this update was being saved; try again",
    );
  });

  it("names a kind owned by no organization by its slug alone", () => {
    expectWriteConflict(
      writeConflictError(ApiResourceKind.organization, "", "acme"),
      "Organization 'acme' kept changing while this update was being saved; try again",
    );
  });

  it("never retries an ABORTED without the reason", async () => {
    let attempts = 0;
    const aborted = abortedError("the run moved on");
    const error = await failureOf(
      runGuardedWrite(() => {
        attempts += 1;
        return Promise.reject(aborted);
      }),
    );
    expect(error).toBe(aborted);
    expect(attempts).toBe(1);
  });

  it("never retries any other error", async () => {
    for (const failure of [
      new ConnectError("no such agent", Code.NotFound),
      new Error("the store is down"),
    ]) {
      let attempts = 0;
      const error = await failureOf(
        runGuardedWrite(() => {
          attempts += 1;
          return Promise.reject(failure);
        }),
      );
      expect(error).toBe(failure);
      expect(attempts).toBe(1);
    }
  });
});

describe("isWriteConflict", () => {
  it("answers true only for ABORTED carrying WRITE_CONFLICT", () => {
    expect(
      isWriteConflict(writeConflictError(ApiResourceKind.run, "org_acme", "r")),
    ).toBe(true);
    expect(isWriteConflict(abortedError("moved on"))).toBe(false);
    expect(
      isWriteConflict(abortedError("moved on", { reason: "RUN_TERMINAL" })),
    ).toBe(false);
    expect(
      isWriteConflict(
        new ConnectError("conflict", Code.Aborted, undefined, [
          {
            desc: ErrorInfoSchema,
            value: create(ErrorInfoSchema, {
              reason: WRITE_CONFLICT_REASON,
              domain: "example.com",
            }),
          },
        ]),
      ),
    ).toBe(false);
    expect(
      isWriteConflict(new ConnectError("conflict", Code.FailedPrecondition)),
    ).toBe(false);
    expect(isWriteConflict(new Error(WRITE_CONFLICT_REASON))).toBe(false);
    expect(isWriteConflict(undefined)).toBe(false);
  });
});

interface FakeRow {
  metadata: { org: string; slug: string };
  value: string;
  generation: number;
}

/**
 * A port over one row kept as JSON bytes. `moveBeforeSwap` lands a write
 * (the generation bumped) between every read and the swap after it.
 */
class FakeGuardedPort implements GuardedWritePort<FakeRow> {
  stored: Uint8Array | undefined;
  reads = 0;
  swaps = 0;

  constructor(
    row: FakeRow | undefined,
    private readonly moveBeforeSwap: boolean,
  ) {
    this.stored = row === undefined ? undefined : encode(row);
  }

  readForWrite(id: string): Promise<GuardedRead<FakeRow> | undefined> {
    this.reads += 1;
    if (id !== "row_1" || this.stored === undefined) {
      return Promise.resolve(undefined);
    }
    const bytes = this.stored;
    return Promise.resolve({ row: decode(bytes), bytes });
  }

  swap(id: string, expectedBytes: Uint8Array, next: FakeRow): Promise<boolean> {
    this.swaps += 1;
    if (id !== "row_1" || this.stored === undefined) {
      return Promise.resolve(false);
    }
    if (this.moveBeforeSwap) {
      const moved = decode(this.stored);
      moved.generation += 1;
      this.stored = encode(moved);
    }
    if (Buffer.compare(this.stored, expectedBytes) !== 0) {
      return Promise.resolve(false);
    }
    this.stored = encode(next);
    return Promise.resolve(true);
  }

  current(): FakeRow | undefined {
    return this.stored === undefined ? undefined : decode(this.stored);
  }
}

function encode(row: FakeRow): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(row));
}

function decode(bytes: Uint8Array): FakeRow {
  return JSON.parse(new TextDecoder().decode(bytes)) as FakeRow;
}

function seededRow(): FakeRow {
  return {
    metadata: { org: "org_acme", slug: "provider" },
    value: "before",
    generation: 0,
  };
}

describe("changeThroughGuardedPort", () => {
  it("applies the change to the row it read and answers the stored row", async () => {
    const port = new FakeGuardedPort(seededRow(), false);
    const stored = await changeThroughGuardedPort(
      port,
      ApiResourceKind.federation_issuer,
      "row_1",
      (row) => {
        row.value = "after";
      },
    );
    expect(stored?.value).toBe("after");
    expect(port.current()?.value).toBe("after");
    expect(port.reads).toBe(1);
    expect(port.swaps).toBe(1);
  });

  it("answers ABORTED WRITE_CONFLICT after exactly GUARDED_WRITE_ATTEMPTS reads of a row that always moves, re-applying the change on each fresh read", async () => {
    const port = new FakeGuardedPort(seededRow(), true);
    const changedGenerations: number[] = [];
    const error = await failureOf(
      changeThroughGuardedPort(
        port,
        ApiResourceKind.federation_issuer,
        "row_1",
        (row) => {
          changedGenerations.push(row.generation);
          row.value = "after";
        },
      ),
    );
    expect(port.reads).toBe(GUARDED_WRITE_ATTEMPTS);
    expect(port.swaps).toBe(GUARDED_WRITE_ATTEMPTS);
    // Each attempt changed the row as it stood after the previous move.
    expect(changedGenerations).toEqual([0, 1, 2]);
    expectWriteConflict(
      error,
      "Federation issuer 'org_acme/provider' kept changing while this update was being saved; try again",
    );
    // Every move survived; the change never landed.
    expect(port.current()).toEqual({ ...seededRow(), generation: 3 });
  });

  it("answers undefined for a missing row, changing and swapping nothing", async () => {
    const port = new FakeGuardedPort(undefined, false);
    let changes = 0;
    const stored = await changeThroughGuardedPort(
      port,
      ApiResourceKind.federation_issuer,
      "row_1",
      () => {
        changes += 1;
      },
    );
    expect(stored).toBeUndefined();
    expect(changes).toBe(0);
    expect(port.swaps).toBe(0);
  });
});
