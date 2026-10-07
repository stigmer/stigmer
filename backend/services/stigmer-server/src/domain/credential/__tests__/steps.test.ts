/**
 * Pins the credential chain's own refusals and its fault doctrine on the
 * arms the composed suite (credential.test.ts) cannot steer: an Authorizer
 * answering what a test chooses, a secret service that fails, and a store
 * that faults on one call. Every surface runs through the registered
 * handlers on an in-process router over a real store, so each step runs
 * where the chain puts it.
 *
 * What it pins:
 *   - create: a credential that names no owner is refused InvalidArgument
 *     before any permission is asked; an organization the Authorizer does
 *     not know is NotFound; an Authorizer that fails is Internal, never a
 *     denial; a secret that cannot be sealed is Internal naming the field,
 *     and nothing is saved; a failed read of what the organization's
 *     credentials serve is Internal, never a pass;
 *   - setFields: the redaction marker keeps the sealed value and takes a
 *     new description; the marker for a field that holds no secret is
 *     refused; keyless, the value rests plaintext with a WARN; a seal or a
 *     save that fails is Internal;
 *   - the vocabulary every refusal names a target in (targetKey,
 *     targetWords), and ownerOf for a credential that names no owner.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
  isCiphertextShaped,
} from "../../../encryption/encryption.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import { errorOf } from "../../../pipeline/__tests__/support.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import {
  SYSTEM_OPERATOR_IDENTITY_ID,
  createVerifierChainInterceptor,
} from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { REDACTED_MARKER, markerRejectionMessage } from "../constants.js";
import { registerCredentialServices } from "../controller.js";
import { credentialListIndex } from "../list-index.js";
import { ownerOf, targetKey, targetWords } from "../steps.js";

const ORG = "acme";
const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const secrets = SecretService.create(randomBytes(32));

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "credential-steps-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: [credentialListIndex],
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The credential command client on an in-process router; the caller is the trusted-local operator. */
function command(
  deps: {
    readonly store?: Store;
    readonly authorizer?: Authorizer;
    readonly secretService?: SecretService;
    readonly logger?: Logger;
  } = {},
): Client<typeof CredentialCommandController> {
  const logger = deps.logger ?? silentLogger;
  const transport = createRouterTransport(
    (router) => {
      registerCredentialServices(router, {
        store: deps.store ?? store,
        logger,
        authorizer: deps.authorizer ?? newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        secretService: deps.secretService ?? secrets,
        listReadScope: undefined,
      });
    },
    {
      router: {
        interceptors: [
          createVerifierChainInterceptor([], [], logger),
          createApiResourceInterceptor(),
        ],
      },
    },
  );
  return createClient(CredentialCommandController, transport);
}

/** Allows every check except the credential-create permissions, which `decide` answers. */
function createAnswering(decide: () => Promise<AuthzDecision>): {
  authorizer: Authorizer;
  asked: AuthzCheck[];
} {
  const asked: AuthzCheck[] = [];
  return {
    asked,
    authorizer: {
      authorize: (_caller, check) => {
        if (
          check.permission === IamPermission.can_create_credential ||
          check.permission === IamPermission.can_create_org_credential
        ) {
          asked.push(check);
          return decide();
        }
        return Promise.resolve({ kind: "allow" });
      },
    },
  };
}

