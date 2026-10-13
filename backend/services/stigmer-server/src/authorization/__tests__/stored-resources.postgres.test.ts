/**
 * Pins the grant path's two reads of a stored resource's own row
 * (authorization/stored-resources.ts) over both store drivers:
 *
 *   - organizationOf answers the row's `metadata.org`: the organization a
 *     change record falls back to when a delete already removed the
 *     resource's scope links (stigmer#1603). It answers "" for a row the
 *     store does not hold (deleted, or a kind a composition keeps in its
 *     own table), for a kind name no kind has, and for an account, which is
 *     no organization's resource.
 *   - creatorOf answers the row's recorded creator, the removal sweep's
 *     authorship read, and undefined on the same misses.
 *   - A store fault is neither: both reads raise it, so a grant or revoke
 *     that needed the row fails as the fault it is, and never records an
 *     organization it could not read.
 *   - A kind a unit keeps in its own table is read through the unit's row
 *     reader, never the store (a team's organization, which a move inside
 *     the organization needs to find its memberships).
 *   - authoredIn answers what an account made in an organization, the rows
 *     a move grants the target as owner: every kind whose owner is its
 *     creator, the account's stamp by its id or by the raw subject rows
 *     stamped before 3.15.0 carry, and nothing another account made, nothing
 *     in another organization, nothing of a kind a unit keeps itself.
 *
 * Postgres is skipped without `TEST_DATABASE_URL` (drivers.ts); the gate
 * provides it.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

import type { Store } from "../../store/interface.js";
import { newStoredResources } from "../stored-resources.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";

const AGENT = "agt_stored0000000000000000000";
const SESSION = "ses_stored0000000000000000000";
const ACCOUNT = "ida_stored0000000000000000000";
const CREATOR = "ida_creator000000000000000000";

describe.each(
  driverFixtures([
    ApiResourceKind.agent,
    ApiResourceKind.session,
    ApiResourceKind.identity_account,
  ]),
)("StoredResources over the $name store", (fixture) => {
  let opened: OpenedStore;

  beforeEach(async (context) => {
    if (fixture.skip) {
      context.skip("no TEST_DATABASE_URL: the gate provides Postgres");
    }
    opened = await fixture.open();
    await opened.store.saveResource(
      ApiResourceKind.agent,
      AGENT,
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: AGENT, name: "stored agent", org: "acme" },
        status: { audit: { specAudit: { createdBy: { id: CREATOR } } } },
      }),
    );
    await opened.store.saveResource(
      ApiResourceKind.session,
      SESSION,
      SessionSchema,
      create(SessionSchema, {
        metadata: { id: SESSION, name: "stored session", org: "globex" },
      }),
    );
    await opened.store.saveResource(
      ApiResourceKind.identity_account,
      ACCOUNT,
      IdentityAccountSchema,
      create(IdentityAccountSchema, {
        metadata: { id: ACCOUNT, name: "stored account", org: "acme" },
        status: { audit: { specAudit: { createdBy: { id: CREATOR } } } },
      }),
    );
  });

  afterEach(async () => {
    await opened?.close();
  });

  afterAll(async () => {
    await dropPostgresFixture();
  });

  it("organizationOf answers the stored row's organization", async () => {
    const resources = newStoredResources(opened.store);
    expect(await resources.organizationOf("agent", AGENT)).toBe("acme");
    expect(await resources.organizationOf("session", SESSION)).toBe("globex");
  });

  it("reads a kind a unit keeps itself through the unit's reader", async () => {
    const team = create(TeamSchema, {
      metadata: { id: "tm_sre", org: "acme" },
      status: { audit: { specAudit: { createdBy: { id: "ida_bob" } } } },
    });
    const resources = newStoredResources(
      opened.store,
      new Map([
        [
          ApiResourceKind.team,
          { findById: (id: string) => Promise.resolve(id === "tm_sre" ? team : undefined) },
        ],
      ]),
    );
    expect(await resources.organizationOf("team", "tm_sre")).toBe("acme");
    expect(await resources.creatorOf("team", "tm_sre")).toBe("ida_bob");
    expect(await resources.organizationOf("team", "tm_gone")).toBe("");
    // Without the unit's reader the store holds no row of it to read.
    expect(await newStoredResources(opened.store).organizationOf("team", "tm_sre")).toBe("");
    // A kind the model binds no schema to, with no reader, is read nowhere.
    expect(await newStoredResources(opened.store).organizationOf("plan", "pln_team")).toBe("");
  });

  it("organizationOf answers no organization for a row it may not or cannot read", async () => {
    const resources = newStoredResources(opened.store);
    for (const [kind, id, why] of [
      [
        "agent",
        "agt_never_stored000000000000",
        "a row the store does not hold",
      ],
      [
        "identity_account",
        ACCOUNT,
        "an account, which is no organization's resource",
      ],
      ["no_such_kind", AGENT, "a kind name no kind has"],
      ["agent", "", "an empty id"],
    ] as const) {
      expect(await resources.organizationOf(kind, id), why).toBe("");
    }
  });

  it("creatorOf answers the stored row's recorded creator, and nothing on the same misses", async () => {
    const resources = newStoredResources(opened.store);
    expect(await resources.creatorOf("agent", AGENT)).toBe(CREATOR);
    expect(
      await resources.creatorOf("agent", "agt_never_stored000000000000"),
    ).toBeUndefined();
    expect(
      await resources.creatorOf("identity_account", ACCOUNT),
    ).toBeUndefined();
  });
});

describe.each(
  driverFixtures([ApiResourceKind.agent, ApiResourceKind.session]),
)("StoredResources.authoredIn over the $name store", (fixture) => {
  let opened: OpenedStore;
  const MINE = "ses_authoredmine0000000000000";
  const OLD_STAMP = "ses_authoredold00000000000000";
  const THEIRS = "ses_authoredtheirs00000000000";
  const FAR = "ses_authoredfar00000000000000";
  const AGENT_MINE = "agt_authoredmine0000000000000";
  const SUBJECT = "auth0|creator";
  const accounts = {
    findById: (id: string) =>
      Promise.resolve(id === CREATOR ? create(IdentityAccountSchema, { metadata: { id: CREATOR } }) : undefined),
    findDirectByIdpId: (idpId: string) =>
      Promise.resolve(idpId === SUBJECT ? create(IdentityAccountSchema, { metadata: { id: CREATOR } }) : undefined),
  };

  beforeEach(async (context) => {
    if (fixture.skip) {
      context.skip("no TEST_DATABASE_URL: the gate provides Postgres");
    }
    opened = await fixture.open();
    const stamped = (stamp: string) => ({ audit: { specAudit: { createdBy: { id: stamp } } } });
    for (const [id, org, stamp] of [
      [MINE, "acme", CREATOR],
      [OLD_STAMP, "acme", SUBJECT],
      [THEIRS, "acme", "ida_someoneelse0000000000000"],
      [FAR, "globex", CREATOR],
    ] as const) {
      await opened.store.saveResource(
        ApiResourceKind.session,
        id,
        SessionSchema,
        create(SessionSchema, { metadata: { id, org }, status: stamped(stamp) }),
      );
    }
    await opened.store.saveResource(
      ApiResourceKind.agent,
      AGENT_MINE,
      AgentSchema,
      create(AgentSchema, { metadata: { id: AGENT_MINE, org: "acme" }, status: stamped(CREATOR) }),
    );
  });

  afterEach(async () => {
    await opened?.close();
  });

  afterAll(async () => {
    await dropPostgresFixture();
  });

  const refs = (found: ReadonlyArray<{ kind: string; id: string }>) =>
    found.map((ref) => `${ref.kind}:${ref.id}`).sort();

  it("answers what the account made in the organization, by its id or its old subject stamp", async () => {
    const resources = newStoredResources(opened.store, undefined, accounts);
    expect(refs(await resources.authoredIn("acme", CREATOR))).toEqual(
      [`agent:${AGENT_MINE}`, `session:${MINE}`, `session:${OLD_STAMP}`].sort(),
    );
    expect(refs(await resources.authoredIn("globex", CREATOR))).toEqual([`session:${FAR}`]);
  });

  it("matches only the account's own id without the account port, and nothing for an empty organization or account", async () => {
    const resources = newStoredResources(opened.store);
    expect(refs(await resources.authoredIn("acme", CREATOR))).toEqual(
      [`agent:${AGENT_MINE}`, `session:${MINE}`].sort(),
    );
    expect(await resources.authoredIn("", CREATOR)).toEqual([]);
    expect(await resources.authoredIn("acme", "")).toEqual([]);
  });

  it("leaves out a kind a unit keeps itself", async () => {
    const resources = newStoredResources(
      opened.store,
      new Map([[ApiResourceKind.agent, { findById: () => Promise.resolve(undefined) }]]),
      accounts,
    );
    expect(refs(await resources.authoredIn("acme", CREATOR))).toEqual(
      [`session:${MINE}`, `session:${OLD_STAMP}`].sort(),
    );
  });
});

describe("StoredResources over a failing store", () => {
  it("raises a store fault from both reads instead of answering a miss", async () => {
    const fault = new Error("the store is unreachable");
    const failing = {
      getResource: () => Promise.reject(fault),
    } as unknown as Store;
    const resources = newStoredResources(failing);
    await expect(resources.organizationOf("agent", AGENT)).rejects.toBe(fault);
    await expect(resources.creatorOf("agent", AGENT)).rejects.toBe(fault);
  });
});
