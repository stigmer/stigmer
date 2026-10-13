/**
 * Pins the guarded write's persist helpers and reads over store doubles,
 * on the arms a composed server does not reach (persist.ts, load-existing.ts,
 * names.ts, store/guarded-port.ts):
 *
 *   - a kind's own persist step with no loaded bytes in context is a server
 *     fault, writing nothing; so is a port's;
 *   - a port's swap that loses is a WRITE_CONFLICT naming the resource, and
 *     a port fault is Internal;
 *   - a push's store swaps on the bytes its find kept, a lost swap is a
 *     WRITE_CONFLICT, a store fault is Internal, and with no row found it
 *     saves as new;
 *   - LoadExisting rethrows a store fault rather than answer NotFound;
 *   - the by-name read for a write answers undefined for a name whose row
 *     is gone, and rethrows any other fault;
 *   - the guarded-port kit holds over a port whose swap answers a typed
 *     outcome, told which outcome landed.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { newPersistMemoryUpdateStep } from "../../../domain/memory/steps.js";
import { guardedPortDeclarations } from "../../../store/guarded-port.js";
import type { GuardedRead, GuardedWritePort } from "../../../store/guarded-port.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { isWriteConflict } from "../../guarded-write.js";
import { RequestContext } from "../../request-context.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  newLoadExistingStep,
} from "../load-existing.js";
import { findResourceByNameForWrite } from "../names.js";
import { storeLoadedOrNew, swapOntoLoadedPortRow } from "../persist.js";

const AGENT_ID = "agt_01aaaaaaaaaaaaaaaaaaaaaaaa";
const ORG = "org_01oooooooooooooooooooooooo";
const LOADED = new Uint8Array([7, 7, 7]);

function agent(): Agent {
  return create(AgentSchema, {
    metadata: { id: AGENT_ID, org: ORG, slug: "helper" },
  });
}

function agentContext(bytes?: Uint8Array): RequestContext<typeof AgentSchema> {
  const ctx = new RequestContext(
    AgentSchema,
    agent(),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  if (bytes !== undefined) {
    ctx.set(EXISTING_RESOURCE_BYTES_KEY, bytes);
  }
  return ctx;
}

async function refusalOf(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

/** A port double: `swap` answers `answer`, or throws it when it is an Error. */
function port(answer: boolean | Error): GuardedWritePort<Agent> {
  return {
    readForWrite: () => Promise.resolve(undefined),
    swap: () =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  };
}

