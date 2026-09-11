/**
 * Pins the identity-account registry points END TO END (20260911.11
 * Q-IA-9, S2 slice 3): a composed server with a fake unit, probed over the
 * wire — transport → registered handler → the compose.ts wiring → the
 * point. The registry's own merge rules are identity-account-points.test.ts;
 * this file proves compose CONSUMES what the registry resolved, which is
 * the arm a revert of the wiring would pass silently without.
 *
 * Three composed servers, one per describe, because a unit that registers
 * into a slot the build does not declare makes resolveExtensions throw at
 * boot (the §2b loud-fail contract): the slot gets its own server, so the
 * driver and federation arms stay red for THEIR reasons while the slot is
 * still undeclared.
 *
 *   (A) trusted-local posture + the store driver + the federation
 *       capability + a selective Authorizer: the boot-time operator ensure,
 *       whoAmI and an in-process create all go through the REGISTERED
 *       driver and the generic store never holds an account; the four
 *       federated RPCs reach the unit's arm with the resolved ref, and the
 *       controller's shared preconditions (ref-with-slug, org match,
 *       authorize BEFORE the IdP-exists probe, IdP not found) refuse with
 *       the recorded codes and copy.
 *   (B) a unit-declared require-authentication posture + the unit's own
 *       verifier + the store driver — the cloud composition's exact shape:
 *       provisionMyAccount lands the row in the driver, and an API key the
 *       subject minted resolves through the OSS API-key lane to the
 *       driver's account. This is the lane the cloud actually runs over its
 *       driver; an OSS adapter over the cloud's generic store would miss
 *       every lookup and no other test would notice.
 *   (C) the same posture and verifier + the provision slot registered by
 *       two units: first provisioning persists the row THEN fires the gates
 *       with the caller re-stamped as the account; the idempotent second
 *       call fires them again (the backfill Q-IA-9 chose a slot for); an
 *       in-process create never fires them; a throwing gate fails the
 *       request and the row survives; unit order holds.
 *
 * The registered driver is the REAL OSS adapter over a SECOND SqliteStore
 * behind a call recorder, so the proof of consumption is WHERE the rows
 * land, and the pair under test is one that runs in production. The fake
 * verifier of (B) and (C) vouches for an unsigned JWT-shaped token with no
 * issuer: idpIdOf reads the `sub` from the raw token and the provisioner
 * takes the identity's own claims when there is no issuer, so a real first
 * provisioning runs with no network. The OSS OIDC verifier over a driver is
 * deliberately NOT composed here: no real composition has that shape (a
 * driver implies a composition with its own verifiers), and the verifier's
 * resolution is pinned by identity/__tests__/oidc-verifier.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../pipeline/steps/defaults.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";
import { SqliteStore } from "../../store/sqlite/store.js";
import type { Authorizer } from "../authorizer.js";
import type { GateSlotName } from "../gate-slots.js";
import type { CallerIdentity, IdentityVerifier } from "../identity.js";
import type { IdentityFederation } from "../identity-federation.js";
import type { ServerExtension } from "../registry.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

/** The port's eight methods, delegating to the real adapter and recording each call by name. */
function recordingStore(
  inner: IdentityAccountStore,
  calls: string[],
): IdentityAccountStore {
  return {
    save: (account) => {
      calls.push("save");
      return inner.save(account);
    },
    update: (account) => {
      calls.push("update");
      return inner.update(account);
    },
    deleteById: (id) => {
      calls.push("deleteById");
      return inner.deleteById(id);
    },
    findById: (id) => {
      calls.push("findById");
      return inner.findById(id);
    },
    findByIdpId: (idpId) => {
      calls.push("findByIdpId");
      return inner.findByIdpId(idpId);
    },
    findDirectByIdpId: (idpId) => {
      calls.push("findDirectByIdpId");
      return inner.findDirectByIdpId(idpId);
    },
    findDirectByEmail: (email) => {
      calls.push("findDirectByEmail");
      return inner.findDirectByEmail(email);
    },
    findByIds: (ids) => {
      calls.push("findByIds");
      return inner.findByIds(ids);
    },
  };
}

/** The driver a unit registers: the real adapter over its OWN store, recorded. */
interface RegisteredDriver {
  readonly store: SqliteStore;
  readonly accounts: IdentityAccountStore;
  readonly calls: string[];
}

