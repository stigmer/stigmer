/**
 * Pins memory's double opt-in and its subject at the composition root
 * (stigmer#1387), over a real boot under the BUILT-IN posture (a unit that
 * declares require-authentication and registers no Authorizer — the
 * open-source self-host with sign-in), with two signed-in people on the
 * wire:
 *
 *   - Carol founds an organization with memory on. With her own switch
 *     still off (the default), her capture is refused with the account
 *     copy — before this fix it was stored, filed under nobody.
 *   - Once she turns her own switch on, her capture is filed under HER
 *     account id, she can read and confirm it (the model's subject tuple
 *     names her), and Dave, a member of the same organization, can
 *     neither read it nor see it listed: memory is subject-only.
 *   - Dave, whose own switch is off, is refused exactly as Carol was.
 *
 * Recall is not driven here: an execution create needs an engine, and the
 * recall step runs after the engine check. Its gates are pinned
 * step-for-step in domain/agentexecution/__tests__/create-steps.test.ts,
 * over the same identity-account reads this boot composes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemoryQueryController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/query_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  IdentityAccountPreferencesSchema,
  IdentityAccountSpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { MEMORY_ACCOUNT_DISABLED_MESSAGE } from "../constants.js";

const CAROL = "fake|carol";
const DAVE = "fake|dave";
const ORG = "memory-person-org";

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

function memoryInput(content: string) {
  return create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: { org: ORG },
    spec: { content },
  });
}

describe("memory where callers are persons (built-in posture, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let carolAccount: IdentityAccount;

  const asCarol = () => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = () => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "memory-person-consent-composed-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    // Carol provisions and founds the organization with memory on; Dave
    // provisions afterwards and is a member of it (the membership rules
    // run at a person's first provisioning).
    carolAccount = await createClient(
      IdentityAccountCommandController,
      asCarol(),
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, asCarol()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG, preferences: { memoryEnabled: true } },
    });
    await createClient(
      IdentityAccountCommandController,
      asDave(),
    ).provisionMyAccount({});
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a person whose own switch is off, with the account's copy", async () => {
    const failure = await failureOf(
      createClient(MemoryCommandController, asCarol()).create(
        memoryInput("Carol prefers OpenTofu."),
      ),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(MEMORY_ACCOUNT_DISABLED_MESSAGE);
  });

  it("files the fact under the person once they opt in, and it stays theirs alone", async () => {
    const carolId = carolAccount.metadata?.id ?? "";
    expect(carolId).not.toBe("");
    const optedIn = clone(IdentityAccountSchema, carolAccount);
    optedIn.spec ??= create(IdentityAccountSpecSchema);
    optedIn.spec.preferences ??= create(IdentityAccountPreferencesSchema);
    optedIn.spec.preferences.memoryEnabled = true;
    await createClient(IdentityAccountCommandController, asCarol()).update(
      optedIn,
    );

    const carolMemories = createClient(MemoryCommandController, asCarol());
    const created = await carolMemories.create(
      memoryInput("Carol prefers OpenTofu."),
    );
    const memoryId = created.metadata?.id ?? "";
    expect(created.spec?.subjectIdentityAccountId).toBe(carolId);

    // The subject tuple names Carol: she decides on her own memory.
    const confirmed = await carolMemories.confirm({ value: memoryId });
    expect(confirmed.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );
    const carolReads = createClient(MemoryQueryController, asCarol());
    expect((await carolReads.get({ value: memoryId })).metadata?.id).toBe(
      memoryId,
    );
    expect(
      (await carolReads.list({ org: ORG })).items.map((m) => m.metadata?.id),
    ).toContain(memoryId);

    // Dave shares the organization, not the memory.
    const daveReads = createClient(MemoryQueryController, asDave());
    const failure = await failureOf(daveReads.get({ value: memoryId }));
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(
      (await daveReads.list({ org: ORG })).items.map((m) => m.metadata?.id),
    ).not.toContain(memoryId);
  });

  it("refuses the second person exactly as the first, while their switch is off", async () => {
    const failure = await failureOf(
      createClient(MemoryCommandController, asDave()).create(
        memoryInput("Dave deploys on Fridays."),
      ),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(MEMORY_ACCOUNT_DISABLED_MESSAGE);
  });
});
