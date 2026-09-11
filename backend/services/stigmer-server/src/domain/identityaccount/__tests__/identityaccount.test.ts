/**
 * Pins the identity-account domain through a composed OSS server in the
 * trusted-local posture — the behaviours the conformance suite cannot
 * express cross-edition because only open source has this posture
 * (T01_0_plan.md §3a, §5, §10; T01_1_review.md A1, A2):
 *
 *   - a fresh server answers whoAmI with the operator's account before any
 *     client has called anything (A2: the boot-time ensure), and
 *     provisionMyAccount is then the idempotent early return;
 *   - create derives the id from the subject and replaces a caller-supplied
 *     one (the organization precedent); the backend-assigned fields
 *     (is_machine_account, provisioning_mode) ignore what the caller sent;
 *   - a second create for a held subject is ALREADY_EXISTS; two subjects
 *     sharing an email both create — the account's uniqueness is its
 *     subject, never its slug;
 *   - update round-trips preferences (the console's one write) and refuses
 *     a changed subject with FAILED_PRECONDITION (the schedule domain's
 *     immutability shape);
 *   - the byte-pinned NOT_FOUND copy on get / getByEmail / getByIdpId /
 *     whoAmI; getActorInfo names the account;
 *   - the four federation RPCs refuse UNIMPLEMENTED with the edition
 *     reason when no unit composes the capability — never INTERNAL.
 *
 * The OIDC arms (resolve on hit, idp-shaped on miss, provision, then
 * resolve) need a token-bearing caller and live in the conformance suite's
 * OIDC-posture file (Q-IA-10).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE,
  FEDERATION_UNIMPLEMENTED_REASON,
  accountIdFor,
  accountNotFoundMessage,
  idpIdImmutableMessage,
} from "../constants.js";

const OPERATOR_EMAIL = "operator@example.com";
const OPERATOR_NAME = "The Operator";

describe("identityaccount domain (composed server, trusted-local posture)", () => {
  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let command: Client<typeof IdentityAccountCommandController>;
  let query: Client<typeof IdentityAccountQueryController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "identityaccount-domain-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
        STIGMER_OPERATOR_NAME: OPERATOR_NAME,
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    command = createClient(IdentityAccountCommandController, transport);
    query = createClient(IdentityAccountQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  let seq = 0;
  function accountInput(overrides?: {
    id?: string;
    idpId?: string;
    email?: string;
    isMachineAccount?: boolean;
    provisioningMode?: IdentityAccountProvisioningMode;
  }) {
    seq += 1;
    const idpId = overrides?.idpId ?? `auth0|subject${seq}`;
    return {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: {
        ...(overrides?.id !== undefined ? { id: overrides.id } : {}),
        name: overrides?.email ?? `person${seq}@example.com`,
      },
      spec: {
        idpId,
        email: overrides?.email ?? `person${seq}@example.com`,
        firstName: "Test",
        lastName: `Person${seq}`,
        ...(overrides?.isMachineAccount !== undefined
          ? { isMachineAccount: overrides.isMachineAccount }
          : {}),
        ...(overrides?.provisioningMode !== undefined
          ? { provisioningMode: overrides.provisioningMode }
          : {}),
      },
    };
  }

  async function connectErrorOf(
    promise: Promise<unknown>,
  ): Promise<ConnectError> {
    try {
      await promise;
    } catch (error) {
      return ConnectError.from(error);
    }
    throw new Error("expected the call to fail");
  }

  describe("the operator account (A2)", () => {
    it("a fresh server answers whoAmI with the operator before any client called anything", async () => {
      const me = await query.whoAmI({});
      expect(me.metadata?.id).toBe(accountIdFor(`local|${OPERATOR_EMAIL}`));
      expect(me.metadata?.name).toBe(OPERATOR_NAME);
      expect(me.spec?.idpId).toBe(`local|${OPERATOR_EMAIL}`);
      expect(me.spec?.email).toBe(OPERATOR_EMAIL);
      expect(me.spec?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.direct,
      );
      expect(me.spec?.isMachineAccount).toBe(false);
      expect(me.status?.audit?.specAudit?.event).toBe("created");
    });

    it("provisionMyAccount for the operator is the idempotent early return", async () => {
      const me = await query.whoAmI({});
      const before = (
        await server.store.listResources(ApiResourceKind.identity_account)
      ).length;
      const provisioned = await command.provisionMyAccount({});
      expect(provisioned).toEqual(me);
      const after = (
        await server.store.listResources(ApiResourceKind.identity_account)
      ).length;
      expect(after).toBe(before);
    });

    it("update round-trips preferences — the console's one write — and whoAmI reflects it", async () => {
      const me = await query.whoAmI({});
      const updated = await command.update({
        ...me,
        spec: {
          ...me.spec,
          preferences: {
            defaultHarness: "cursor",
            defaultCursorModel: "gpt-5",
          },
        },
      });
      expect(updated.spec?.preferences?.defaultHarness).toBe("cursor");
      const again = await query.whoAmI({});
      expect(again.spec?.preferences).toMatchObject({
        defaultHarness: "cursor",
        defaultCursorModel: "gpt-5",
      });
      expect(again.metadata?.id).toBe(me.metadata?.id);
    });
  });

  describe("create (A1)", () => {
    it("derives the id from the subject and replaces a caller-supplied id", async () => {
      const created = await command.create(
        accountInput({
          id: "ida_01hzzzzzzzzzzzzzzzzzzzzzzz",
          idpId: "auth0|derive-me",
        }),
      );
      expect(created.metadata?.id).toBe(accountIdFor("auth0|derive-me"));
      expect(created.status?.audit?.specAudit?.event).toBe("created");
      const fetched = await query.get({ value: created.metadata?.id ?? "" });
      expect(fetched.spec?.idpId).toBe("auth0|derive-me");
    });

    it("the backend assigns is_machine_account and provisioning_mode, whatever the caller sent", async () => {
      const person = await command.create(
        accountInput({
          idpId: "auth0|human",
          isMachineAccount: true,
          provisioningMode: IdentityAccountProvisioningMode.federated,
        }),
      );
      expect(person.spec?.isMachineAccount).toBe(false);
      expect(person.spec?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.direct,
      );

      const machine = await command.create(
        accountInput({
          idpId: "svc123@clients",
          email: "",
          isMachineAccount: false,
        }),
      );
      expect(machine.spec?.isMachineAccount).toBe(true);
      expect(machine.spec?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.direct,
      );
    });

    it("a second create for a held subject is ALREADY_EXISTS and the first row stands", async () => {
      const first = await command.create(
        accountInput({ idpId: "auth0|held", email: "first@example.com" }),
      );
      const error = await connectErrorOf(
        command.create(
          accountInput({ idpId: "auth0|held", email: "second@example.com" }),
        ),
      );
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toContain("auth0|held");
      const fetched = await query.get({ value: first.metadata?.id ?? "" });
      expect(fetched.spec?.email).toBe("first@example.com");
    });

    it("two subjects sharing an email both create — uniqueness is the subject, never the slug", async () => {
      const a = await command.create(
        accountInput({ idpId: "auth0|shared-a", email: "shared@example.com" }),
      );
      const b = await command.create(
        accountInput({ idpId: "auth0|shared-b", email: "shared@example.com" }),
      );
      expect(a.metadata?.id).not.toBe(b.metadata?.id);
    });

    it("a create without a subject is INVALID_ARGUMENT — the proto's required field", async () => {
      const error = await connectErrorOf(
        command.create(accountInput({ idpId: "" })),
      );
      expect(error.code).toBe(Code.InvalidArgument);
    });
  });

  describe("update (A1)", () => {
    it("refuses a changed subject with FAILED_PRECONDITION and the fixed copy", async () => {
      const created = await command.create(
        accountInput({ idpId: "auth0|immutable" }),
      );
      const error = await connectErrorOf(
        command.update({
          ...created,
          spec: { ...created.spec, idpId: "auth0|someone-else" },
        }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(idpIdImmutableMessage("auth0|immutable"));
      const fetched = await query.get({ value: created.metadata?.id ?? "" });
      expect(fetched.spec?.idpId).toBe("auth0|immutable");
    });

    it("keeps the backend-assigned fields on update too", async () => {
      const created = await command.create(
        accountInput({ idpId: "auth0|keep" }),
      );
      const updated = await command.update({
        ...created,
        spec: {
          ...created.spec,
          firstName: "Edited",
          isMachineAccount: true,
          provisioningMode: IdentityAccountProvisioningMode.platform_client,
        },
      });
      expect(updated.spec?.firstName).toBe("Edited");
      expect(updated.spec?.isMachineAccount).toBe(false);
      expect(updated.spec?.provisioningMode).toBe(
        IdentityAccountProvisioningMode.direct,
      );
    });
  });

  describe("reads and their byte-pinned copy", () => {
    it("get / getByEmail / getByIdpId answer the cloud's NOT_FOUND sentences", async () => {
      const byId = await connectErrorOf(
        query.get({ value: "ida_00000000000000000000000000" }),
      );
      expect(byId.code).toBe(Code.NotFound);
      expect(byId.rawMessage).toBe(
        accountNotFoundMessage("ida_00000000000000000000000000"),
      );

      const byEmail = await connectErrorOf(
        query.getByEmail({ value: "nobody@example.com" }),
      );
      expect(byEmail.code).toBe(Code.NotFound);
      expect(byEmail.rawMessage).toBe(
        accountNotFoundMessage("nobody@example.com"),
      );

      const byIdpId = await connectErrorOf(
        query.getByIdpId({ value: "auth0|nobody" }),
      );
      expect(byIdpId.code).toBe(Code.NotFound);
      expect(byIdpId.rawMessage).toBe(accountNotFoundMessage("auth0|nobody"));
    });

    it("getByEmail and getByIdpId find what create wrote", async () => {
      const created = await command.create(
        accountInput({
          idpId: "auth0|findable",
          email: "findable@example.com",
        }),
      );
      expect(
        (await query.getByEmail({ value: "findable@example.com" })).metadata
          ?.id,
      ).toBe(created.metadata?.id);
      expect(
        (await query.getByIdpId({ value: "auth0|findable" })).metadata?.id,
      ).toBe(created.metadata?.id);
    });

    it("getActorInfo names the account the way audit stamps do", async () => {
      const created = await command.create(
        accountInput({ idpId: "auth0|actor", email: "actor@example.com" }),
      );
      const actor = await query.getActorInfo({
        value: created.metadata?.id ?? "",
      });
      expect(actor.id).toBe(created.metadata?.id);
      expect(actor.email).toBe("actor@example.com");
    });

    it("the whoAmI copy is the cloud's sentence (asserted through the constant the handler throws)", () => {
      expect(ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE).toBe(
        "Identity account not found for the authenticated user",
      );
    });
  });

  describe("delete", () => {
    it("returns the account and frees the subject", async () => {
      const created = await command.create(
        accountInput({ idpId: "auth0|deletable" }),
      );
      const deleted = await command.delete({
        value: created.metadata?.id ?? "",
      });
      expect(deleted.metadata?.id).toBe(created.metadata?.id);
      const error = await connectErrorOf(
        query.get({ value: created.metadata?.id ?? "" }),
      );
      expect(error.code).toBe(Code.NotFound);
      const recreated = await command.create(
        accountInput({ idpId: "auth0|deletable" }),
      );
      expect(recreated.metadata?.id).toBe(created.metadata?.id);
    });
  });

  describe("the federation capability, absent (Q-IA-9, §5)", () => {
    it.each([
      ["createFederatedAccount", () => command.createFederatedAccount({})],
      ["updateFederatedAccount", () => command.updateFederatedAccount({})],
      [
        "deprovisionFederatedAccount",
        () => command.deprovisionFederatedAccount({}),
      ],
      ["getByExternalSub", () => query.getByExternalSub({})],
    ] as const)(
      "%s refuses UNIMPLEMENTED with the edition reason, never INTERNAL",
      async (name, call) => {
        const error = await connectErrorOf(call());
        expect(error.code).toBe(Code.Unimplemented);
        expect(error.rawMessage).toContain(
          `.${name} is not implemented: ${FEDERATION_UNIMPLEMENTED_REASON}`,
        );
      },
    );
  });
});
