/**
 * Pins the rename chain's steps (rename.ts) and an update's Persist
 * (persist.ts) over store doubles, on the arms a composed server does not
 * reach in order: a store fault answers Internal and moves nothing; a row
 * with no id or slug is a server fault; a row gone between the load and
 * the write answers NotFound and moves the names back; an update's Persist
 * swaps on the bytes its load kept and answers a lost swap as a
 * WRITE_CONFLICT naming the resource; a failed move back
 * is logged; a port's rows hold their names while the port finds them; and
 * the write lookup answers nothing for an id it does not hold and no slug.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameRename,
  Store,
} from "../../../store/interface.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../load-existing.js";
import { findResourceForWrite } from "../names.js";
import type { NameTable } from "../names.js";
import { isWriteConflict } from "../../guarded-write.js";
import { newPersistStep } from "../persist.js";
import {
  RENAMED_RESOURCE_KEY,
  newLoadForRenameStep,
  newPersistRenamedStep,
  newRenameNameStep,
  portRenameRows,
  storeRenameRows,
} from "../rename.js";
import type { RenameRows } from "../rename.js";

const AGENT_ID = "agt_01aaaaaaaaaaaaaaaaaaaaaaaa";
const ORG = "org_01oooooooooooooooooooooooo";

function agent(slug = "helper", id = AGENT_ID): Agent {
  return create(AgentSchema, { metadata: { id, org: ORG, slug } });
}

function renameRequest(loaded?: Agent) {
  const ctx = new RequestContext(
    RenameInputSchema,
    create(RenameInputSchema, { resourceId: AGENT_ID, slug: "helper-renamed" }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  if (loaded !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, loaded);
  }
  return ctx;
}

async function refusalOf(
  run: () => Promise<void> | void,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the step to fail");
}

function recordingLogger(): Logger & { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    error: (message: string) => errors.push(message),
    warn: (message: string) => warnings.push(message),
    info: () => {},
    debug: () => {},
  } as unknown as Logger & { errors: string[]; warnings: string[] };
}

/** A name table that records moves and reverts; `rename` and `current` may fault. */
function names(
  options: {
    currentFails?: boolean;
    renameFails?: boolean;
    revertFails?: boolean;
    /** The current name `current` answers once a move happened: a later rename's. */
    currentAfterMove?: string;
    /** `current` faults once a move happened. */
    currentFailsAfterMove?: boolean;
  } = {},
) {
  const moves: ResourceNameRename[] = [];
  const reverted: ResourceNameRename[] = [];
  const table: NameTable = {
    resourceNames: {
      current: async (kind: string, org: string, id: string) => {
        if (options.currentFails === true) {
          throw new Error("names unavailable");
        }
        if (moves.length > 0 && options.currentFailsAfterMove === true) {
          throw new Error("names unavailable");
        }
        if (moves.length > 0 && options.currentAfterMove !== undefined) {
          const entry: ResourceNameEntry = {
            kind,
            org,
            name: options.currentAfterMove,
            id,
            state: "current",
            claimedAt: "",
            expiresAt: "",
          };
          return entry;
        }
        return undefined;
      },
      rename: async (move: ResourceNameRename) => {
        if (options.renameFails === true) {
          throw new Error("names unavailable");
        }
        moves.push(move);
        const entry: ResourceNameEntry = {
          kind: move.kind,
          org: move.org,
          name: move.to,
          id: move.id,
          state: "current",
          claimedAt: move.now,
          expiresAt: "",
        };
        return { claimed: true, entry };
      },
      revertRename: async (move: ResourceNameRename) => {
        if (options.revertFails === true) {
          throw new Error("names unavailable");
        }
        reverted.push(move);
      },
    },
  } as unknown as NameTable;
  return { table, moves, reverted };
}

/** Rows a test controls: what `find` and `modify` answer. */
function rows(options: {
  find?: () => Promise<Agent | undefined>;
  modify?: () => Promise<Agent | undefined>;
}): RenameRows<typeof AgentSchema> {
  return {
    schema: AgentSchema,
    find: options.find ?? (async () => agent()),
    modify: options.modify ?? (async () => agent("helper-renamed")),
    holder: { holds: async () => true },
  };
}