/** The secret service with encrypt failing; every other call is the real one. */
function sealingFails(): SecretService {
  return new Proxy(secrets, {
    get(target, prop) {
      if (prop === "encrypt") {
        return () => Promise.reject(new Error("kms unavailable"));
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The store with one method replaced. */
function storeReplacing<K extends keyof Store>(
  key: K,
  replacement: Store[K],
): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === key) {
        return replacement;
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

let counter = 0;
function credentialInput(spec: {
  owner?: { case: "person"; value: string } | { case: "org"; value: string };
  fields?: Record<string, { value: string; plain?: boolean }>;
  serves?: Array<{ target: { case: "gitHost"; value: string } }>;
}) {
  counter += 1;
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Credential",
    metadata: { name: `Key ${counter}`, org: ORG },
    ...(spec.owner === undefined &&
    spec.fields === undefined &&
    spec.serves === undefined
      ? {}
      : {
          spec: {
            ...(spec.owner === undefined ? {} : { owner: spec.owner }),
            fields: spec.fields ?? {},
            serves: spec.serves ?? [],
          },
        }),
  };
}

/** A person's credential saved as the chain would leave it, sealed. */
async function saveSealed(
  fields: Record<
    string,
    { value: string; plain?: boolean; description?: string }
  >,
) {
  counter += 1;
  const id = `cred_steps_${counter}`;
  const sealed: Record<
    string,
    { value: string; plain: boolean; description: string }
  > = {};
  for (const [name, field] of Object.entries(fields)) {
    sealed[name] = {
      value:
        field.plain === true
          ? field.value
          : await secrets.encrypt(
              field.value,
              EncryptionScope.forOrganization(ORG),
            ),
      plain: field.plain === true,
      description: field.description ?? "",
    };
  }
  await store.saveResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
    create(CredentialSchema, {
      metadata: {
        id,
        org: ORG,
        slug: `steps-${counter}`,
        name: `Steps ${counter}`,
      },
      spec: {
        owner: { case: "person", value: SYSTEM_OPERATOR_IDENTITY_ID },
        fields: sealed,
      },
    }),
  );
  return id;
}

function stored(id: string) {
  return store.getResource(ApiResourceKind.credential, id, CredentialSchema);
}

describe("create — ResolveCredentialOwner", () => {
  it("a credential that names no owner is refused before any permission is asked", async () => {
    const { authorizer, asked } = createAnswering(() =>
      Promise.resolve({ kind: "allow" }),
    );

    const error = await errorOf(() =>
      command({ authorizer }).create(credentialInput({})),
    );

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "spec.person or spec.org is required: say whether the credential is yours or the organization's",
    );
    expect(asked).toHaveLength(0);
  });

  it("an organization the Authorizer does not know is NotFound", async () => {
    const { authorizer, asked } = createAnswering(() =>
      Promise.resolve({ kind: "not-found" }),
    );

    const error = await errorOf(() =>
      command({ authorizer }).create(
        credentialInput({ owner: { case: "person", value: "" } }),
      ),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`organization not found: ${ORG}`);
    expect(asked.map((check) => check.permission)).toEqual([
      IamPermission.can_create_credential,
    ]);
  });

  it("an Authorizer that fails is Internal, never a denial", async () => {
    const { authorizer } = createAnswering(() =>
      Promise.reject(new Error("fga down")),
    );

    const error = await errorOf(() =>
      command({ authorizer }).create(
        credentialInput({ owner: { case: "org", value: "" } }),
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to authorize credential create");
  });
});

describe("create — faults after the owner", () => {
  it("a secret that cannot be sealed is Internal naming the field, and nothing is saved", async () => {
    const input = credentialInput({
      owner: { case: "person", value: "" },
      fields: { API_KEY: { value: "sk-live" } },
    });

    const error = await errorOf(() =>
      command({ secretService: sealingFails() }).create(input),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to encrypt secret value for field 'API_KEY'",
    );
    expect(error.rawMessage).not.toContain("sk-live");
  });

  it("a failed read of what the organization's credentials serve is Internal, never a pass", async () => {
    const faulty = storeReplacing("queryResources", () =>
      Promise.reject(new Error("SQLITE_BUSY")),
    );

    const error = await errorOf(() =>
      command({ store: faulty }).create(
        credentialInput({
          owner: { case: "person", value: "" },
          serves: [{ target: { case: "gitHost", value: "github.com" } }],
        }),
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to check what the organization's credentials serve",
    );
  });
});

describe("setFields — SetFieldsAndPersist", () => {
  it("the marker keeps the sealed value and takes a new description", async () => {
    const id = await saveSealed({
      API_KEY: { value: "sk-live", description: "old" },
    });
    const before = (await stored(id)).spec?.fields["API_KEY"]?.value;

    await command().setFields({
      credentialId: id,
      fields: {
        API_KEY: {
          value: REDACTED_MARKER,
          plain: false,
          description: "rotated monthly",
        },
      },
    });

    const after = (await stored(id)).spec?.fields["API_KEY"];
    expect(after?.value).toBe(before);
    expect(after?.description).toBe("rotated monthly");
  });

  it("the marker for a field that holds no secret is refused", async () => {
    const id = await saveSealed({ REGION: { value: "eu", plain: true } });

    const error = await errorOf(() =>
      command().setFields({
        credentialId: id,
        fields: { REGION: { value: REDACTED_MARKER, plain: false } },
      }),
    );

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(markerRejectionMessage("REGION"));
  });

  it("keyless, the value rests plaintext with a WARN naming the field", async () => {
    const id = await saveSealed({ REGION: { value: "eu", plain: true } });
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: ({ message, fields }) =>
        warnings.push(`${message} ${JSON.stringify(fields)}`),
    });

    await command({
      secretService: SecretService.create(undefined),
      logger,
    }).setFields({
      credentialId: id,
      fields: { API_KEY: { value: "sk-plain", plain: false } },
    });

    const field = (await stored(id)).spec?.fields["API_KEY"];
    expect(field?.value).toBe("sk-plain");
    expect(isCiphertextShaped(field?.value ?? "")).toBe(false);
    expect(warnings).toEqual([
      'Encryption disabled: credential secret value will be stored in plaintext {"field":"API_KEY"}',
    ]);
  });

  it("a secret that cannot be sealed is Internal naming the field", async () => {
    const id = await saveSealed({ REGION: { value: "eu", plain: true } });

    const error = await errorOf(() =>
      command({ secretService: sealingFails() }).setFields({
        credentialId: id,
        fields: { API_KEY: { value: "sk-live", plain: false } },
      }),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to encrypt secret value for field 'API_KEY'",
    );
    expect((await stored(id)).spec?.fields["API_KEY"]).toBeUndefined();
  });

  it("a save that fails is Internal naming the lane", async () => {
    const id = await saveSealed({ REGION: { value: "eu", plain: true } });
    const faulty = storeReplacing("saveResource", () =>
      Promise.reject(new Error("SQLITE_BUSY")),
    );

    const error = await errorOf(() =>
      command({ store: faulty }).setFields({
        credentialId: id,
        fields: { REGION: { value: "us", plain: true } },
      }),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to persist credential after setting fields",
    );
  });
});

describe("the vocabulary refusals name targets in", () => {
  it.each([
    [
      {
        case: "mcpServer" as const,
        value: { kind: ApiResourceKind.mcp_server, org: ORG, slug: "linear" },
      },
      "mcp_server:acme/linear",
      "MCP server 'linear'",
    ],
    [
      {
        case: "agent" as const,
        value: { kind: ApiResourceKind.agent, org: ORG, slug: "helper" },
      },
      "agent:acme/helper",
      "agent 'helper'",
    ],
    [
      { case: "gitHost" as const, value: "GitHub.com" },
      "git_host:github.com",
      "git host 'GitHub.com'",
    ],
    [{ case: undefined }, undefined, "an empty target"],
  ])("%o keys as %s and reads as %s", (target, key, words) => {
    const t = create(CredentialTargetSchema, { target });

    expect(targetKey(t)).toBe(key);
    expect(targetWords(t)).toBe(words);
  });

  it("a credential that names no owner has none", () => {
    expect(ownerOf(create(CredentialSchema, { spec: {} }))).toBeUndefined();
    expect(ownerOf(create(CredentialSchema))).toBeUndefined();
  });
});
