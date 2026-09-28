/**
 * Pins memory capture where callers are persons (stigmer#1387): with the
 * identity-account directory composed, ResolveMemoryDefaults files the
 * memory under the id of the account it is about — the admitted capture
 * credential's subject (an account id or a raw issuer subject, read the
 * way accountForStamp reads a creator stamp), else the calling person —
 * and hands that account to CheckMemoryEnablement, which requires the
 * organization's switch and then the person's own (the Java
 * MemoryCreateHandler's order and copy). A caller no account stands for is
 * stamped "" and refused by the enablement step, behind the authorization
 * bar. Without the directory — the single-operator posture — the org flag
 * alone decides and the subject stays the "" sentinel.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { MEMORY_CAPTURE_CREDENTIAL_KEY } from "../../../pipeline/steps/guard-memory-capture.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { AccountsByCaller } from "../../identityaccount/resolve.js";
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import type { FakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import {
  MEMORY_ACCOUNT_DISABLED_MESSAGE,
  memoryDisabledMessage,
} from "../constants.js";
import {
  memorySubjectAccountOf,
  newCheckMemoryEnablementStep,
  newResolveMemoryDefaultsStep,
} from "../steps.js";

const ORG = "org_acme";
const CAROL = "ida_carol";
const CAROL_SUBJECT = "auth0|carol";

/** Carol at the console: a wire user whose identity is her account id. */
const CAROL_AT_CONSOLE: CallerIdentity = {
  identityId: CAROL,
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};

/** A sandbox-lane caller; its capture credential names the subject. */
const SANDBOX: CallerIdentity = {
  identityId: CAROL,
  callerClass: "sandbox",
  issuer: "stigmer",
  rawToken: "opaque",
};

/** A signed-in caller no account stands for yet (idp-shaped). */
const STRANGER: CallerIdentity = {
  identityId: "auth0|stranger",
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};

let dir: string;
let store: Store;
let accounts: FakeIdentityAccountStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "memory-person-consent-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  accounts = fakeIdentityAccountStore();
  seedCarol({ memoryEnabled: true });
  await seedOrg(true);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedCarol(preferences: { memoryEnabled: boolean }): void {
  accounts.rows.set(
    CAROL,
    create(IdentityAccountSchema, {
      metadata: { id: CAROL, name: "Carol" },
      spec: { idpId: CAROL_SUBJECT, preferences },
    }),
  );
}

async function seedOrg(memoryEnabled: boolean): Promise<void> {
  await store.saveResource(
    ApiResourceKind.organization,
    ORG,
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { id: ORG, name: ORG, org: ORG },
      spec: { preferences: { memoryEnabled } },
    }),
  );
}

function memoryCtx(
  caller: CallerIdentity,
): RequestContext<typeof MemorySchema> {
  return new RequestContext(
    MemorySchema,
    create(MemorySchema, {
      metadata: { name: "m", org: ORG },
      // A forged subject: the server always overwrites it.
      spec: { content: "fact", subjectIdentityAccountId: "ida_forged" },
    }),
    caller,
    ApiResourceKind.memory,
  );
}

function withCredential(
  ctx: RequestContext<typeof MemorySchema>,
  subject: string,
): RequestContext<typeof MemorySchema> {
  ctx.set(MEMORY_CAPTURE_CREDENTIAL_KEY, {
    subjectIdentityAccountId: subject,
    provedSessionId: "ses_proved",
  });
  return ctx;
}

/** Runs the create chain's two consent steps in their chain order. */
async function capture(
  ctx: RequestContext<typeof MemorySchema>,
  personAccounts: AccountsByCaller | undefined,
): Promise<void> {
  await newResolveMemoryDefaultsStep(personAccounts).execute(ctx);
  await newCheckMemoryEnablementStep(store, personAccounts).execute(ctx);
}

