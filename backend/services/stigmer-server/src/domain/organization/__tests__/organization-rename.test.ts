/**
 * Pins the rename chain's own steps (rename.ts) over store doubles, on the
 * arms a composed server cannot reach in order: the serving chain refuses a
 * missing organization before the rename's loader runs, and a store fault
 * needs a store that faults.
 *
 *   - the loader answers NotFound for an organization no row holds, and
 *     Internal for a store fault;
 *   - the slug step refuses a row with no id or slug as a server fault;
 *     takes a slug whose holder is gone by releasing it and moving again;
 *     refuses a slug a live organization holds; and answers Internal when
 *     the name table faults, leaving the row untouched;
 *   - re-indexing skips a row it cannot index and logs a failed write
 *     without failing the rename.
 *
 * The happy paths and the move back after a failed row write are proven
 * through a composed server in organization-names.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  ResourceNameClaim,
  ResourceNameEntry,
  ResourceNameRename,
  Store,
} from "../../../store/interface.js";
import { ABANDONED_NAME_AFTER_MS, organizationNameKey } from "../names.js";
import {
  RENAMED_ORGANIZATION_KEY,
  newIndexOrganizationAfterRenameStep,
  newLoadOrganizationForRenameStep,
  newPersistRenamedOrganizationStep,
  newRenameOrganizationSlugStep,
} from "../rename.js";

const ACME = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GONE = "org_01jggggggggggggggggggggggg";

function renameRequest(organization?: Organization) {
  const ctx = new RequestContext(
    RenameInputSchema,
    create(RenameInputSchema, { resourceId: ACME, slug: "acme-corp" }),
    testCallerIdentity(),
  );
  if (organization !== undefined) {
    ctx.set(RENAMED_ORGANIZATION_KEY, organization);
  }
  return ctx;
}

function acme(): Organization {
  return create(OrganizationSchema, { metadata: { id: ACME, slug: "acme" } });
}

async function refusalOf(run: () => Promise<void> | void): Promise<ConnectError> {
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

/** An entry `org` holds `slug` by, claimed `ageMs` ago. */
function heldBy(org: string, slug: string, ageMs: number): ResourceNameEntry {
  return {
    ...organizationNameKey(slug),
    id: org,
    state: "current",
    claimedAt: new Date(Date.now() - ageMs).toISOString(),
    expiresAt: "",
  };
}

