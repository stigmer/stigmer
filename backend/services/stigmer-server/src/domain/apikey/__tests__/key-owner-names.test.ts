/**
 * Which names a caller's own keys are read by (`findAll`, controller.ts):
 * the caller's account id, and its subject only for an account whose
 * subject is the platform's own (a direct or legacy account), the stamp a
 * key minted before the account existed carries. A federated account's
 * subject is the one its organization's identity provider chose, so a
 * provider that asserted another person's subject must not list that
 * person's keys; nor may a token's own `sub` claim name an owner.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import type { Store } from "../../../store/interface.js";
import { registerApiKeyServices } from "../controller.js";

const ALLOW_ALL: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** A key stamped with `owner`, as a row the owner index answers. */
function keyRow(id: string, owner: string): ListIndexRow {
  const key = create(ApiKeySchema, {
    metadata: { id, slug: id },
    status: { audit: { specAudit: { createdBy: { id: owner } } } },
  });
  return { id, data: toBinary(ApiKeySchema, key), cursor: { createdAt: "", id } };
}

/** Every key on the server; the index answers any owner name and the read re-checks it. */
const KEYS = [keyRow("key_victim", "auth0|victim"), keyRow("key_mine", "ida_me"), keyRow("key_legacy", "auth0|me")];

const store = new Proxy({} as Store, {
  get(_target, member) {
    if (member === "queryResources") {
      return () => Promise.resolve(KEYS);
    }
    throw new Error(`store.${String(member)} is not part of this rig`);
  },
});

/** An unsigned JWT whose payload names `sub`; the verifier already vouched for it in a real request. */
function tokenFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub })}.sig`;
}

function ownKeysOf(account: IdentityAccount, tokenSub: string) {
  const id = account.metadata?.id ?? "";
  const transport = createRouterTransport(
    (router) =>
      registerApiKeyServices(router, {
        store,
        logger: silentLogger,
        authorizer: ALLOW_ALL,
        authorizationLifecycle: undefined,
        listReadScope: undefined,
        accounts: { findById: (wanted) => Promise.resolve(wanted === id ? account : undefined) },
      }),
    {
      router: {
        interceptors: [
          (next) => (request) => {
            request.contextValues.set(callerIdentityKey, {
              identityId: id,
              callerClass: "user",
              issuer: "https://idp.example",
              rawToken: tokenFor(tokenSub),
            });
            return next(request);
          },
        ],
      },
    },
  );
  return createClient(ApiKeyQueryController, transport).findAll({});
}

describe("the names a caller's own keys are read by", () => {
  it("a federated account whose provider asserted another person's subject lists none of that person's keys", async () => {
    const federated = create(IdentityAccountSchema, {
      metadata: { id: "ida_me", org: "org_acme" },
      spec: {
        idpId: "auth0|victim",
        provisioningMode: IdentityAccountProvisioningMode.federated,
        identityProviderRef: { org: "org_acme", slug: "okta" },
      },
    });
    const keys = await ownKeysOf(federated, "auth0|victim");
    expect(keys.entries.map((key) => key.metadata?.id)).toEqual(["key_mine"]);
  });

  it("a direct account lists the keys stamped with its id and with its own subject, never its token's claim", async () => {
    const direct = create(IdentityAccountSchema, {
      metadata: { id: "ida_me" },
      spec: { idpId: "auth0|me", provisioningMode: IdentityAccountProvisioningMode.direct },
    });
    const keys = await ownKeysOf(direct, "auth0|victim");
    expect(keys.entries.map((key) => key.metadata?.id).sort()).toEqual(["key_legacy", "key_mine"]);
  });
});