describe("the persist helpers", () => {
  it("a kind's own persist step with no loaded bytes is a server fault, writing nothing", async () => {
    const store = {
      swapResource: () => Promise.reject(new Error("must not write")),
    } as unknown as Store;
    const ctx = new RequestContext(
      MemorySchema,
      create(MemorySchema, { metadata: { id: "mem_1", org: ORG } }),
      testCallerIdentity(),
      ApiResourceKind.memory,
    );
    const fault = await refusalOf(() =>
      Promise.resolve(newPersistMemoryUpdateStep(store).execute(ctx)),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("a port's swap needs the loaded bytes, answers a loss as a WRITE_CONFLICT and a fault as Internal", async () => {
    const unloaded = await refusalOf(() =>
      swapOntoLoadedPortRow(port(true), agentContext()),
    );
    expect(unloaded.code).toBe(Code.Internal);

    const lost = await refusalOf(() =>
      swapOntoLoadedPortRow(port(false), agentContext(LOADED)),
    );
    expect(isWriteConflict(lost)).toBe(true);
    expect(lost.rawMessage).toBe(
      `Agent '${ORG}/helper' kept changing while this update was being saved; try again`,
    );

    const fault = await refusalOf(() =>
      swapOntoLoadedPortRow(port(new Error("port down")), agentContext(LOADED)),
    );
    expect(fault.code).toBe(Code.Internal);

    await expect(
      swapOntoLoadedPortRow(port(true), agentContext(LOADED)),
    ).resolves.toBeUndefined();
  });

  it("a push's store swaps on the bytes its find kept, and saves as new when it found none", async () => {
    const calls: string[] = [];
    const store = (swapped: boolean | Error) =>
      ({
        swapResource: (
          _kind: ApiResourceKind,
          _id: string,
          _schema: unknown,
          expected: Uint8Array,
        ) => {
          calls.push(`swap:${expected.join(",")}`);
          return swapped instanceof Error
            ? Promise.reject(swapped)
            : Promise.resolve(swapped);
        },
        saveResource: () => {
          calls.push("save");
          return Promise.resolve();
        },
      }) as unknown as Store;

    await storeLoadedOrNew(store(true), agentContext(LOADED), AgentSchema, agent());
    await storeLoadedOrNew(store(true), agentContext(), AgentSchema, agent());
    expect(calls).toEqual(["swap:7,7,7", "save"]);

    const lost = await refusalOf(() =>
      storeLoadedOrNew(store(false), agentContext(LOADED), AgentSchema, agent()),
    );
    expect(isWriteConflict(lost)).toBe(true);

    const fault = await refusalOf(() =>
      storeLoadedOrNew(
        store(new Error("disk full")),
        agentContext(LOADED),
        AgentSchema,
        agent(),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("the reads for a write", () => {
  it("LoadExisting rethrows a store fault rather than answer NotFound", async () => {
    const store = {
      readResourceForWrite: () => Promise.reject(new Error("database locked")),
    } as unknown as Store;
    await expect(
      Promise.resolve(newLoadExistingStep(store).execute(agentContext())),
    ).rejects.toThrow("database locked");
  });

  it("the by-name read answers undefined for a name whose row is gone, and rethrows any other fault", async () => {
    const named = (read: () => Promise<never>) =>
      ({
        resourceNames: {
          resolve: () =>
            Promise.resolve({
              kind: "agent",
              org: ORG,
              name: "helper",
              id: AGENT_ID,
              state: "current",
              claimedAt: "",
              expiresAt: "",
            }),
        },
        readResourceForWrite: read,
      }) as unknown as Store;

    expect(
      await findResourceByNameForWrite(
        named(() => Promise.reject(new ResourceNotFoundError("agent"))),
        ApiResourceKind.agent,
        AgentSchema,
        ORG,
        "helper",
      ),
    ).toBeUndefined();
    await expect(
      findResourceByNameForWrite(
        named(() => Promise.reject(new Error("database locked"))),
        ApiResourceKind.agent,
        AgentSchema,
        ORG,
        "helper",
      ),
    ).rejects.toThrow("database locked");
  });
});

describe("the guarded-port kit over a typed-outcome port", () => {
  type Outcome = { readonly kind: "written" } | { readonly kind: "moved" };

  /** An in-memory port whose swap answers a typed outcome. */
  function typedPort(): GuardedWritePort<Agent, Outcome> & {
    insert(row: Agent): void;
    remove(id: string): void;
    get(id: string): Agent | undefined;
  } {
    const rows = new Map<string, Uint8Array>();
    const decode = (bytes: Uint8Array): Agent => fromBinary(AgentSchema, bytes);
    return {
      insert: (row) => rows.set(row.metadata?.id ?? "", toBinary(AgentSchema, row)),
      remove: (id) => rows.delete(id),
      get: (id) => {
        const bytes = rows.get(id);
        return bytes === undefined ? undefined : decode(bytes);
      },
      readForWrite: (id): Promise<GuardedRead<Agent> | undefined> => {
        const bytes = rows.get(id);
        return Promise.resolve(
          bytes === undefined ? undefined : { row: decode(bytes), bytes },
        );
      },
      swap: (id, expectedBytes, next): Promise<Outcome> => {
        const held = rows.get(id);
        if (
          held === undefined ||
          Buffer.compare(Buffer.from(held), Buffer.from(expectedBytes)) !== 0
        ) {
          return Promise.resolve({ kind: "moved" });
        }
        rows.set(id, toBinary(AgentSchema, next));
        return Promise.resolve({ kind: "written" });
      },
    };
  }

  const declarations = guardedPortDeclarations<
    ReturnType<typeof typedPort>,
    Agent,
    Outcome
  >({
    landed: (outcome) => outcome.kind === "written",
    seed: (store) => {
      const row = agent();
      store.insert(row);
      return Promise.resolve(row);
    },
    idOf: (row) => row.metadata?.id ?? "",
    change: (row, value) => {
      if (row.metadata !== undefined) {
        row.metadata.name = value;
      }
    },
    changedValueOf: (row) => row.metadata?.name ?? "",
    interleave: (store, id, value) => {
      const held = store.get(id);
      if (held?.metadata !== undefined) {
        held.metadata.name = value;
        store.insert(held);
      }
      return Promise.resolve();
    },
    read: (store, id) => Promise.resolve(store.get(id)),
    remove: (store, id) => {
      store.remove(id);
      return Promise.resolve();
    },
  });

  // The outage line needs a store that can be cut; this double has none.
  for (const [name, body] of declarations.filter(
    ([name]) => !name.includes("outage"),
  )) {
    it(name, async () => {
      await body({
        store: typedPort(),
        disconnect: () => Promise.resolve(),
        cleanup: () => Promise.resolve(),
      });
    });
  }
});