describe("storeRenameRows", () => {
  it("reads a missing row as undefined and rethrows any other store fault, for the read and the write", async () => {
    const missing = {
      getResource: async () => {
        throw new ResourceNotFoundError("agent");
      },
      updateResource: async () => {
        throw new ResourceNotFoundError("agent");
      },
    } as unknown as Store;
    const gone = storeRenameRows(missing, ApiResourceKind.agent, AgentSchema);
    expect(await gone.find(AGENT_ID)).toBeUndefined();
    expect(await gone.modify(AGENT_ID, () => {})).toBeUndefined();

    const fault = new Error("disk full");
    const faulting = {
      getResource: async () => {
        throw fault;
      },
      updateResource: async () => {
        throw fault;
      },
    } as unknown as Store;
    const broken = storeRenameRows(
      faulting,
      ApiResourceKind.agent,
      AgentSchema,
    );
    await expect(broken.find(AGENT_ID)).rejects.toBe(fault);
    await expect(broken.modify(AGENT_ID, () => {})).rejects.toBe(fault);
  });
});

describe("portRenameRows", () => {
  it("reads and writes through the port, and a name's holder holds it while the port finds its row", async () => {
    const held = new Map<string, Agent>([[AGENT_ID, agent()]]);
    const port = portRenameRows(AgentSchema, {
      findById: async (id: string) => held.get(id),
      modifyById: async (id: string, modify: (row: Agent) => void) => {
        const row = held.get(id);
        if (row !== undefined) {
          modify(row);
        }
        return row;
      },
    });
    const entry = (id: string): ResourceNameEntry => ({
      kind: "agent",
      org: ORG,
      name: "helper",
      id,
      state: "current",
      claimedAt: "",
      expiresAt: "",
    });
    expect(await port.holder.holds(entry(AGENT_ID))).toBe(true);
    expect(
      await port.holder.holds(entry("agt_01gonegonegonegonegonegone")),
    ).toBe(false);
    const written = await port.modify(AGENT_ID, (row) => {
      if (row.metadata !== undefined) {
        row.metadata.slug = "moved";
      }
    });
    expect(written?.metadata?.slug).toBe("moved");
    expect((await port.find(AGENT_ID))?.metadata?.slug).toBe("moved");
  });
});

