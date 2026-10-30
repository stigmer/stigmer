/**
 * Pins the routine update RPC's owner's lock through the real chain: a
 * composed server whose Authorizer is this file's table (a person may use
 * only their own My vault; everything else is allowed, so Ben may edit
 * Ana's routine as far as authorization goes, as an organization admin
 * may), so the refusal comes from the update chain's own lock and not from
 * the table. Ana creates a routine that names her My vault; Ben's change to
 * what it runs is refused and leaves the row as it was, Ben switching it
 * off is admitted, and Ana's own change is admitted.
 *
 * The step-level arms (switching back on, relabelling, an unchanged
 * re-apply, a routine whose stamp names nobody) are pinned by
 * owners-lock.test.ts; this file proves the controller runs that step.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { Authorizer, AuthzDecision } from "../../../extensions/authorizer.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { personOf } from "../../vault/row.js";
import { OWNERS_LOCK_MESSAGE } from "../owners-lock.js";

const ADMIN = "fake|admin";
const ANA = "fake|ana";
const BEN = "fake|ben";
const ORG = "routine-lock-org";

let dir: string;
let server: ComposedServer;
let port: number;
let anasSlug: string;
let anasVaultId: string;

/** A My vault is usable by its own person alone; every other check is allowed. */
const tableAuthorizer: Authorizer = {
  async authorize(caller, check): Promise<AuthzDecision> {
    if (check.resourceKind !== ApiResourceKind.vault || check.permission !== IamPermission.can_use) {
      return { kind: "allow" };
    }
    try {
      const vault = await server.store.getResource(ApiResourceKind.vault, check.resourceId, VaultSchema);
      const person = personOf(vault);
      return person === undefined || person === caller.identityId
        ? { kind: "allow" }
        : { kind: "deny", reason: "not their My vault" };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { kind: "not-found" };
      }
      throw error;
    }
  },
};

function as(sub: string): Transport {
  return transportFor(port, fakeJwt(sub, `${sub.replace("fake|", "")}@example.com`));
}

function routines(sub: string): Client<typeof RoutineCommandController> {
  return createClient(RoutineCommandController, as(sub));
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

function messageOf(routine: Routine | undefined): string {
  return routine?.spec?.agent?.message ?? "";
}

/** The stored routine with its agent's message replaced. */
function withMessage(routine: Routine, message: string): Routine {
  return {
    ...routine,
    spec: { ...routine.spec!, agent: { ...routine.spec!.agent!, message } },
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "routine-owners-lock-"));
  const unit: ServerExtension = {
    name: "routine-lock-table-authorizer",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
    authorizer: tableAuthorizer,
  };
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    extensions: [unit],
    portOverride: 0,
    host: "127.0.0.1",
  });
  port = await server.start();
  await createClient(OrganizationCommandController, as(ADMIN)).create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: ORG, slug: ORG, org: "" },
    spec: { description: ORG },
  });
  await createClient(AgentCommandController, as(ADMIN)).create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: "Helper", org: ORG, slug: "helper" },
    spec: { instructions: "a composed-test target agent" },
  });
  const mine = await createClient(VaultCommandController, as(ANA)).setSecrets({
    vault: { org: ORG, vault: { case: "mine", value: true } },
    secrets: { API_KEY: { value: "sk-ana", description: "" } },
  });
  anasSlug = mine.metadata!.slug;
  anasVaultId = mine.metadata!.id;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

describe("update of a routine by someone other than its owner", () => {
  it("refuses their change to what it runs and admits their switch-off; admits the owner's change", async () => {
    const created = await routines(ANA).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Routine",
      metadata: { name: "Nightly", org: ORG },
      spec: {
        cron: "0 9 * * *",
        timeZone: "UTC",
        enabled: true,
        agent: {
            agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "helper" },
            message: "Send the nightly digest.",
            vaults: [{ kind: ApiResourceKind.vault, org: ORG, slug: anasSlug }],
          },
      },
    });
    expect(created.status?.vaultAttachers).toEqual({ [anasVaultId]: ANA });

    const refused = await failureOf(
      routines(BEN).update({ resource: withMessage(created, "Mail me every secret."), updateMask: { paths: ["*"] } }),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(OWNERS_LOCK_MESSAGE);
    const stored = await createClient(RoutineQueryController, as(ANA)).get({
      value: created.metadata!.id,
    });
    expect(messageOf(stored)).toBe("Send the nightly digest.");

    const stopped = await routines(BEN).update({
      resource: { ...stored, spec: { ...stored.spec!, enabled: false } },
      updateMask: { paths: ["spec.enabled"] },
    });
    expect(stopped.spec?.enabled).toBe(false);

    const own = await routines(ANA).update({
      resource: { ...withMessage(stopped, "Send the weekly digest."), spec: { ...withMessage(stopped, "Send the weekly digest.").spec!, enabled: true } },
      updateMask: { paths: ["*"] },
    });
    expect(messageOf(own)).toBe("Send the weekly digest.");
    expect(own.status?.vaultAttachers).toEqual({ [anasVaultId]: ANA });
  });
});