function openDriver(dir: string): RegisteredDriver {
  const store = SqliteStore.open(path.join(dir, "driver.db"), silentLogger);
  const calls: string[] = [];
  return {
    store,
    accounts: recordingStore(newResourceIdentityAccountStore(store), calls),
    calls,
  };
}

/** The account ids a store holds — the one observation that says WHERE a row landed. */
async function accountIdsIn(store: Store): Promise<ReadonlyArray<string>> {
  const rows = await store.listResources(ApiResourceKind.identity_account);
  return rows.map(
    (row) => fromBinary(IdentityAccountSchema, row).metadata?.id ?? "",
  );
}

/**
 * An unsigned JWT-shaped token (`header.payload.unsigned`): the fake
 * verifier below vouches for it, and idpIdOf reads its `sub` exactly as it
 * reads a real token's — the signature was the verifier's business.
 */
function fakeJwt(sub: string, email: string): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none" })}.${segment({ sub, email })}.unsigned`;
}

/**
 * The composition's own verifier (the cloud's shape): admits the fake
 * token as a `user` whose identityId is the raw subject and whose issuer is
 * empty — it does NOT resolve to an account, exactly like a verifier that
 * runs before any row exists. Passes on everything else, so the OSS API-key
 * lane composed ahead of it keeps its claim.
 */
const fakeVerifier: IdentityVerifier = {
  name: "fake-composition-verifier",
  verify: (token) => {
    const segments = token.split(".");
    if (segments.length !== 3 || segments[2] !== "unsigned") {
      return Promise.resolve(null);
    }
    const claims = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: unknown; email?: unknown };
    if (typeof claims.sub !== "string") {
      return Promise.resolve(null);
    }
    const identity: CallerIdentity = {
      identityId: claims.sub,
      callerClass: "user",
      issuer: "",
      rawToken: token,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    };
    return Promise.resolve(identity);
  },
};

function bearer(token: string): Interceptor {
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    return next(request);
  };
}

function transportFor(port: number, token?: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: token !== undefined ? [bearer(token)] : [],
  });
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

let seq = 0;
function accountInput(idpId: string) {
  seq += 1;
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { name: `person${seq}@example.com` },
    spec: {
      idpId,
      email: `person${seq}@example.com`,
      firstName: "Composed",
      lastName: `Person${seq}`,
    },
  };
}

