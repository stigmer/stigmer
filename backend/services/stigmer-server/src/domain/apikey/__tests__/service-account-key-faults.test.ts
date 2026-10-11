/**
 * The fault arms of a service account's key lanes, over fake ports: what
 * the composed suites cannot reach without breaking a real store.
 *
 * Pins:
 *   - createForServiceAccount, findByAccount and findAll answer INTERNAL with the
 *     lane's own copy when the account read faults, never NOT_FOUND (an
 *     outage must never read as "no account"), and the domain's NOT_FOUND
 *     for an account that does not exist;
 *   - the owner-scoped name check answers INTERNAL when the owner's keys
 *     cannot be read, and when the chain reached it with no slug;
 *   - the owner read skips a row that does not decode and keeps only the
 *     owners' keys;
 *   - an account's key delete refuses a key row that carries no id.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import type { Store } from "../../../store/interface.js";
import { deleteKeysOwnedBy } from "../account-keys.js";
import { registerApiKeyServices } from "../controller.js";
import { keysOwnedBy } from "../queries.js";
import { newCheckDuplicateKeyNameStep } from "../steps.js";

const ALLOW_ALL: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** A store that answers `queryResources` with `rows` (or its fault) and refuses everything else. */
function storeAnswering(rows: ReadonlyArray<ListIndexRow> | Error): Store {
  return new Proxy({} as Store, {
    get(_target, member) {
      if (member === "queryResources") {
        return () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve([...rows]));
      }
      throw new Error(`store.${String(member)} is not part of this rig`);
    },
  });
}

function rowOf(key: ReturnType<typeof keyOwnedBy>): ListIndexRow {
  return {
    id: key.metadata?.id ?? "",
    data: toBinary(ApiKeySchema, key),
    cursor: { createdAt: "", id: key.metadata?.id ?? "" },
  };
}

function keyOwnedBy(owner: string, id: string, slug = "ci") {
  return create(ApiKeySchema, {
    metadata: { id, slug },
    status: { audit: { specAudit: { createdBy: { id: owner } } } },
  });
}

/** The key services over a router whose every request is made by a person. */
function clientsWithFailingAccounts() {
  return clientsWithAccounts(() => Promise.reject(new Error("account store down")));
}

function clientsWithAccounts(findById: (id: string) => Promise<undefined>) {
  const transport = createRouterTransport(
    (router) =>
      registerApiKeyServices(router, {
        store: storeAnswering([]),
        logger: silentLogger,
        authorizer: ALLOW_ALL,
        authorizationLifecycle: undefined,
        listReadScope: undefined,
        accounts: { findById },
      }),
    {
      router: {
        interceptors: [
          (next) => (request) => {
            request.contextValues.set(callerIdentityKey, testCallerIdentity());
            return next(request);
          },
        ],
      },
    },
  );
  return {
    command: createClient(ApiKeyCommandController, transport),
    query: createClient(ApiKeyQueryController, transport),
  };
}

async function refusal(work: Promise<unknown>): Promise<ConnectError> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ConnectError)) {
    throw new Error("expected a ConnectError");
  }
  return error;
}

describe("a service account's key lanes when the account read faults", () => {
  it("createForServiceAccount is INTERNAL with the lane's copy, never NOT_FOUND", async () => {
    const { command } = clientsWithFailingAccounts();
    const error = await refusal(
      command.createForServiceAccount({ serviceAccountId: "ida_sa", name: "ci", neverExpires: true }),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to load identity account");
  });

  it("findAll is INTERNAL with the lane's copy when the caller's account cannot be read, never an empty list", async () => {
    const { query } = clientsWithFailingAccounts();
    const error = await refusal(query.findAll({}));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to load identity account");
  });

  it("findByAccount is INTERNAL with the lane's copy, never NOT_FOUND", async () => {
    const { query } = clientsWithFailingAccounts();
    const error = await refusal(query.findByAccount({ value: "ida_sa" }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to load identity account");
  });
});

describe("a service account's key lanes for an account that does not exist", () => {
  it("createForServiceAccount and findByAccount answer the domain's NOT_FOUND", async () => {
    const { command, query } = clientsWithAccounts(() => Promise.resolve(undefined));
    for (const work of [
      command.createForServiceAccount({ serviceAccountId: "ida_gone", name: "ci", neverExpires: true }),
      query.findByAccount({ value: "ida_gone" }),
    ]) {
      const error = await refusal(work);
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe("Identity account not found: ida_gone");
    }
  });
});

describe("the owner-scoped key name check", () => {
  function contextWithSlug(slug: string) {
    return new RequestContext(
      ApiKeySchema,
      create(ApiKeySchema, { metadata: { name: "ci", slug } }),
      testCallerIdentity(),
      ApiResourceKind.api_key,
    );
  }

  it("is INTERNAL when the owner's keys cannot be read", async () => {
    const step = newCheckDuplicateKeyNameStep(storeAnswering(new Error("index down")), (ctx) => ctx.callerIdentity.identityId);
    const error = await refusal(Promise.resolve().then(() => step.execute(contextWithSlug("ci"))));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to check for duplicates");
  });

  it("is INTERNAL when the chain reached it with no slug, a server-side ordering fault", async () => {
    const step = newCheckDuplicateKeyNameStep(storeAnswering([]), (ctx) => ctx.callerIdentity.identityId);
    const error = await refusal(Promise.resolve().then(() => step.execute(contextWithSlug(""))));
    expect(error.code).toBe(Code.Internal);
  });
});

describe("the owner read", () => {
  it("skips a row that does not decode, and keeps only the named owners' keys", async () => {
    const mine = keyOwnedBy("ida_me", "key_mine");
    const theirs = keyOwnedBy("ida_them", "key_theirs");
    const garbage: ListIndexRow = {
      id: "key_garbage",
      data: new Uint8Array([0xff, 0xff, 0xff]),
      cursor: { createdAt: "", id: "key_garbage" },
    };
    const keys = await keysOwnedBy(storeAnswering([garbage, rowOf(mine), rowOf(theirs)]), ["ida_me", ""]);
    expect(keys.map((key) => key.metadata?.id)).toEqual(["key_mine"]);
  });

  it("asks nothing when no owner is named", async () => {
    expect(await keysOwnedBy(storeAnswering(new Error("must not be read")), ["", ""])).toEqual([]);
  });
});

describe("an account's key delete", () => {
  it("refuses a key row that carries no id, before anything is revoked", async () => {
    const revoked: string[] = [];
    await expect(
      deleteKeysOwnedBy(
        {
          store: storeAnswering([rowOf(keyOwnedBy("ida_me", ""))]),
          logger: silentLogger,
          grantPath: {
            cleanupResource: (ref) => {
              revoked.push(ref.id);
              return Promise.resolve();
            },
          },
          authorizationLifecycle: undefined,
        },
        ["ida_me"],
        testCallerIdentity(),
      ),
    ).rejects.toThrow("an API key row with no id cannot be deleted");
    expect(revoked).toEqual([]);
  });
});