async function refusalOf(run: Promise<void>): Promise<ConnectError> {
  try {
    await run;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the capture to be refused");
}

describe("capture where callers are persons", () => {
  it("files a direct capture under the calling person's account", async () => {
    const ctx = memoryCtx(CAROL_AT_CONSOLE);
    await capture(ctx, accounts);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe(CAROL);
    expect(memorySubjectAccountOf(ctx)?.metadata?.id).toBe(CAROL);
  });

  it("files a credentialed capture under the credential's subject", async () => {
    const ctx = withCredential(memoryCtx(SANDBOX), CAROL);
    await capture(ctx, accounts);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe(CAROL);
    expect(ctx.newState.spec?.provenance?.sessionId).toBe("ses_proved");
  });

  it("normalises a credential subject that arrived as a raw issuer subject to the account id", async () => {
    const ctx = withCredential(memoryCtx(SANDBOX), CAROL_SUBJECT);
    await capture(ctx, accounts);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe(CAROL);
  });

  it("refuses with the person's copy when their own switch is off", async () => {
    seedCarol({ memoryEnabled: false });
    for (const ctx of [
      memoryCtx(CAROL_AT_CONSOLE),
      withCredential(memoryCtx(SANDBOX), CAROL),
    ]) {
      const refusal = await refusalOf(capture(ctx, accounts));
      expect(refusal.code).toBe(Code.FailedPrecondition);
      expect(refusal.rawMessage).toBe(MEMORY_ACCOUNT_DISABLED_MESSAGE);
    }
  });

  it("asks the organization first: its switch off refuses with the org's copy", async () => {
    seedCarol({ memoryEnabled: false });
    await seedOrg(false);
    const refusal = await refusalOf(
      capture(memoryCtx(CAROL_AT_CONSOLE), accounts),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(memoryDisabledMessage(ORG));
  });

  it("stamps nobody and refuses in the enablement step when no account stands for the caller", async () => {
    const ctx = memoryCtx(STRANGER);
    await newResolveMemoryDefaultsStep(accounts).execute(ctx);
    // Not refused here: the refusal belongs behind the authorization bar.
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe("");
    expect(memorySubjectAccountOf(ctx)).toBeUndefined();
    const refusal = await refusalOf(
      Promise.resolve(
        newCheckMemoryEnablementStep(store, accounts).execute(ctx),
      ),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(MEMORY_ACCOUNT_DISABLED_MESSAGE);
  });

  it("refuses a credential whose subject names no account", async () => {
    const ctx = withCredential(memoryCtx(SANDBOX), "chn_org_acme");
    const refusal = await refusalOf(capture(ctx, accounts));
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe("");
  });

  it("answers a directory fault as an infrastructure fault, never a refusal", async () => {
    const faulting: AccountsByCaller = {
      findById: async () => {
        throw new Error("simulated store fault");
      },
      findDirectByIdpId: async () => {
        throw new Error("simulated store fault");
      },
    };
    const refusal = await refusalOf(
      Promise.resolve(
        newResolveMemoryDefaultsStep(faulting).execute(
          memoryCtx(CAROL_AT_CONSOLE),
        ),
      ),
    );
    expect(refusal.code).toBe(Code.Internal);
  });

  it("refuses to file under an account row that carries no id", async () => {
    const nameless: AccountsByCaller = {
      findById: async () =>
        create(IdentityAccountSchema, {
          spec: { preferences: { memoryEnabled: true } },
        }),
      findDirectByIdpId: async () => undefined,
    };
    const refusal = await refusalOf(
      Promise.resolve(
        newResolveMemoryDefaultsStep(nameless).execute(
          memoryCtx(CAROL_AT_CONSOLE),
        ),
      ),
    );
    expect(refusal.code).toBe(Code.Internal);
  });
});

describe("capture under the single-operator posture", () => {
  it("keeps the sentinel subject and the org flag alone, whatever the account says", async () => {
    seedCarol({ memoryEnabled: false });
    const ctx = memoryCtx(CAROL_AT_CONSOLE);
    await capture(ctx, undefined);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe("");
    expect(memorySubjectAccountOf(ctx)).toBeUndefined();
  });

  it("still refuses with the org's copy when the organization is off", async () => {
    await seedOrg(false);
    const refusal = await refusalOf(
      capture(memoryCtx(CAROL_AT_CONSOLE), undefined),
    );
    expect(refusal.rawMessage).toBe(memoryDisabledMessage(ORG));
  });
});