function baseConfig(dir: string): Record<string, string> {
  return {
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    DB_PATH: path.join(dir, "stigmer.db"),
    STORAGE_PATH: path.join(dir, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
  };
}

// ---------------------------------------------------------------------------
// (A) trusted-local: the store driver, the federation capability
// ---------------------------------------------------------------------------

describe("identity-account points (composed server, trusted-local: driver + federation)", () => {
  const OPERATOR_EMAIL = "operator@example.com";
  const LOCKED_ORG = "locked-org";
  let dir: string;
  let server: ComposedServer;
  let driver: RegisteredDriver;
  let command: Client<typeof IdentityAccountCommandController>;
  let query: Client<typeof IdentityAccountQueryController>;
  let platform: Client<typeof IdentityAccountCommandController>;

  interface ArmCall {
    readonly method: string;
    readonly refOrg: string;
    readonly refSlug: string;
    readonly callerIdentityId: string;
  }
  const armCalls: ArmCall[] = [];
  let providerExistsCalls = 0;
  let providerExists = true;

  const federatedAccount = (method: string): IdentityAccount =>
    create(IdentityAccountSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { id: `ida_federated_${method}`, name: method },
      spec: { idpId: "okta|1", email: "person@example.com" },
    });

  const arm =
    (method: string) =>
    (
      _input: unknown,
      ref: ApiResourceReference,
      caller: CallerIdentity,
    ): Promise<IdentityAccount> => {
      armCalls.push({
        method,
        refOrg: ref.org,
        refSlug: ref.slug,
        callerIdentityId: caller.identityId,
      });
      return Promise.resolve(federatedAccount(method));
    };

  const fakeFederation: IdentityFederation = {
    createFederatedAccount: arm("createFederatedAccount"),
    updateFederatedAccount: arm("updateFederatedAccount"),
    deprovisionFederatedAccount: arm("deprovisionFederatedAccount"),
    getByExternalSub: arm("getByExternalSub"),
    providerExists: () => {
      providerExistsCalls += 1;
      return Promise.resolve(providerExists);
    },
  };

  /**
   * Allows everything except the four federated RPCs' one annotation
   * (organization / can_create_identity_account / field_path "org") on
   * ONE org, so no other chain in the composed server is disturbed.
   */
  const selectiveAuthorizer: Authorizer = {
    authorize: (_caller, check) =>
      Promise.resolve(
        check.resourceKind === ApiResourceKind.organization &&
          check.permission === IamPermission.can_create_identity_account &&
          check.resourceId === LOCKED_ORG
          ? { kind: "deny", reason: "the fake authorizer locks this org" }
          : { kind: "allow" },
      ),
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "identity-account-composed-a-"));
    driver = openDriver(dir);
    const unit: ServerExtension = {
      name: "fake-iam",
      authorizer: selectiveAuthorizer,
      drivers: {
        identityAccountStore: driver.accounts,
        identityFederation: fakeFederation,
      },
    };
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await composeServer({
      config: loadConfig({
        ...baseConfig(dir),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
        STIGMER_OPERATOR_NAME: "The Operator",
      }),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport = transportFor(port);
    command = createClient(IdentityAccountCommandController, transport);
    query = createClient(IdentityAccountQueryController, transport);
    platform = createClient(
      IdentityAccountCommandController,
      server.inProcessTransport,
    );
  });

  afterAll(async () => {
    await server.shutdown();
    await driver.store.close();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("the store driver is the domain's persistence", () => {
    it("the boot-time operator ensure wrote through the registered driver, and the generic store holds no account", async () => {
      expect(driver.calls).toContain("save");
      expect(await accountIdsIn(driver.store)).toEqual([
        accountIdFor(`local|${OPERATOR_EMAIL}`),
      ]);
      expect(await accountIdsIn(server.store)).toEqual([]);
    });

    it("whoAmI reads through the driver", async () => {
      driver.calls.length = 0;
      const me = await query.whoAmI({});
      expect(me.metadata?.id).toBe(accountIdFor(`local|${OPERATOR_EMAIL}`));
      expect(driver.calls).toContain("findById");
    });

    it("an in-process create writes through the driver — the row lands in the driver's store, not the generic one", async () => {
      const created = await platform.create(accountInput("auth0|via-driver"));
      expect(created.metadata?.id).toBe(accountIdFor("auth0|via-driver"));
      expect(await accountIdsIn(driver.store)).toContain(
        accountIdFor("auth0|via-driver"),
      );
      expect(await accountIdsIn(server.store)).toEqual([]);
    });
  });

  describe("the federation capability, present", () => {
    // Inputs that pass the boundary validator (refinement 6), so every
    // refusal below is the HANDLER's. `slug` is required by the
    // reference's own rules; `org` on the reference may be empty.
    const ref = { org: "acme", slug: "okta" };

    it.each([
      [
        "createFederatedAccount",
        (org: string, providerRef: { org: string; slug: string }) =>
          command.createFederatedAccount({
            org,
            identityProviderRef: providerRef,
            externalSub: "okta|1",
            email: "person@example.com",
          }),
      ],
      [
        "updateFederatedAccount",
        (org: string, providerRef: { org: string; slug: string }) =>
          command.updateFederatedAccount({
            org,
            identityProviderRef: providerRef,
            externalSub: "okta|1",
            email: "person@example.com",
          }),
      ],
      [
        "deprovisionFederatedAccount",
        (org: string, providerRef: { org: string; slug: string }) =>
          command.deprovisionFederatedAccount({
            org,
            identityProviderRef: providerRef,
            externalSub: "okta|1",
          }),
      ],
      [
        "getByExternalSub",
        (org: string, providerRef: { org: string; slug: string }) =>
          query.getByExternalSub({
            org,
            identityProviderRef: providerRef,
            externalSub: "okta|1",
          }),
      ],
    ] as const)(
      "%s dispatches to the unit's arm with the resolved ref and the caller",
      async (name, call) => {
        armCalls.length = 0;
        const answer = await call("acme", ref);
        expect(answer.metadata?.id).toBe(`ida_federated_${name}`);
        expect(armCalls).toEqual([
          {
            method: name,
            refOrg: "acme",
            refSlug: "okta",
            callerIdentityId: accountIdFor(`local|${OPERATOR_EMAIL}`),
          },
        ]);
      },
    );

    it("a reference that names no org is resolved to the input's org before the arm sees it", async () => {
      armCalls.length = 0;
      await command.createFederatedAccount({
        org: "acme",
        identityProviderRef: { slug: "okta" },
        externalSub: "okta|2",
        email: "person@example.com",
      });
      expect(armCalls[0]?.refOrg).toBe("acme");
    });

    it("a missing reference is INVALID_ARGUMENT from the handler — the arm is never reached", async () => {
      armCalls.length = 0;
      const error = await connectErrorOf(
        command.createFederatedAccount({
          org: "acme",
          externalSub: "okta|3",
          email: "person@example.com",
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        "identity_provider_ref with a valid slug is required",
      );
      expect(armCalls).toEqual([]);
    });

    it("a reference whose org disagrees with the input's is INVALID_ARGUMENT naming both", async () => {
      armCalls.length = 0;
      const error = await connectErrorOf(
        command.createFederatedAccount({
          org: "acme",
          identityProviderRef: { org: "rival", slug: "okta" },
          externalSub: "okta|4",
          email: "person@example.com",
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        "identity_provider_ref.org 'rival' does not match input org 'acme'",
      );
      expect(armCalls).toEqual([]);
    });

    it("an identity provider the unit does not know is NOT_FOUND naming org/slug — the arm is never reached", async () => {
      armCalls.length = 0;
      providerExists = false;
      try {
        const error = await connectErrorOf(
          query.getByExternalSub({
            org: "acme",
            identityProviderRef: { org: "acme", slug: "unknown-idp" },
            externalSub: "okta|5",
          }),
        );
        expect(error.code).toBe(Code.NotFound);
        expect(error.rawMessage).toBe(
          "IdentityProvider 'acme/unknown-idp' not found",
        );
        expect(armCalls).toEqual([]);
      } finally {
        providerExists = true;
      }
    });

    it("the authorizer's refusal lands BEFORE the IdP-exists probe — a refused caller learns nothing about the org's providers", async () => {
      armCalls.length = 0;
      providerExistsCalls = 0;
      const error = await connectErrorOf(
        command.createFederatedAccount({
          org: LOCKED_ORG,
          identityProviderRef: { org: LOCKED_ORG, slug: "okta" },
          externalSub: "okta|6",
          email: "person@example.com",
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        "unauthorized to create identity accounts in this organization",
      );
      expect(providerExistsCalls).toBe(0);
      expect(armCalls).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// (B) the cloud's shape: a declared posture, the unit's verifier, the driver
// ---------------------------------------------------------------------------

describe("identity-account points (composed server, declared posture: the verifiers follow the driver)", () => {
  const SUB = "fake|provisioned-subject";
  const EMAIL = "provisioned@example.com";
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let driver: RegisteredDriver;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "identity-account-composed-b-"));
    driver = openDriver(dir);
    const unit: ServerExtension = {
      name: "fake-iam",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      drivers: { identityAccountStore: driver.accounts },
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    await driver.store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("no operator account exists under the posture — the driver's store starts empty", async () => {
    expect(await accountIdsIn(driver.store)).toEqual([]);
  });

  it("provisionMyAccount lands the subject's row in the driver, not the generic store", async () => {
    const command = createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(SUB, EMAIL)),
    );
    const account = await command.provisionMyAccount({});
    expect(account.metadata?.id).toBe(accountIdFor(SUB));
    expect(account.spec?.email).toBe(EMAIL);
    expect(await accountIdsIn(driver.store)).toEqual([accountIdFor(SUB)]);
    expect(await accountIdsIn(server.store)).toEqual([]);
  });

  it("an API key the subject minted resolves through the OSS API-key lane to the DRIVER's account", async () => {
    const minted = await createClient(
      ApiKeyCommandController,
      transportFor(port, fakeJwt(SUB, EMAIL)),
    ).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "driver lane key", org: "local" },
      spec: {},
    });
    const plaintext = minted.spec?.keyHash ?? "";
    expect(plaintext.startsWith("stk_")).toBe(true);

    driver.calls.length = 0;
    const me = await createClient(
      IdentityAccountQueryController,
      transportFor(port, plaintext),
    ).whoAmI({});
    expect(me.metadata?.id).toBe(accountIdFor(SUB));
    // The verifier's resolution read the driver: the key's creator stamp
    // (the raw sub) was looked up by subject there, not in the OSS adapter
    // over the generic store.
    expect(driver.calls).toContain("findDirectByIdpId");
  });
});

// ---------------------------------------------------------------------------
// (C) the provision slot
// ---------------------------------------------------------------------------

describe("identity-account points (composed server, declared posture: the provision slot)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  interface Firing {
    readonly gate: string;
    readonly accountId: string;
    readonly callerIdentityId: string;
    readonly auditEvent: string;
  }
  const firings: Firing[] = [];
  let failNextPersonalOrganization = false;
  const GATE_FAILURE_MESSAGE = "fake personal-organization ensure failed";

  function recordingGate(name: string): PipelineStep<DescMessage> {
    return {
      name,
      execute: (ctx) => {
        const account = ctx.newState as IdentityAccount;
        firings.push({
          gate: name,
          accountId: account.metadata?.id ?? "",
          callerIdentityId: ctx.callerIdentity.identityId,
          auditEvent: account.status?.audit?.specAudit?.event ?? "",
        });
        if (
          name === "FakePersonalOrganization" &&
          failNextPersonalOrganization
        ) {
          failNextPersonalOrganization = false;
          throw new ConnectError(GATE_FAILURE_MESSAGE, Code.FailedPrecondition);
        }
      },
    };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "identity-account-composed-c-"));
    const iamUnit: ServerExtension = {
      name: "fake-iam",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      gateSteps: new Map<
        GateSlotName,
        ReadonlyArray<PipelineStep<DescMessage>>
      >([
        [
          "identity-account-provision:post-persist",
          [recordingGate("FakePersonalOrganization")],
        ],
      ]),
    };
    const auditUnit: ServerExtension = {
      name: "fake-audit",
      gateSteps: new Map<
        GateSlotName,
        ReadonlyArray<PipelineStep<DescMessage>>
      >([
        [
          "identity-account-provision:post-persist",
          [recordingGate("FakeProvisionAudit")],
        ],
      ]),
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [iamUnit, auditUnit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  function commandAs(sub: string) {
    return createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(sub, `${sub.split("|")[1]}@example.com`)),
    );
  }

  function queryAs(sub: string) {
    return createClient(
      IdentityAccountQueryController,
      transportFor(port, fakeJwt(sub, `${sub.split("|")[1]}@example.com`)),
    );
  }

  it("first provisioning persists the row, THEN fires the gates in unit order with the caller re-stamped as the account", async () => {
    firings.length = 0;
    const sub = "fake|first";
    const account = await commandAs(sub).provisionMyAccount({});
    const id = accountIdFor(sub);
    expect(account.metadata?.id).toBe(id);
    expect(firings).toEqual([
      {
        gate: "FakePersonalOrganization",
        accountId: id,
        callerIdentityId: id,
        auditEvent: "created",
      },
      {
        gate: "FakeProvisionAudit",
        accountId: id,
        callerIdentityId: id,
        auditEvent: "created",
      },
    ]);
    // The caller the gates saw is the ACCOUNT, not the idp-shaped subject
    // the verifier stamped at position 1.
    expect(firings[0]?.callerIdentityId).not.toBe(sub);
  });

  it("the idempotent second call fires the gates again — the backfill the slot exists for", async () => {
    firings.length = 0;
    const sub = "fake|first";
    const again = await commandAs(sub).provisionMyAccount({});
    expect(again.metadata?.id).toBe(accountIdFor(sub));
    expect(firings.map((firing) => firing.gate)).toEqual([
      "FakePersonalOrganization",
      "FakeProvisionAudit",
    ]);
  });

  it("an in-process create never fires the slot — it is provisionMyAccount's alone", async () => {
    firings.length = 0;
    const platform = createClient(
      IdentityAccountCommandController,
      server.inProcessTransport,
    );
    const created = await platform.create(
      accountInput("fake|created-not-provisioned"),
    );
    expect(created.metadata?.id).toBe(
      accountIdFor("fake|created-not-provisioned"),
    );
    expect(firings).toEqual([]);
  });

  it("a gate that throws fails the request with its own code and copy; the row survives and the next call heals", async () => {
    firings.length = 0;
    const sub = "fake|gate-fails";
    failNextPersonalOrganization = true;
    const error = await connectErrorOf(commandAs(sub).provisionMyAccount({}));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(GATE_FAILURE_MESSAGE);
    // The first gate fired and threw; the second never ran.
    expect(firings.map((firing) => firing.gate)).toEqual([
      "FakePersonalOrganization",
    ]);

    // Non-transactional: the account persisted before the slot ran.
    const me = await queryAs(sub).whoAmI({});
    expect(me.metadata?.id).toBe(accountIdFor(sub));

    firings.length = 0;
    const healed = await commandAs(sub).provisionMyAccount({});
    expect(healed.metadata?.id).toBe(accountIdFor(sub));
    expect(firings.map((firing) => firing.gate)).toEqual([
      "FakePersonalOrganization",
      "FakeProvisionAudit",
    ]);
  });
});