describe("LoadOrganizationForRename", () => {
  it("answers NotFound for an organization no row holds, and Internal for a store fault", async () => {
    const missing = {
      getResource: async () => {
        throw new ResourceNotFoundError("organization");
      },
    } as unknown as Store;
    const notFound = await refusalOf(() =>
      newLoadOrganizationForRenameStep(missing).execute(renameRequest()),
    );
    expect(notFound.code).toBe(Code.NotFound);
    expect(notFound.rawMessage).toBe(`Organization not found: ${ACME}`);

    const faulting = {
      getResource: async () => {
        throw new Error("database locked");
      },
    } as unknown as Store;
    const fault = await refusalOf(() =>
      newLoadOrganizationForRenameStep(faulting).execute(renameRequest()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to load organization");
  });
});

describe("RenameOrganizationSlug", () => {
  it("refuses a row with no id or slug as a server fault, moving no name", async () => {
    const rename = vi.fn();
    const store = { resourceNames: { rename, current: async () => undefined } } as unknown as Store;
    const noSlug = create(OrganizationSchema, { metadata: { id: ACME } });

    const fault = await refusalOf(() =>
      newRenameOrganizationSlugStep(store).execute(renameRequest(noSlug)),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(rename).not.toHaveBeenCalled();
  });

  it("moves from the name the table holds as current, not a row a failed settle left behind", async () => {
    const entry = (name: string): ResourceNameEntry => ({
      ...organizationNameKey(name),
      id: ACME,
      state: "current",
      claimedAt: new Date().toISOString(),
      expiresAt: "",
    });
    const moves: ResourceNameRename[] = [];
    const behind = {
      resourceNames: {
        current: async () => entry("acme-new"),
        rename: async (move: ResourceNameRename) => {
          moves.push(move);
          return { claimed: true, entry: entry(move.to) };
        },
      },
    } as unknown as Store;
    // The row still says acme-corp; the table moved on to acme-new: renaming
    // back to acme-corp is a real move.
    await newRenameOrganizationSlugStep(behind).execute(
      renameRequest(create(OrganizationSchema, { metadata: { id: ACME, slug: "acme-corp" } })),
    );
    expect(moves.map((move) => [move.from, move.to])).toEqual([["acme-new", "acme-corp"]]);

    // The table already holds the requested name: nothing moves, and the
    // organization answered carries it.
    const settled = create(OrganizationSchema, { metadata: { id: ACME, slug: "acme" } });
    const already = {
      resourceNames: { current: async () => entry("acme-corp"), rename: vi.fn() },
    } as unknown as Store;
    await newRenameOrganizationSlugStep(already).execute(renameRequest(settled));
    expect(settled.metadata?.slug).toBe("acme-corp");

    const faulting = {
      resourceNames: {
        current: async () => {
          throw new Error("database locked");
        },
      },
    } as unknown as Store;
    const fault = await refusalOf(() => newRenameOrganizationSlugStep(faulting).execute(renameRequest(acme())));
    expect(fault.code).toBe(Code.Internal);
  });

  it("takes a slug whose holder is gone: releases the holder's names and moves again", async () => {
    const released: string[] = [];
    const moves: ResourceNameRename[] = [];
    const store = {
      // The holder's organization row is gone.
      getResource: async () => {
        throw new ResourceNotFoundError("organization");
      },
      resourceNames: {
        current: async () => undefined,
        rename: async (move: ResourceNameRename): Promise<ResourceNameClaim> => {
          moves.push(move);
          return released.length === 0
            ? {
                claimed: false,
                entry: heldBy(GONE, move.to, ABANDONED_NAME_AFTER_MS + 1000),
              }
            : {
                claimed: true,
                entry: { ...heldBy(ACME, move.to, 0), claimedAt: move.now },
              };
        },
        release: async (_kind: string, _org: string, id: string) => {
          released.push(id);
        },
      },
    } as unknown as Store;

    const ctx = renameRequest(acme());
    await newRenameOrganizationSlugStep(store).execute(ctx);

    expect(released).toEqual([GONE]);
    expect(moves).toHaveLength(2);
    expect(moves[1]).toEqual(moves[0]);
    const renamed = ctx.get(RENAMED_ORGANIZATION_KEY) as Organization;
    expect(renamed.metadata?.slug).toBe("acme-corp");
  });

  it("refuses a slug a live organization holds, releasing nothing", async () => {
    const release = vi.fn();
    const store = {
      getResource: async () => create(OrganizationSchema),
      resourceNames: {
        current: async () => undefined,
        rename: async (move: ResourceNameRename): Promise<ResourceNameClaim> => ({
          claimed: false,
          entry: heldBy("org_01jhhhhhhhhhhhhhhhhhhhhhhh", move.to, ABANDONED_NAME_AFTER_MS + 1000),
        }),
        release,
      },
    } as unknown as Store;

    const ctx = renameRequest(acme());
    const refusal = await refusalOf(() =>
      newRenameOrganizationSlugStep(store).execute(ctx),
    );
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe("Organization already exists: slug 'acme-corp'");
    expect(release).not.toHaveBeenCalled();
    expect((ctx.get(RENAMED_ORGANIZATION_KEY) as Organization).metadata?.slug).toBe(
      "acme",
    );
  });

  it("answers Internal when the name table faults, and leaves the row's slug and nothing to persist", async () => {
    const store = {
      resourceNames: {
        current: async () => undefined,
        rename: async () => {
          throw new Error("database locked");
        },
      },
      saveResource: vi.fn(),
    } as unknown as Store;

    const ctx = renameRequest(acme());
    const fault = await refusalOf(() =>
      newRenameOrganizationSlugStep(store).execute(ctx),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to rename the organization");
    expect((ctx.get(RENAMED_ORGANIZATION_KEY) as Organization).metadata?.slug).toBe(
      "acme",
    );

    // With no move recorded, the write that follows has nothing to do.
    await newPersistRenamedOrganizationStep(store, recordingLogger()).execute(ctx);
    expect(store.saveResource).not.toHaveBeenCalled();
  });
});

describe("IndexOrganizationAfterRename", () => {
  /** A request whose slug step moved acme's names, over a store that records the index write. */
  async function movedRequest(upsertSearchIndex: Store["upsertSearchIndex"]) {
    const store = {
      resourceNames: {
        current: async () => undefined,
        rename: async (move: ResourceNameRename): Promise<ResourceNameClaim> => ({
          claimed: true,
          entry: { ...heldBy(ACME, move.to, 0), claimedAt: move.now },
        }),
      },
      upsertSearchIndex,
    } as unknown as Store;
    const ctx = renameRequest(acme());
    await newRenameOrganizationSlugStep(store).execute(ctx);
    return { store, ctx };
  }

  it("indexes the renamed organization by its id", async () => {
    const upsert = vi.fn(async (_kind: unknown, _id: string) => {});
    const { store, ctx } = await movedRequest(upsert);
    await newIndexOrganizationAfterRenameStep(store, recordingLogger()).execute(ctx);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[1]).toBe(ACME);
  });

  it("logs a failed index write without failing the rename", async () => {
    const { store, ctx } = await movedRequest(async () => {
      throw new Error("index unavailable");
    });
    const logger = recordingLogger();
    await newIndexOrganizationAfterRenameStep(store, logger).execute(ctx);
    expect(logger.warnings).toEqual([
      "IndexOrganizationAfterRename: failed (best-effort)",
    ]);
  });

  it("skips a row it cannot index, one with no metadata", async () => {
    const upsert = vi.fn(async () => {});
    const { store, ctx } = await movedRequest(upsert);
    // The step reads the row the chain carries; one without metadata has
    // no index entry, so there is nothing to write.
    ctx.set(RENAMED_ORGANIZATION_KEY, create(OrganizationSchema));
    await newIndexOrganizationAfterRenameStep(store, recordingLogger()).execute(ctx);
    expect(upsert).not.toHaveBeenCalled();
  });
});
