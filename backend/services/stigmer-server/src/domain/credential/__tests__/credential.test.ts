/**
 * Pins the credential domain through the REAL stack: a composed server on
 * an ephemeral port, a native gRPC client, the full interceptor chain.
 *
 * Two postures:
 *   - trusted-local (the permissive authorizer, one caller): the rules the
 *     credential chain itself enforces, whoever is asking. The owner is
 *     filled from the caller or the organization and refused when it names
 *     someone else; it is fixed on update; a minted slug carries a random
 *     suffix so two credentials named alike never collide; one owner's
 *     credentials serve a target at most once (ALREADY_EXISTS naming the
 *     first), while a person's and the organization's may both serve it;
 *     a sign-in's fields are the platform's (a wire create asking for the
 *     oauth source is stamped static; setFields, removeFields and an
 *     update that changes a field are refused); an organization's
 *     credential is never revealed. And the pins the conformance suite
 *     cannot reach, needing the store or the key: secrets rest as
 *     ciphertext, the marker round-trip re-persists the IDENTICAL
 *     ciphertext (no double encryption), forged ciphertext is refused,
 *     the keyless WARN-degrade path stores plaintext and still redacts,
 *     and a stranded ciphertext fails reveal LOUD.
 *   - require-authentication with the built-in authorizer (the
 *     self-host's shape, composed with the fake verifier the composed
 *     extension proofs share): who may do what. A member saves their own
 *     credential and not the organization's; nobody reads another
 *     person's credential, the organization's admin included; list shows
 *     a person their own personal credentials and never another's; the
 *     organization's credential is write-only even to its admin.
 *
 * Keys are injected via env (vi.stubEnv) so the key ladder short-circuits
 * before its file steps — the real ~/.stigmer is never touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  EncryptionScope,
  isCiphertextShaped,
} from "../../../encryption/encryption.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import {
  ORG_CREDENTIAL_IS_WRITE_ONLY,
  ORG_IS_NOT_METADATA_ORG,
  OWNER_IS_FIXED,
  PERSON_IS_NOT_CALLER,
  REDACTED_MARKER,
  SIGN_IN_FIELDS_ARE_THE_PLATFORMS,
  forgedCiphertextMessage,
  markerRejectionMessage,
  servesTakenMessage,
} from "../constants.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "Credential";
const ORG = "acme";
const OTHER_ORG = "other-org";

type CommandClient = Client<typeof CredentialCommandController>;
type QueryClient = Client<typeof CredentialQueryController>;

interface TestServer {
  server: ComposedServer;
  command: CommandClient;
  query: QueryClient;
  dir: string;
  /** The id the server minted for ORG; stored rows name it, requests name the slug. */
  orgId: string;
}

async function startServer(env: Record<string, string>): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "credential-domain-test-"));
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  const ids = await seedOrganizations(transport, [ORG, OTHER_ORG]);
  return {
    server,
    command: createClient(CredentialCommandController, transport),
    query: createClient(CredentialQueryController, transport),
    dir,
    orgId: ids.get(ORG) ?? "",
  };
}

async function stopServer(ts: TestServer): Promise<void> {
  await ts.server.shutdown();
  rmSync(ts.dir, { recursive: true, force: true });
}

type FieldInput = { value: string; plain?: boolean; description?: string };
type Owner = { person: string } | { org: string };

let counter = 0;
function credentialInput(overrides?: {
  name?: string;
  slug?: string;
  org?: string;
  owner?: Owner;
  fields?: Record<string, FieldInput>;
  gitHosts?: ReadonlyArray<string>;
  source?: CredentialSource;
}) {
  counter += 1;
  const owner = overrides?.owner ?? { person: "" };
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: overrides?.name ?? `Credential ${counter}`,
      slug: overrides?.slug ?? "",
      org: overrides?.org ?? ORG,
    },
    spec: {
      owner:
        "person" in owner
          ? { case: "person" as const, value: owner.person }
          : { case: "org" as const, value: owner.org },
      description: "created by the domain test",
      fields: Object.fromEntries(
        Object.entries(overrides?.fields ?? {}).map(([k, v]) => [
          k,
          {
            value: v.value,
            plain: v.plain ?? false,
            description: v.description ?? "",
          },
        ]),
      ),
      serves: (overrides?.gitHosts ?? []).map((host) => ({
        target: { case: "gitHost" as const, value: host },
      })),
    },
    ...(overrides?.source === undefined
      ? {}
      : { status: { source: overrides.source } }),
  };
}

