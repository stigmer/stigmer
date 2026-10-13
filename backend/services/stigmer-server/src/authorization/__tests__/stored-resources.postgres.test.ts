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