describe("LoadForRename", () => {
  it("answers Internal for a store fault and NotFound, naming the id, for a missing row", async () => {
    const fault = await refusalOf(() =>
      newLoadForRenameStep(
        rows({
          find: async () => {
            throw new Error("disk full");
          },
        }),
      ).execute(renameRequest()),
    );
    expect(fault.code).toBe(Code.Internal);

    const missing = await refusalOf(() =>
      newLoadForRenameStep(rows({ find: async () => undefined })).execute(
        renameRequest(),
      ),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(`Agent not found: ${AGENT_ID}`);
  });
});

describe("RenameName", () => {
  it("refuses a row with no id or slug as a server fault, moving nothing", async () => {
    const { table, moves } = names();
    const fault = await refusalOf(() =>
      newRenameNameStep(table, rows({})).execute(renameRequest(agent(""))),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(moves).toEqual([]);
  });

  it("answers Internal when the table cannot say the current name, or cannot move it", async () => {
    for (const options of [{ currentFails: true }, { renameFails: true }]) {
      const { table, moves } = names(options);
      const fault = await refusalOf(() =>
        newRenameNameStep(table, rows({})).execute(renameRequest(agent())),
      );
      expect(fault.code).toBe(Code.Internal);
      expect(moves).toEqual([]);
    }
  });
});

describe("PersistRenamed", () => {
  async function renamed(
    table: NameTable,
    renameRows: RenameRows<typeof AgentSchema>,
  ) {
    const ctx = renameRequest(agent());
    await newRenameNameStep(table, renameRows).execute(ctx);
    return ctx;
  }

  it("answers NotFound and moves the names back when the row is gone before the write", async () => {
    const { table, moves, reverted } = names();
    const gone = rows({ modify: async () => undefined });
    const ctx = await renamed(table, gone);
    const missing = await refusalOf(() =>
      newPersistRenamedStep(table, gone, recordingLogger()).execute(ctx),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(`Agent not found: ${AGENT_ID}`);
    expect(reverted).toEqual(moves);
    expect(ctx.get(RENAMED_RESOURCE_KEY)).toBeUndefined();
  });

  it("logs a move back that fails, and still answers the write's fault", async () => {
    const { table } = names({ revertFails: true });
    const faulting = rows({
      modify: async () => {
        throw new Error("disk full");
      },
    });
    const ctx = await renamed(table, faulting);
    const logger = recordingLogger();
    const fault = await refusalOf(() =>
      newPersistRenamedStep(table, faulting, logger).execute(ctx),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(logger.errors).toEqual([
      "rename failed and its names could not be moved back; both slugs lead to the resource until a retry",
    ]);
  });
});

describe("PersistRenamed's settle on the table", () => {
  /** Rows whose writes apply the step's modify to one held agent, counting them. */
  function heldRows() {
    const held = agent();
    const writes: string[] = [];
    const renameRows: RenameRows<typeof AgentSchema> = {
      schema: AgentSchema,
      find: async () => held,
      modify: async (_id, modify) => {
        modify(held);
        writes.push(held.metadata?.slug ?? "");
        return held;
      },
      holder: { holds: async () => true },
    };
    return { renameRows, writes };
  }

  it("writes the row once more when a later rename moved the table past this one", async () => {
    const { table } = names({ currentAfterMove: "helper-later" });
    const { renameRows, writes } = heldRows();
    const ctx = renameRequest(agent());
    await newRenameNameStep(table, renameRows).execute(ctx);
    await newPersistRenamedStep(table, renameRows, recordingLogger()).execute(
      ctx,
    );
    expect(writes).toEqual(["helper-renamed", "helper-later"]);
    expect((ctx.get(RENAMED_RESOURCE_KEY) as Agent).metadata?.slug).toBe(
      "helper-later",
    );
  });

  it("logs a settle that cannot read the table, and answers the row as written", async () => {
    const { table } = names({ currentFailsAfterMove: true });
    const { renameRows, writes } = heldRows();
    const ctx = renameRequest(agent());
    const logger = recordingLogger();
    await newRenameNameStep(table, renameRows).execute(ctx);
    await newPersistRenamedStep(table, renameRows, logger).execute(ctx);
    expect(writes).toEqual(["helper-renamed"]);
    expect((ctx.get(RENAMED_RESOURCE_KEY) as Agent).metadata?.slug).toBe(
      "helper-renamed",
    );
    expect(logger.warnings).toEqual([
      "renamed row may lag its current name; the next rename settles it",
    ]);
  });
});

describe("Persist by compare-and-swap on the loaded row", () => {
  const LOADED = new Uint8Array([1, 2, 3]);

  function updateRequest(id: string) {
    const ctx = new RequestContext(
      AgentSchema,
      agent("helper", id),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    ctx.set(EXISTING_RESOURCE_BYTES_KEY, LOADED);
    return ctx;
  }

  it("refuses a state with no id as a server fault, writing nothing", async () => {
    const store = {
      swapResource: async () => {
        throw new Error("must not write");
      },
    } as unknown as Store;
    const fault = await refusalOf(() =>
      newPersistStep<typeof AgentSchema>(store).execute(updateRequest("")),
    );
    expect(fault.code).toBe(Code.Internal);
  });

  it("swaps on the bytes the load kept, and a lost swap is a WRITE_CONFLICT naming the resource", async () => {
    const compared: Uint8Array[] = [];
    const moved = {
      swapResource: async (
        _kind: ApiResourceKind,
        _id: string,
        _schema: unknown,
        expected: Uint8Array,
      ) => {
        compared.push(expected);
        return false;
      },
    } as unknown as Store;
    const conflict = await refusalOf(() =>
      newPersistStep<typeof AgentSchema>(moved).execute(
        updateRequest(AGENT_ID),
      ),
    );
    expect(compared).toEqual([LOADED]);
    expect(conflict.code).toBe(Code.Aborted);
    expect(isWriteConflict(conflict)).toBe(true);
    expect(conflict.rawMessage).toBe(
      `Agent '${ORG}/helper' kept changing while this update was being saved; try again`,
    );
  });

  it("answers Internal for a store fault on the swap", async () => {
    const broken = {
      swapResource: async () => {
        throw new Error("disk full");
      },
    } as unknown as Store;
    const fault = await refusalOf(() =>
      newPersistStep<typeof AgentSchema>(broken).execute(
        updateRequest(AGENT_ID),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("findResourceForWrite", () => {
  it("answers nothing for an id it does not hold when the request names no slug, reading no name", async () => {
    const table = {
      resourceNames: {
        resolve: async () => {
          throw new Error("must not read a name");
        },
      },
    } as unknown as NameTable;
    expect(
      await findResourceForWrite<typeof AgentSchema>(
        table,
        ApiResourceKind.agent,
        { id: AGENT_ID, org: ORG, slug: "" },
        async () => undefined,
      ),
    ).toBeUndefined();
  });
});