/** An update of `credential` with its spec replaced field by field. */
function updateOf(
  credential: Credential,
  spec: {
    description?: string;
    owner?: Owner;
    fields?: Record<string, FieldInput>;
  },
): Credential {
  const fields =
    spec.fields === undefined
      ? (credential.spec?.fields ?? {})
      : Object.fromEntries(
          Object.entries(spec.fields).map(([k, v]) => [
            k,
            {
              value: v.value,
              plain: v.plain ?? false,
              description: v.description ?? "",
            },
          ]),
        );
  const owner = spec.owner;
  return create(CredentialSchema, {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: credential.metadata,
    spec: {
      owner:
        owner === undefined
          ? (credential.spec?.owner ?? { case: undefined })
          : "person" in owner
            ? { case: "person", value: owner.person }
            : { case: "org", value: owner.org },
      description: spec.description ?? credential.spec?.description ?? "",
      fields,
      serves: credential.spec?.serves ?? [],
    },
  });
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

function stored(ts: TestServer, id: string): Promise<Credential> {
  return ts.server.store.getResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
  );
}

// ---------------------------------------------------------------------------
// Encryption-enabled server (the production shape), trusted-local.
// ---------------------------------------------------------------------------

describe("credential domain (encryption enabled, trusted-local)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: TEST_KEY_B64,
      STIGMER_RUNNER_TOKEN_KEY: Buffer.alloc(32, 8).toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  describe("the owner", () => {
    it("fills an empty person from the caller", async () => {
      const created = await ts.command.create(credentialInput());
      expect(created.metadata?.id).toMatch(/^cred_[0-9a-z]{26}$/);
      expect(created.spec?.owner.case).toBe("person");
      expect(created.spec?.owner.value).toBe(
        created.status?.audit?.specAudit?.createdBy?.id,
      );
      expect(created.spec?.owner.value).not.toBe("");
    });

    it("refuses a person's credential that names someone else, PERMISSION_DENIED", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          credentialInput({ owner: { person: "somebody-else" } }),
        ),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(PERSON_IS_NOT_CALLER);
    });

    it("fills an empty org from the credential's own organization", async () => {
      const created = await ts.command.create(
        credentialInput({ owner: { org: "" } }),
      );
      expect(created.spec?.owner.case).toBe("org");
      expect(created.spec?.owner.value).toBe(ts.orgId);
      expect(created.spec?.owner.value).toBe(created.metadata?.org);
    });

    it("refuses an organization's credential that names another organization", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          credentialInput({ owner: { org: "org_someoneelse" } }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(ORG_IS_NOT_METADATA_ORG);
    });

    it("keeps the owner on an update that omits it, refuses one that changes it", async () => {
      const personal = await ts.command.create(credentialInput());
      const kept = await ts.command.update(
        updateOf(personal, {
          description: "owner omitted",
          owner: { person: "" },
        }),
      );
      expect(kept.spec?.owner).toEqual(personal.spec?.owner);
      expect(kept.spec?.description).toBe("owner omitted");

      const toOrg = await grpcError(() =>
        ts.command.update(updateOf(personal, { owner: { org: ts.orgId } })),
      );
      expect(toOrg.code).toBe(Code.FailedPrecondition);
      expect(toOrg.rawMessage).toBe(OWNER_IS_FIXED);

      const toOrgEmpty = await grpcError(() =>
        ts.command.update(updateOf(personal, { owner: { org: "" } })),
      );
      expect(toOrgEmpty.code).toBe(Code.FailedPrecondition);
      expect(toOrgEmpty.rawMessage).toBe(OWNER_IS_FIXED);

      const toSomeoneElse = await grpcError(() =>
        ts.command.update(
          updateOf(personal, { owner: { person: "somebody-else" } }),
        ),
      );
      expect(toSomeoneElse.code).toBe(Code.FailedPrecondition);
      expect(toSomeoneElse.rawMessage).toBe(OWNER_IS_FIXED);

      const after = await stored(ts, personal.metadata?.id ?? "");
      expect(after.spec?.owner).toEqual(personal.spec?.owner);
    });
  });

  describe("the slug", () => {
    it("mints a slug with a random suffix, so two credentials named alike never collide", async () => {
      const first = await ts.command.create(
        credentialInput({ name: "OpenAI" }),
      );
      const second = await ts.command.create(
        credentialInput({ name: "OpenAI" }),
      );
      expect(first.metadata?.slug).toMatch(/^openai-[0-9a-f]{8}$/);
      expect(second.metadata?.slug).toMatch(/^openai-[0-9a-f]{8}$/);
      expect(second.metadata?.slug).not.toBe(first.metadata?.slug);
      expect(second.metadata?.id).not.toBe(first.metadata?.id);
    });

    it("keeps a slug the request sets, and the duplicate check judges it", async () => {
      const created = await ts.command.create(
        credentialInput({ name: "Deploy key", slug: "deploy-key" }),
      );
      expect(created.metadata?.slug).toBe("deploy-key");
      const error = await grpcError(() =>
        ts.command.create(
          credentialInput({ name: "Deploy key", slug: "deploy-key" }),
        ),
      );
      expect(error.code).toBe(Code.AlreadyExists);
    });
  });

  describe("one default per owner and target", () => {
    it("refuses a second of one owner's credentials serving a target, naming the first", async () => {
      const first = await ts.command.create(
        credentialInput({ gitHosts: ["one-default.example.com"] }),
      );
      const error = await grpcError(() =>
        ts.command.create(
          credentialInput({ gitHosts: ["one-default.example.com"] }),
        ),
      );
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toBe(
        servesTakenMessage(
          "git host 'one-default.example.com'",
          first.metadata?.slug ?? "",
        ),
      );
    });

    it("lets a person's credential and the organization's serve the same target", async () => {
      const personal = await ts.command.create(
        credentialInput({ gitHosts: ["both-owners.example.com"] }),
      );
      const organization = await ts.command.create(
        credentialInput({
          owner: { org: "" },
          gitHosts: ["both-owners.example.com"],
        }),
      );
      expect(personal.spec?.serves).toHaveLength(1);
      expect(organization.spec?.serves).toHaveLength(1);

      const secondOrg = await grpcError(() =>
        ts.command.create(
          credentialInput({
            owner: { org: "" },
            gitHosts: ["both-owners.example.com"],
          }),
        ),
      );
      expect(secondOrg.code).toBe(Code.AlreadyExists);
      expect(secondOrg.rawMessage).toBe(
        servesTakenMessage(
          "git host 'both-owners.example.com'",
          organization.metadata?.slug ?? "",
        ),
      );
    });

    it("refuses an update that makes a second, and never matches the credential itself", async () => {
      const holder = await ts.command.create(
        credentialInput({ gitHosts: ["update-default.example.com"] }),
      );
      const kept = await ts.command.update(
        updateOf(holder, { description: "still the one" }),
      );
      expect(kept.spec?.serves).toHaveLength(1);

      const other = await ts.command.create(credentialInput());
      const widened = updateOf(other, {});
      widened.spec?.serves.push(
        create(CredentialTargetSchema, {
          target: { case: "gitHost", value: "update-default.example.com" },
        }),
      );
      const error = await grpcError(() => ts.command.update(widened));
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toBe(
        servesTakenMessage(
          "git host 'update-default.example.com'",
          holder.metadata?.slug ?? "",
        ),
      );
    });

    it("deduplicates a target listed twice on one credential", async () => {
      const created = await ts.command.create(
        credentialInput({
          gitHosts: ["twice.example.com", "twice.example.com"],
        }),
      );
      expect(created.spec?.serves).toHaveLength(1);
    });
  });

  describe("secrets at rest and the redaction doctrine", () => {
    it("redacts secrets in the response and leaves plain fields readable", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: {
            API_KEY: { value: "sk-secret-1", description: "the key" },
            REGION: { value: "us-east-1", plain: true },
          },
        }),
      );
      expect(created.spec?.fields["API_KEY"]?.value).toBe(REDACTED_MARKER);
      expect(created.spec?.fields["API_KEY"]?.plain).toBe(false);
      expect(created.spec?.fields["API_KEY"]?.description).toBe("the key");
      expect(created.spec?.fields["REGION"]?.value).toBe("us-east-1");
    });

    it("stores CIPHERTEXT at rest — never the plaintext, never the marker", async () => {
      const created = await ts.command.create(
        credentialInput({ fields: { TOKEN: { value: "super-secret" } } }),
      );
      const atRest =
        (await stored(ts, created.metadata?.id ?? "")).spec?.fields["TOKEN"]
          ?.value ?? "";
      expect(isCiphertextShaped(atRest)).toBe(true);
      expect(atRest).not.toContain("super-secret");
    });

    it("leaves an EMPTY secret empty — no false marker", async () => {
      const created = await ts.command.create(
        credentialInput({ fields: { PENDING: { value: "" } } }),
      );
      expect(created.spec?.fields["PENDING"]?.value).toBe("");
    });

    it("get, getByReference, list and delete all redact", async () => {
      const created = await ts.command.create(
        credentialInput({ fields: { K: { value: "v" } } }),
      );
      const id = created.metadata?.id ?? "";

      expect((await ts.query.get({ value: id })).spec?.fields["K"]?.value).toBe(
        REDACTED_MARKER,
      );
      const byRef = await ts.query.getByReference({
        slug: created.metadata?.slug ?? "",
        org: ORG,
        kind: ApiResourceKind.credential,
      });
      expect(byRef.metadata?.id).toBe(id);
      expect(byRef.spec?.fields["K"]?.value).toBe(REDACTED_MARKER);

      const listed = (await ts.query.list({ org: ORG })).items.find(
        (c) => c.metadata?.id === id,
      );
      expect(listed?.spec?.fields["K"]?.value).toBe(REDACTED_MARKER);

      const deleted = await ts.command.delete({ resourceId: id });
      expect(deleted.spec?.fields["K"]?.value).toBe(REDACTED_MARKER);
      expect((await grpcError(() => ts.query.get({ value: id }))).code).toBe(
        Code.NotFound,
      );
    });
  });

  describe("revealField", () => {
    it("reveals a person's own secret decrypted, with its description", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: { DB_PASS: { value: "p@ss w0rd", description: "db" } },
        }),
      );
      const revealed = await ts.query.revealField({
        credentialId: created.metadata?.id ?? "",
        field: "DB_PASS",
      });
      expect(revealed.value).toBe("p@ss w0rd");
      expect(revealed.plain).toBe(false);
      expect(revealed.description).toBe("db");
    });

    it("returns a plain field as it is", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: { REGION: { value: "eu-west-1", plain: true } },
        }),
      );
      const revealed = await ts.query.revealField({
        credentialId: created.metadata?.id ?? "",
        field: "REGION",
      });
      expect(revealed.value).toBe("eu-west-1");
      expect(revealed.plain).toBe(true);
    });

    it("answers NotFound for a missing field", async () => {
      const created = await ts.command.create(credentialInput());
      const error = await grpcError(() =>
        ts.query.revealField({
          credentialId: created.metadata?.id ?? "",
          field: "GHOST",
        }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe("credential field not found: GHOST");
    });

    it("refuses an organization's credential: it is write-only", async () => {
      const created = await ts.command.create(
        credentialInput({
          owner: { org: "" },
          fields: { AWS_KEY: { value: "akia" } },
        }),
      );
      const error = await grpcError(() =>
        ts.query.revealField({
          credentialId: created.metadata?.id ?? "",
          field: "AWS_KEY",
        }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(ORG_CREDENTIAL_IS_WRITE_ONLY);
    });
  });

  describe("the marker round-trip (preserve → encrypt ordering)", () => {
    it("update with the marker keeps the stored secret — ciphertext IDENTICAL (no double encryption)", async () => {
      const created = await ts.command.create(
        credentialInput({ fields: { API_KEY: { value: "keep-me" } } }),
      );
      const id = created.metadata?.id ?? "";
      const cipherBefore =
        (await stored(ts, id)).spec?.fields["API_KEY"]?.value ?? "";

      // The client round-trip shape: the redacted read echoed back, plus a spec change.
      const updated = await ts.command.update(
        updateOf(created, {
          description: "updated description",
          fields: { API_KEY: { value: REDACTED_MARKER } },
        }),
      );
      expect(updated.spec?.fields["API_KEY"]?.value).toBe(REDACTED_MARKER);
      expect((await stored(ts, id)).spec?.fields["API_KEY"]?.value).toBe(
        cipherBefore,
      );

      const revealed = await ts.query.revealField({
        credentialId: id,
        field: "API_KEY",
      });
      expect(revealed.value).toBe("keep-me");
    });

    it("refuses the marker on create (nothing to keep)", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          credentialInput({ fields: { API_KEY: { value: REDACTED_MARKER } } }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(markerRejectionMessage("API_KEY"));
    });

    it("refuses the marker on update for a field that held no secret", async () => {
      const created = await ts.command.create(credentialInput());
      const error = await grpcError(() =>
        ts.command.update(
          updateOf(created, {
            fields: { NEW_KEY: { value: REDACTED_MARKER } },
          }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(markerRejectionMessage("NEW_KEY"));
    });
  });

  describe("forged-ciphertext rejection (oss#395)", () => {
    const FORGED = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=";

    it("refuses a ciphertext-shaped SECRET on create, any version prefix", async () => {
      for (const forged of [FORGED, "enc:v2:whatever"]) {
        const error = await grpcError(() =>
          ts.command.create(
            credentialInput({ fields: { EVIL: { value: forged } } }),
          ),
        );
        expect(error.code).toBe(Code.InvalidArgument);
        expect(error.rawMessage).toBe(forgedCiphertextMessage("EVIL"));
      }
    });

    it("refuses a ciphertext-shaped secret on setFields", async () => {
      const created = await ts.command.create(credentialInput());
      const error = await grpcError(() =>
        ts.command.setFields({
          credentialId: created.metadata?.id ?? "",
          fields: { EVIL: { value: FORGED, plain: false, description: "" } },
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(forgedCiphertextMessage("EVIL"));
    });

    it("passes a ciphertext-shaped PLAIN field through — the value is inert", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: { DOC_EXAMPLE: { value: FORGED, plain: true } },
        }),
      );
      expect(created.spec?.fields["DOC_EXAMPLE"]?.value).toBe(FORGED);
    });
  });

  describe("the field lanes (setFields, removeFields)", () => {
    it("setFields merges: named fields added or replaced, the rest kept, secrets sealed", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: {
            KEEP: { value: "kept", plain: true },
            OVERWRITE: { value: "old", plain: true },
          },
        }),
      );
      const id = created.metadata?.id ?? "";
      const updated = await ts.command.setFields({
        credentialId: id,
        fields: {
          OVERWRITE: { value: "new", plain: true, description: "" },
          ADDED_SECRET: { value: "shh", plain: false, description: "" },
        },
      });
      expect(updated.spec?.fields["KEEP"]?.value).toBe("kept");
      expect(updated.spec?.fields["OVERWRITE"]?.value).toBe("new");
      expect(updated.spec?.fields["ADDED_SECRET"]?.value).toBe(REDACTED_MARKER);
      expect(
        isCiphertextShaped(
          (await stored(ts, id)).spec?.fields["ADDED_SECRET"]?.value ?? "",
        ),
      ).toBe(true);
    });

    it("setFields keeps a secret sent back as the marker", async () => {
      const created = await ts.command.create(
        credentialInput({ fields: { TOKEN: { value: "original" } } }),
      );
      const id = created.metadata?.id ?? "";
      const cipherBefore =
        (await stored(ts, id)).spec?.fields["TOKEN"]?.value ?? "";
      await ts.command.setFields({
        credentialId: id,
        fields: {
          TOKEN: { value: REDACTED_MARKER, plain: false, description: "" },
        },
      });
      expect((await stored(ts, id)).spec?.fields["TOKEN"]?.value).toBe(
        cipherBefore,
      );
      expect(
        (await ts.query.revealField({ credentialId: id, field: "TOKEN" }))
          .value,
      ).toBe("original");
    });

    it("removeFields deletes named fields and ignores unknown ones", async () => {
      const created = await ts.command.create(
        credentialInput({
          fields: {
            A: { value: "1", plain: true },
            B: { value: "2", plain: true },
          },
        }),
      );
      const updated = await ts.command.removeFields({
        credentialId: created.metadata?.id ?? "",
        fields: ["A", "GHOST"],
      });
      expect(updated.spec?.fields["A"]).toBeUndefined();
      expect(updated.spec?.fields["B"]?.value).toBe("2");
    });

    it("answers NotFound for a field lane on an unknown credential", async () => {
      const error = await grpcError(() =>
        ts.command.setFields({
          credentialId: "cred_ghost",
          fields: { X: { value: "1", plain: true, description: "" } },
        }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe("credential not found: cred_ghost");
    });
  });

  describe("a sign-in's fields are the platform's", () => {
    it("stamps a wire create that asks for the oauth source as static", async () => {
      const created = await ts.command.create(
        credentialInput({
          source: CredentialSource.oauth,
          fields: { T: { value: "t" } },
        }),
      );
      expect(created.status?.source).toBe(CredentialSource.static);
      const atRest = await stored(ts, created.metadata?.id ?? "");
      expect(atRest.status?.source).toBe(CredentialSource.static);
    });

    it("keeps the oauth source on a create the server composed (the sign-in lane's shape)", async () => {
      const inProcess = createClient(
        CredentialCommandController,
        ts.server.inProcessTransport,
      );
      const created = await inProcess.create(
        credentialInput({
          // The in-process chain names the organization by id, as the server does.
          org: ts.orgId,
          owner: { org: "" },
          source: CredentialSource.oauth,
          fields: { T: { value: "t" } },
        }),
      );
      expect(created.status?.source).toBe(CredentialSource.oauth);
    });

    it("stamps a plain wire create static", async () => {
      const created = await ts.command.create(credentialInput());
      expect(created.status?.source).toBe(CredentialSource.static);
    });

    describe("on a sign-in the server wrote", () => {
      let signIn: Credential;
      let sealedToken: string;

      beforeAll(async () => {
        // A sign-in is only ever written by the server (the MCP OAuth
        // lane); the test plays that writer by saving the row itself.
        const owner = (await ts.command.create(credentialInput())).spec?.owner;
        const id = "cred_signintestrow000000000000";
        sealedToken = await ts.server.secrets.encrypt(
          "lin_oauth_access",
          EncryptionScope.forOrganization(ts.orgId),
        );
        await ts.server.store.saveResource(
          ApiResourceKind.credential,
          id,
          CredentialSchema,
          create(CredentialSchema, {
            apiVersion: API_VERSION,
            kind: KIND,
            metadata: {
              id,
              name: "Linear sign-in",
              slug: "linear-sign-in",
              org: ts.orgId,
            },
            spec: {
              owner,
              fields: {
                LINEAR_TOKEN: { value: sealedToken, plain: false },
                TOKEN_URL: {
                  value: "https://linear.example.com/token",
                  plain: true,
                },
              },
            },
            status: { source: CredentialSource.oauth },
          }),
        );
        signIn = await ts.query.get({ value: id });
      });

      it("refuses setFields", async () => {
        const error = await grpcError(() =>
          ts.command.setFields({
            credentialId: signIn.metadata?.id ?? "",
            fields: {
              LINEAR_TOKEN: {
                value: "mine-now",
                plain: false,
                description: "",
              },
            },
          }),
        );
        expect(error.code).toBe(Code.FailedPrecondition);
        expect(error.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
      });

      it("refuses removeFields", async () => {
        const error = await grpcError(() =>
          ts.command.removeFields({
            credentialId: signIn.metadata?.id ?? "",
            fields: ["LINEAR_TOKEN"],
          }),
        );
        expect(error.code).toBe(Code.FailedPrecondition);
        expect(error.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
      });

      it("refuses an update that changes, adds or drops a field", async () => {
        const changed = await grpcError(() =>
          ts.command.update(
            updateOf(signIn, {
              fields: {
                LINEAR_TOKEN: { value: REDACTED_MARKER },
                TOKEN_URL: {
                  value: "https://evil.example.com/token",
                  plain: true,
                },
              },
            }),
          ),
        );
        expect(changed.code).toBe(Code.FailedPrecondition);
        expect(changed.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);

        const replacedSecret = await grpcError(() =>
          ts.command.update(
            updateOf(signIn, {
              fields: {
                LINEAR_TOKEN: { value: "a-token-of-my-own" },
                TOKEN_URL: {
                  value: "https://linear.example.com/token",
                  plain: true,
                },
              },
            }),
          ),
        );
        expect(replacedSecret.code).toBe(Code.FailedPrecondition);

        const added = await grpcError(() =>
          ts.command.update(
            updateOf(signIn, {
              fields: {
                LINEAR_TOKEN: { value: REDACTED_MARKER },
                TOKEN_URL: {
                  value: "https://linear.example.com/token",
                  plain: true,
                },
                EXTRA: { value: "x", plain: true },
              },
            }),
          ),
        );
        expect(added.code).toBe(Code.FailedPrecondition);

        const dropped = await grpcError(() =>
          ts.command.update(
            updateOf(signIn, {
              fields: { LINEAR_TOKEN: { value: REDACTED_MARKER } },
            }),
          ),
        );
        expect(dropped.code).toBe(Code.FailedPrecondition);

        const atRest = await stored(ts, signIn.metadata?.id ?? "");
        expect(atRest.spec?.fields["LINEAR_TOKEN"]?.value).toBe(sealedToken);
        expect(atRest.spec?.fields["TOKEN_URL"]?.value).toBe(
          "https://linear.example.com/token",
        );
        expect(Object.keys(atRest.spec?.fields ?? {}).sort()).toEqual([
          "LINEAR_TOKEN",
          "TOKEN_URL",
        ]);
      });

      it("admits an update that echoes every field as read and changes the rest", async () => {
        const updated = await ts.command.update(
          updateOf(signIn, { description: "my Linear sign-in" }),
        );
        expect(updated.spec?.description).toBe("my Linear sign-in");
        expect(updated.status?.source).toBe(CredentialSource.oauth);
        const atRest = await stored(ts, signIn.metadata?.id ?? "");
        expect(atRest.spec?.fields["LINEAR_TOKEN"]?.value).toBe(sealedToken);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Keyless server (the WARN-degrade path): an INVALID explicit key makes
// compose fall back to the disabled pass-through service.
// ---------------------------------------------------------------------------

describe("credential domain (encryption degraded to plaintext)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: "not!!valid@@base64",
      STIGMER_RUNNER_TOKEN_KEY: Buffer.alloc(32, 8).toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  it("stores secrets as PLAINTEXT (degraded), still redacts on read, reveal works", async () => {
    const created = await ts.command.create(
      credentialInput({ fields: { S: { value: "plain-secret" } } }),
    );
    const id = created.metadata?.id ?? "";
    expect(created.spec?.fields["S"]?.value).toBe(REDACTED_MARKER);
    expect((await stored(ts, id)).spec?.fields["S"]?.value).toBe(
      "plain-secret",
    );
    expect(
      (await ts.query.revealField({ credentialId: id, field: "S" })).value,
    ).toBe("plain-secret");
  });

  it("still refuses forged enc:v<N>: input — the guard is unconditional on keyless deployments", async () => {
    const error = await grpcError(() =>
      ts.command.create(
        credentialInput({ fields: { EVIL: { value: "enc:v1:Zm9yZ2Vk" } } }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(forgedCiphertextMessage("EVIL"));
  });

  it("fails LOUD (Internal) revealing a stranded ciphertext row — never returns ciphertext", async () => {
    const owner = (await ts.command.create(credentialInput())).spec?.owner;
    const id = "cred_strandedrow0000000000000";
    await ts.server.store.saveResource(
      ApiResourceKind.credential,
      id,
      CredentialSchema,
      create(CredentialSchema, {
        apiVersion: API_VERSION,
        kind: KIND,
        metadata: { id, name: "Stranded", slug: "stranded", org: ts.orgId },
        spec: {
          owner,
          fields: {
            LOST: {
              value: "enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              plain: false,
            },
          },
        },
      }),
    );
    const error = await grpcError(() =>
      ts.query.revealField({ credentialId: id, field: "LOST" }),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to decrypt secret value");
  });
});

// ---------------------------------------------------------------------------
// Require-authentication with the built-in authorizer: who may do what.
// ---------------------------------------------------------------------------

const FOUNDER = "fake|cred-founder";
const MEMBER = "fake|cred-member";
const AUTH_ORG = "credential-auth-org";

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

describe("credential domain (built-in authorizer: the model is enforced)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let founderOwn: Credential;
  let memberOwn: Credential;
  let organizationKey: Credential;

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "cred-founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "cred-member@example.com"));
  const founderCommand = () =>
    createClient(CredentialCommandController, asFounder());
  const founderQuery = () =>
    createClient(CredentialQueryController, asFounder());
  const memberCommand = () =>
    createClient(CredentialCommandController, asMember());
  const memberQuery = () => createClient(CredentialQueryController, asMember());

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "credential-built-in-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", TEST_KEY_B64);
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    // The founder provisions and founds the organization (its admin); the
    // member provisions afterwards and joins it as a member.
    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, asFounder()).create(
      organizationInput(AUTH_ORG),
    );
    await createClient(
      IdentityAccountCommandController,
      asMember(),
    ).provisionMyAccount({});

    founderOwn = await founderCommand().create(
      credentialInput({
        org: AUTH_ORG,
        fields: { OPENAI_API_KEY: { value: "founder-key" } },
      }),
    );
    memberOwn = await memberCommand().create(
      credentialInput({
        org: AUTH_ORG,
        fields: { OPENAI_API_KEY: { value: "member-key" } },
      }),
    );
    organizationKey = await founderCommand().create(
      credentialInput({
        org: AUTH_ORG,
        owner: { org: "" },
        fields: { AWS_SECRET_ACCESS_KEY: { value: "org-key" } },
      }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("fills each person's own credential with that person", () => {
    expect(founderOwn.spec?.owner).toEqual({ case: "person", value: FOUNDER });
    expect(memberOwn.spec?.owner).toEqual({ case: "person", value: MEMBER });
    expect(organizationKey.spec?.owner.case).toBe("org");
    expect(organizationKey.spec?.owner.value).toBe(
      organizationKey.metadata?.org,
    );
  });

  it("refuses a member's credential naming another person, PERMISSION_DENIED", async () => {
    const error = await grpcError(() =>
      memberCommand().create(
        credentialInput({ org: AUTH_ORG, owner: { person: FOUNDER } }),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(PERSON_IS_NOT_CALLER);
  });

  it("refuses a member saving the organization's credential; the admin may", async () => {
    const error = await grpcError(() =>
      memberCommand().create(
        credentialInput({ org: AUTH_ORG, owner: { org: "" } }),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(
      "unauthorized to create an organization credential: only the organization's admins save credentials for it",
    );
  });

  it("nobody reads another person's credential, the organization's admin included", async () => {
    expect(
      (
        await grpcError(() =>
          founderQuery().get({ value: memberOwn.metadata?.id ?? "" }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    expect(
      (
        await grpcError(() =>
          memberQuery().get({ value: founderOwn.metadata?.id ?? "" }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    expect(
      (
        await grpcError(() =>
          founderQuery().revealField({
            credentialId: memberOwn.metadata?.id ?? "",
            field: "OPENAI_API_KEY",
          }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    expect(
      (
        await grpcError(() =>
          founderCommand().setFields({
            credentialId: memberOwn.metadata?.id ?? "",
            fields: {
              OPENAI_API_KEY: {
                value: "swapped",
                plain: false,
                description: "",
              },
            },
          }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    // The positive beside the negatives: each reads and reveals their own.
    expect(
      (await memberQuery().get({ value: memberOwn.metadata?.id ?? "" }))
        .metadata?.id,
    ).toBe(memberOwn.metadata?.id);
    expect(
      (
        await memberQuery().revealField({
          credentialId: memberOwn.metadata?.id ?? "",
          field: "OPENAI_API_KEY",
        })
      ).value,
    ).toBe("member-key");
  });

  it("the organization's credential is write-only: its admin edits it and never reveals it", async () => {
    const error = await grpcError(() =>
      founderQuery().revealField({
        credentialId: organizationKey.metadata?.id ?? "",
        field: "AWS_SECRET_ACCESS_KEY",
      }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    const edited = await founderCommand().setFields({
      credentialId: organizationKey.metadata?.id ?? "",
      fields: { REGION: { value: "eu-west-1", plain: true, description: "" } },
    });
    expect(edited.spec?.fields["REGION"]?.value).toBe("eu-west-1");
    // A member holds no grant: they neither read nor edit it.
    expect(
      (
        await grpcError(() =>
          memberQuery().get({ value: organizationKey.metadata?.id ?? "" }),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
  });

  it("list shows a person their own personal credentials and never another's", async () => {
    const memberList = await memberQuery().list({ org: AUTH_ORG });
    const memberIds = memberList.items.map((c) => c.metadata?.id);
    expect(memberIds).toContain(memberOwn.metadata?.id);
    expect(memberIds).not.toContain(founderOwn.metadata?.id);
    // The member holds no grant on the organization's credential.
    expect(memberIds).not.toContain(organizationKey.metadata?.id);
    for (const item of memberList.items) {
      expect(item.spec?.owner).toEqual({ case: "person", value: MEMBER });
    }

    const founderList = await founderQuery().list({ org: AUTH_ORG });
    const founderIds = founderList.items.map((c) => c.metadata?.id);
    expect(founderIds).toContain(founderOwn.metadata?.id);
    expect(founderIds).toContain(organizationKey.metadata?.id);
    // The admin sees the organization's credentials, never a member's own.
    expect(founderIds).not.toContain(memberOwn.metadata?.id);
    for (const item of founderList.items) {
      expect(
        item.spec?.fields["OPENAI_API_KEY"]?.value ?? REDACTED_MARKER,
      ).toBe(REDACTED_MARKER);
      expect(
        item.spec?.fields["AWS_SECRET_ACCESS_KEY"]?.value ?? REDACTED_MARKER,
      ).toBe(REDACTED_MARKER);
    }
  });

  it("a person's and the organization's credential may both serve one target; a second of the same owner may not", async () => {
    await memberCommand().create(
      credentialInput({ org: AUTH_ORG, gitHosts: ["git.shared.example.com"] }),
    );
    await founderCommand().create(
      credentialInput({ org: AUTH_ORG, gitHosts: ["git.shared.example.com"] }),
    );
    const orgServing = await founderCommand().create(
      credentialInput({
        org: AUTH_ORG,
        owner: { org: "" },
        gitHosts: ["git.shared.example.com"],
      }),
    );
    expect(orgServing.spec?.serves).toHaveLength(1);

    const secondOfMember = await grpcError(() =>
      memberCommand().create(
        credentialInput({
          org: AUTH_ORG,
          gitHosts: ["git.shared.example.com"],
        }),
      ),
    );
    expect(secondOfMember.code).toBe(Code.AlreadyExists);
  });
});
