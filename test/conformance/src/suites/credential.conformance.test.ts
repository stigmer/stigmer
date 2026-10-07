// Conformance suite for the Credential domain.
// Domain: agentic / credential — a flat, organization-scoped resource holding
// saved values that belong to a person or to the organization.
//
// Drives CredentialCommandController + CredentialQueryController through the
// raw proto stubs and asserts the contract every edition serves:
//   - identity: a `cred_` id, a slug minted from the name with a random
//     suffix (two people's "OpenAI" never collide), no apply, private only;
//   - owner resolution: `person` empty means the caller and any other person
//     is refused; `org` empty means the credential's own organization and
//     any other organization is refused; the owner is fixed on update;
//   - secrets: every non-empty secret field leaves the server as the
//     redaction marker on every credential-returning RPC, plain fields as
//     they are; the marker sent back on update keeps the stored value and is
//     refused where there is nothing to keep; a ciphertext-shaped secret is
//     refused from a client; revealField returns one field of one's own
//     credential, and an organization's credential is write-only;
//   - fields: setFields merges, removeFields deletes and ignores unknown names;
//   - one default per owner and target: a second credential of the same owner
//     serving the same agent, MCP server or git host is refused naming the
//     first, while a person's and the organization's may serve the same one;
//   - a sign-in is the platform's: a client's create is always `static`,
//     whatever status it sends (the sign-in lane's own arms, a real OAuth
//     handshake writing an `oauth` credential whose fields no person edits,
//     are in suites-execution/mcpserver-connect.conformance.test.ts, where the
//     handshake's engine-backed half runs);
//   - list: the organization's credentials the caller may see, newest first;
//     nobody lists another person's.
//
// Who may see, change, reveal or use another person's or the organization's
// credential, and whose assignment of one a schedule carries (the server
// stamps the writer), is an authorization contract, so
// the two-person arms run on the target's enforcing lane (the cloud's
// primary; open source's OIDC sibling).
// Which credential a RUN receives is the execution class's
// (suites-execution/run-credentials.conformance.test.ts): a run is refused at
// create, which needs the engine.
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import {
  CREDENTIAL_API_VERSION,
  CREDENTIAL_KIND,
  REDACTED_MARKER,
  agentTarget,
  assignCredential,
  gitHostTarget,
  makeCredential,
  makeCredentialSpec,
  refOf,
  type CredentialOptions,
} from "../support/credentials";
import { policyTriple } from "../support/iampolicies";
import { uniqueName } from "../support/naming";
import { makeSchedule } from "../support/schedules";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

// The server's refusal copy, byte-pinned: a client may match on it.
const PERSON_IS_NOT_CALLER = "a person's credential can only be created by that person";
const ORG_IS_NOT_METADATA_ORG =
  "an organization's credential must belong to its own organization (spec.org must equal metadata.org)";
const OWNER_IS_FIXED =
  "a credential's owner is fixed when it is created; create a new credential instead";
const ORG_CREDENTIAL_IS_WRITE_ONLY =
  "an organization's credential is write-only: its values can be replaced, never read back";
const ORG_CREDENTIAL_CREATE_DENIED =
  "unauthorized to create an organization credential: only the organization's admins save credentials for it";
function markerRejection(field: string): string {
  return `field '${field}': cannot use the redaction marker as a secret value`;
}
function forgedCiphertext(field: string): string {
  return (
    `field '${field}' must be plaintext — values carrying the 'enc:' ` +
    "encryption prefix are not accepted from clients"
  );
}
function servesTaken(target: string, existingSlug: string): string {
  return `${target} is already served by credential '${existingSlug}' of the same owner; a target takes at most one default per owner — remove it from that credential first`;
}

// A string carrying the server-reserved ciphertext prefix.
const CIPHERTEXT_SHAPED = "enc:v1:forged-looking-ciphertext";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function createCredential(
  opts: CredentialOptions,
  using: ConformanceClients = clients,
): Promise<Credential> {
  const credential = await using.credentialCommand.create(makeCredential(opts));
  fixtures.defer(() => using.credentialCommand.delete({ resourceId: credential.metadata!.id }));
  return credential;
}

describe("Credential conformance — CRUD & identity", () => {
  it("[rpc:CredentialCommandController.create] create assigns a cred_ id, mints a suffixed slug from the name, makes the caller the owner, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("OpenAI");

    const created = await createCredential({ org, name, description: "my key" });

    expect(created.metadata?.id).toMatch(/^cred_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.slug, "the slug is the name's, with a random suffix").toMatch(
      new RegExp(`^${name.toLowerCase()}-[0-9a-f]{8}$`),
    );
    expect(created.spec?.description).toBe("my key");
    expect(created.spec?.owner.case).toBe("person");
    expect(created.spec?.owner.value, "an empty person is filled with the caller").not.toBe("");
    expect(created.spec?.fields.PLAIN_FIELD?.value).toBe("plain-value");
    expect(created.status?.source, "a credential saved from the wire is static").toBe(
      CredentialSource.static,
    );
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("[rpc:CredentialCommandController.create] two credentials with the same name get distinct slugs", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("same-name");
    const first = await createCredential({ org, name });
    const second = await createCredential({ org, name });
    expect(second.metadata?.slug).not.toBe(first.metadata?.slug);
  });

  it("[rpc:CredentialQueryController.get] get round-trips the created credential (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("cred") });
    const fetched = await clients.credentialQuery.get({ value: created.metadata!.id });
    assertResourceParity(CredentialSchema, created, fetched, "create vs get");
  });

  it("[rpc:CredentialQueryController.get] get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.credentialQuery.get({ value: "" }), Code.InvalidArgument, "get with empty id"));

  it("[rpc:CredentialQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.credentialQuery.get({ value: "cred_doesnotexist" }),
      Code.NotFound,
      "get of a missing credential",
    ));

  it("[rpc:CredentialQueryController.getByReference] getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("cred") });
    const fetched = await clients.credentialQuery.getByReference({
      org,
      slug: created.metadata!.slug,
      kind: ApiResourceKind.credential,
    });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("[rpc:CredentialQueryController.getByReference] getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.credentialQuery.getByReference({
          org,
          slug: "no-such-credential",
          kind: ApiResourceKind.credential,
        }),
      Code.NotFound,
      "getByReference of an unknown slug",
    );
  });

  it("[rpc:CredentialCommandController.update] update changes the name, description and fields, and preserves id, slug, org and owner", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("cred"), description: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.credentialCommand.update({
      apiVersion: CREDENTIAL_API_VERSION,
      kind: CREDENTIAL_KIND,
      metadata: { id, name: renamed, slug: "attempted-different-slug", org },
      spec: makeCredentialSpec({
        description: "after",
        fields: { OTHER_FIELD: { value: "other-value", plain: true } },
      }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(Object.keys(updated.spec?.fields ?? {})).toEqual(["OTHER_FIELD"]);
    expect(updated.spec?.owner).toEqual(created.spec?.owner);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:CredentialCommandController.delete] delete returns the credential and a later get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.credentialCommand.create(makeCredential({ org, name: uniqueName("cred") }));
    const deleted = await clients.credentialCommand.delete({ resourceId: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    await expectGrpcCode(
      () => clients.credentialQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });

  it("[rpc:CredentialCommandController.create] create refuses a visibility the kind does not offer (InvalidArgument): a credential is private, and who may use one is a grant", async () => {
    const { org } = await target.provisionTenancy();
    const input = makeCredential({ org, name: uniqueName("cred") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create({
          ...input,
          metadata: { ...input.metadata, visibility: ApiResourceVisibility.visibility_org },
        }),
      Code.InvalidArgument,
      "an org-visible credential",
    );
    expect(refused.rawMessage).toContain("cannot be set to visibility_org");
  });

  it("[rpc:CredentialCommandController.create] a client's create is always static, whatever status it claims: only a sign-in writes a sign-in", async () => {
    const { org } = await target.provisionTenancy();
    const input = makeCredential({ org, name: uniqueName("claims-oauth") });
    const created = await clients.credentialCommand.create({
      ...input,
      status: { source: CredentialSource.oauth },
    });
    fixtures.defer(() => clients.credentialCommand.delete({ resourceId: created.metadata!.id }));
    expect(created.status?.source).toBe(CredentialSource.static);
  });
});

describe("Credential conformance — owner resolution", () => {
  it("[rpc:CredentialCommandController.create] an organization's credential with an empty org belongs to its own organization", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("team-key"), owner: "org" });
    expect(created.spec?.owner.case).toBe("org");
    expect(created.spec?.owner.value, "an empty org is the credential's own organization").toBe(
      created.metadata?.org,
    );
  });

  it("[rpc:CredentialCommandController.create] an organization's credential naming another organization is refused (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const input = makeCredential({ org, name: uniqueName("team-key"), owner: "org" });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create({
          ...input,
          spec: { ...input.spec, owner: { case: "org", value: "org_someoneelse" } },
        }),
      Code.InvalidArgument,
      "an org credential naming another organization",
    );
    expect(refused.rawMessage).toBe(ORG_IS_NOT_METADATA_ORG);
  });

  it("[rpc:CredentialCommandController.create] a person's credential naming someone other than the caller is refused (PermissionDenied)", async () => {
    const { org } = await target.provisionTenancy();
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("not-mine"), owner: { person: "acc_someoneelse" } }),
        ),
      Code.PermissionDenied,
      "a person's credential for someone else",
    );
    expect(refused.rawMessage).toBe(PERSON_IS_NOT_CALLER);
  });

  it("[rpc:CredentialCommandController.create] a credential naming no owner is refused (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const input = makeCredential({ org, name: uniqueName("ownerless") });
    await expectGrpcCode(
      () => clients.credentialCommand.create({ ...input, spec: { ...input.spec, owner: { case: undefined } } }),
      Code.InvalidArgument,
      "a credential with no owner",
    );
  });

  it("[rpc:CredentialCommandController.update] the owner is fixed: a person's credential cannot become the organization's", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("mine") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.update({
          ...created,
          spec: { ...created.spec!, owner: { case: "org", value: "" } },
        }),
      Code.FailedPrecondition,
      "turning a person's credential into the organization's",
    );
    expect(refused.rawMessage).toBe(OWNER_IS_FIXED);
  });

  it("[rpc:CredentialCommandController.create] a person's credential naming the caller explicitly is the caller's, as an empty person is", async () => {
    const { org } = await target.provisionTenancy();
    const implicit = await createCredential({ org, name: uniqueName("implicit") });
    const person = implicit.spec?.owner.case === "person" ? implicit.spec.owner.value : "";
    const explicit = await createCredential({ org, name: uniqueName("explicit"), owner: { person } });
    expect(explicit.spec?.owner).toEqual(implicit.spec?.owner);
  });

  it("[rpc:CredentialCommandController.update] an update naming the owner's kind with an empty value keeps the stored owner", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("team-key"), owner: "org" });
    const updated = await clients.credentialCommand.update({
      ...created,
      spec: { ...created.spec!, owner: { case: "org", value: "" }, description: "kept owner" },
    });
    expect(updated.spec?.owner).toEqual(created.spec?.owner);
    expect(updated.spec?.description).toBe("kept owner");
  });
});

describe("Credential conformance — secrets", () => {
  it("[rpc:CredentialQueryController.get] every credential-returning read redacts a secret field; plain fields and an empty secret come back as they are", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("secret"),
      fields: {
        API_KEY: { value: "super-secret", description: "the key" },
        EMPTY_SECRET: { value: "" },
        REGION: { value: "eu-west-1", plain: true },
      },
    });

    const reads: Array<[string, Credential]> = [
      ["create", created],
      ["get", await clients.credentialQuery.get({ value: created.metadata!.id })],
      [
        "getByReference",
        await clients.credentialQuery.getByReference({
          org,
          slug: created.metadata!.slug,
          kind: ApiResourceKind.credential,
        }),
      ],
      [
        "list",
        (await clients.credentialQuery.list({ org })).items.find((c) => c.metadata?.id === created.metadata?.id)!,
      ],
    ];
    for (const [rpc, read] of reads) {
      expect(read, `${rpc} returns the credential`).toBeDefined();
      expect(read.spec?.fields.API_KEY?.value, `${rpc} redacts the secret`).toBe(REDACTED_MARKER);
      expect(read.spec?.fields.API_KEY?.plain, `${rpc} keeps the field secret`).toBe(false);
      expect(read.spec?.fields.API_KEY?.description, `${rpc} keeps the description`).toBe("the key");
      expect(read.spec?.fields.EMPTY_SECRET?.value, `${rpc} never marks an empty secret`).toBe("");
      expect(read.spec?.fields.REGION?.value, `${rpc} returns a plain field as it is`).toBe("eu-west-1");
    }
  });

  it("[rpc:CredentialQueryController.revealField] revealField returns one secret field of one's own credential, unredacted", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("reveal"),
      fields: { API_KEY: { value: "super-secret" }, REGION: { value: "eu-west-1", plain: true } },
    });

    const secret = await clients.credentialQuery.revealField({ credentialId: created.metadata!.id, field: "API_KEY" });
    expect(secret.value).toBe("super-secret");
    expect(secret.plain).toBe(false);
    const plain = await clients.credentialQuery.revealField({ credentialId: created.metadata!.id, field: "REGION" });
    expect(plain.value).toBe("eu-west-1");
  });

  it("[rpc:CredentialQueryController.revealField] revealField of a field the credential does not hold is NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("reveal") });
    await expectGrpcCode(
      () => clients.credentialQuery.revealField({ credentialId: created.metadata!.id, field: "NOPE" }),
      Code.NotFound,
      "reveal of a missing field",
    );
  });

  it("[rpc:CredentialQueryController.revealField] revealField rejects an empty credential_id and an empty field (InvalidArgument each)", async () => {
    await expectGrpcCode(
      () => clients.credentialQuery.revealField({ credentialId: "", field: "API_KEY" }),
      Code.InvalidArgument,
      "reveal with no credential_id",
    );
    await expectGrpcCode(
      () => clients.credentialQuery.revealField({ credentialId: "cred_x", field: "" }),
      Code.InvalidArgument,
      "reveal with no field",
    );
  });

  // The write-only promise is the reveal step's own on a server whose
  // Authorizer admits the caller; an enforcing Authorizer refuses first,
  // because nobody holds can_read_secrets on an organization's credential
  // (the enforcing arm below).
  it("[rpc:CredentialQueryController.revealField] an organization's credential is write-only: revealField is refused even where the caller may do everything else", async (ctx) => {
    if (target.capabilities.enforcingAuthorizer) {
      return ctx.skip("the primary enforces: the enforcing-lane arm pins the refusal at the Authorizer");
    }
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("team-key"),
      owner: "org",
      fields: { API_KEY: { value: "team-secret" } },
    });
    const refused = await expectGrpcCode(
      () => clients.credentialQuery.revealField({ credentialId: created.metadata!.id, field: "API_KEY" }),
      Code.FailedPrecondition,
      "reveal of an organization's credential",
    );
    expect(refused.rawMessage).toBe(ORG_CREDENTIAL_IS_WRITE_ONLY);
  });
});

describe("Credential conformance — the redaction marker round trip", () => {
  it("[rpc:CredentialCommandController.update] update keeps a secret's stored value when the marker is sent back", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("marker"),
      fields: { API_KEY: { value: "original-secret" } },
    });
    expect(created.spec?.fields.API_KEY?.value).toBe(REDACTED_MARKER);

    // The read-modify-write a console does: the marker goes back untouched.
    const updated = await clients.credentialCommand.update({
      ...created,
      spec: { ...created.spec!, description: "renamed only" },
    });
    expect(updated.spec?.fields.API_KEY?.value).toBe(REDACTED_MARKER);

    const revealed = await clients.credentialQuery.revealField({
      credentialId: created.metadata!.id,
      field: "API_KEY",
    });
    expect(revealed.value, "the marker kept the stored secret").toBe("original-secret");
  });

  it("[rpc:CredentialCommandController.update] update refuses the marker for a field that held no secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("marker") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.update({
          ...created,
          spec: {
            ...created.spec!,
            fields: { ...created.spec!.fields, NEW_SECRET: create(CredentialFieldSchema, { value: REDACTED_MARKER }) },
          },
        }),
      Code.InvalidArgument,
      "the marker for a new field",
    );
    expect(refused.rawMessage).toBe(markerRejection("NEW_SECRET"));
  });

  it("[rpc:CredentialCommandController.create] create refuses the marker: there is nothing to keep (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("marker"), fields: { API_KEY: { value: REDACTED_MARKER } } }),
        ),
      Code.InvalidArgument,
      "the marker on create",
    );
    expect(refused.rawMessage).toBe(markerRejection("API_KEY"));
  });

  it("[rpc:CredentialCommandController.setFields] setFields keeps a stored secret for the marker and refuses it for a field that held none", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("marker"),
      fields: { API_KEY: { value: "original-secret" } },
    });
    await clients.credentialCommand.setFields({
      credentialId: created.metadata!.id,
      fields: { API_KEY: { value: REDACTED_MARKER, plain: false, description: "described later" } },
    });
    const revealed = await clients.credentialQuery.revealField({
      credentialId: created.metadata!.id,
      field: "API_KEY",
    });
    expect(revealed.value).toBe("original-secret");
    expect(revealed.description).toBe("described later");

    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.setFields({
          credentialId: created.metadata!.id,
          fields: { OTHER: { value: REDACTED_MARKER, plain: false, description: "" } },
        }),
      Code.InvalidArgument,
      "the marker for a field that held no secret",
    );
    expect(refused.rawMessage).toBe(markerRejection("OTHER"));
  });
});

describe("Credential conformance — ciphertext-shaped input", () => {
  it("[rpc:CredentialCommandController.create] create refuses a ciphertext-shaped secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("forged"), fields: { API_KEY: { value: CIPHERTEXT_SHAPED } } }),
        ),
      Code.InvalidArgument,
      "a ciphertext-shaped secret on create",
    );
    expect(refused.rawMessage).toBe(forgedCiphertext("API_KEY"));
  });

  it("[rpc:CredentialCommandController.update] update refuses a ciphertext-shaped secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("forged") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.update({
          ...created,
          spec: {
            ...created.spec!,
            fields: { ...created.spec!.fields, API_KEY: create(CredentialFieldSchema, { value: CIPHERTEXT_SHAPED }) },
          },
        }),
      Code.InvalidArgument,
      "a ciphertext-shaped secret on update",
    );
    expect(refused.rawMessage).toBe(forgedCiphertext("API_KEY"));
  });

  it("[rpc:CredentialCommandController.setFields] setFields refuses a ciphertext-shaped secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("forged") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.setFields({
          credentialId: created.metadata!.id,
          fields: { API_KEY: { value: CIPHERTEXT_SHAPED, plain: false, description: "" } },
        }),
      Code.InvalidArgument,
      "a ciphertext-shaped secret on setFields",
    );
    expect(refused.rawMessage).toBe(forgedCiphertext("API_KEY"));
  });

  it("[rpc:CredentialCommandController.create] a PLAIN field that merely looks prefixed is stored as it is", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("plain-prefixed"),
      fields: { NOTE: { value: CIPHERTEXT_SHAPED, plain: true } },
    });
    expect(created.spec?.fields.NOTE?.value).toBe(CIPHERTEXT_SHAPED);
  });
});

describe("Credential conformance — field management", () => {
  it("[rpc:CredentialCommandController.setFields] setFields adds and replaces the named fields and keeps the rest", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("fields"),
      fields: { KEEP: { value: "kept", plain: true }, REPLACE: { value: "before", plain: true } },
    });
    const updated = await clients.credentialCommand.setFields({
      credentialId: created.metadata!.id,
      fields: {
        REPLACE: { value: "after", plain: true, description: "" },
        ADDED: { value: "added-secret", plain: false, description: "" },
      },
    });
    expect(updated.spec?.fields.KEEP?.value).toBe("kept");
    expect(updated.spec?.fields.REPLACE?.value).toBe("after");
    expect(updated.spec?.fields.ADDED?.value, "the response is redacted").toBe(REDACTED_MARKER);
    const revealed = await clients.credentialQuery.revealField({
      credentialId: created.metadata!.id,
      field: "ADDED",
    });
    expect(revealed.value).toBe("added-secret");
  });

  it("[rpc:CredentialCommandController.removeFields] removeFields deletes the named fields and ignores names the credential does not hold", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({
      org,
      name: uniqueName("fields"),
      fields: { KEEP: { value: "kept", plain: true }, DROP: { value: "dropped" } },
    });
    const updated = await clients.credentialCommand.removeFields({
      credentialId: created.metadata!.id,
      fields: ["DROP", "NEVER_HELD"],
    });
    expect(Object.keys(updated.spec?.fields ?? {})).toEqual(["KEEP"]);
  });

  it("[rpc:CredentialCommandController.removeFields] removeFields refuses an empty name list (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createCredential({ org, name: uniqueName("fields") });
    await expectGrpcCode(
      () => clients.credentialCommand.removeFields({ credentialId: created.metadata!.id, fields: [] }),
      Code.InvalidArgument,
      "removeFields with no names",
    );
  });

  it("[rpc:CredentialCommandController.setFields] setFields of a missing credential is NotFound", () =>
    expectGrpcCode(
      () =>
        clients.credentialCommand.setFields({
          credentialId: "cred_doesnotexist",
          fields: { A: { value: "a", plain: true, description: "" } },
        }),
      Code.NotFound,
      "setFields of a missing credential",
    ));
});

describe("Credential conformance — one default per owner and target", () => {
  async function agentIn(org: string) {
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("served-agent") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    return agent;
  }

  it("[rpc:CredentialCommandController.create] a second credential of the same person serving the same agent is refused, naming the first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentIn(org);
    const first = await createCredential({ org, name: uniqueName("first"), serves: [agentTarget(refOf(agent))] });

    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("second"), serves: [agentTarget(refOf(agent))] }),
        ),
      Code.AlreadyExists,
      "a second default for one agent",
    );
    expect(refused.rawMessage).toBe(servesTaken(`agent '${agent.metadata!.slug}'`, first.metadata!.slug));
  });

  it("[rpc:CredentialCommandController.create] a person's and the organization's credential may serve the same target, and each owner one git host", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentIn(org);
    const mine = await createCredential({
      org,
      name: uniqueName("mine"),
      serves: [agentTarget(refOf(agent)), gitHostTarget("github.com")],
    });
    const teams = await createCredential({
      org,
      name: uniqueName("teams"),
      owner: "org",
      serves: [agentTarget(refOf(agent)), gitHostTarget("github.com")],
    });
    expect(mine.spec?.serves).toHaveLength(2);
    expect(teams.spec?.serves).toHaveLength(2);

    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("teams-again"), owner: "org", serves: [gitHostTarget("github.com")] }),
        ),
      Code.AlreadyExists,
      "the organization's second default for one git host",
    );
    expect(refused.rawMessage).toBe(servesTaken("git host 'github.com'", teams.metadata!.slug));
  });

  it("[rpc:CredentialCommandController.update] an update that adds a target another credential of the owner serves is refused", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentIn(org);
    const first = await createCredential({ org, name: uniqueName("first"), serves: [agentTarget(refOf(agent))] });
    const other = await createCredential({ org, name: uniqueName("other") });
    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.update({
          ...other,
          spec: { ...other.spec!, serves: [create(CredentialTargetSchema, agentTarget(refOf(agent)))] },
        }),
      Code.AlreadyExists,
      "an update taking a served target",
    );
    expect(refused.rawMessage).toBe(servesTaken(`agent '${agent.metadata!.slug}'`, first.metadata!.slug));
  });

  it("[rpc:CredentialCommandController.create] a target named twice on one credential is kept once", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentIn(org);
    const created = await createCredential({
      org,
      name: uniqueName("twice"),
      serves: [agentTarget(refOf(agent)), agentTarget(refOf(agent))],
    });
    expect(created.spec?.serves).toHaveLength(1);
  });

  it("[rpc:CredentialCommandController.create] a credential cannot serve an agent that does not exist (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.credentialCommand.create(
          makeCredential({ org, name: uniqueName("ghost"), serves: [agentTarget({ org, slug: "ghost-agent" })] }),
        ),
      Code.FailedPrecondition,
      "serving a missing agent",
    );
  });
});

describe("[rpc:CredentialQueryController.list] Credential conformance — list", () => {
  it("lists the organization's credentials and nothing of another organization", async () => {
    const { org } = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    const older = await createCredential({ org, name: uniqueName("older") });
    const newer = await createCredential({ org, name: uniqueName("newer"), owner: "org" });
    const elsewhere = await createCredential({ org: other.org, name: uniqueName("elsewhere") });

    const listed = await clients.credentialQuery.list({ org });
    const ids = listed.items.map((c) => c.metadata?.id);
    expect([...ids].sort()).toEqual([newer.metadata?.id, older.metadata?.id].sort());
    expect(ids).not.toContain(elsewhere.metadata?.id);
    expect(listed.totalCount).toBe(2);
  });

  it("rejects a list with no org (InvalidArgument)", () =>
    expectGrpcCode(() => clients.credentialQuery.list({ org: "" }), Code.InvalidArgument, "list with no org"));
});

// The two-person contract: what one person's credential is to a teammate,
// and what the organization's is to a member. Every arm runs on the
// enforcing lane, where the server signs its callers in and the Authorizer
// enforces credential.fga; a target with no lane skips visibly.
describe("Credential conformance — a person's credential is theirs alone (enforcing lane)", () => {
  let lane: EnforcingLane | undefined;
  let laneReason = "";

  beforeAll(async () => {
    const enforcing = await enforcingLaneOf(target);
    lane = enforcing.lane;
    laneReason = enforcing.lane === undefined ? enforcing.reason : "";
  });

  function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
    if (lane === undefined) ctx.skip(laneReason);
    return lane;
  }

  async function tenancy(on: EnforcingLane): Promise<TenancyContext> {
    const context = await on.provisionTenancy();
    fixtures.defer(() => on.cleanupTenancy(context));
    return context;
  }

  it("[rpc:CredentialQueryController.get] [rpc:CredentialQueryController.getByReference] a teammate can neither get nor resolve another person's credential", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);
    const founders = await createCredential({ org: context.org, name: uniqueName("founders") }, on.clients);

    await expectGrpcCode(
      () => member.credentialQuery.get({ value: founders.metadata!.id }),
      Code.PermissionDenied,
      "a teammate's get",
    );
    await expectGrpcCode(
      () =>
        member.credentialQuery.getByReference({
          org: context.org,
          slug: founders.metadata!.slug,
          kind: ApiResourceKind.credential,
        }),
      Code.PermissionDenied,
      "a teammate's getByReference",
    );
  });

  it("[rpc:CredentialQueryController.revealField] a teammate cannot reveal another person's credential, and an admin cannot either", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);
    const founders = await createCredential(
      { org: context.org, name: uniqueName("founders"), fields: { API_KEY: { value: "founder-secret" } } },
      on.clients,
    );
    const members = await createCredential(
      { org: context.org, name: uniqueName("members"), fields: { API_KEY: { value: "member-secret" } } },
      member,
    );

    await expectGrpcCode(
      () => member.credentialQuery.revealField({ credentialId: founders.metadata!.id, field: "API_KEY" }),
      Code.PermissionDenied,
      "a member revealing the founder's credential",
    );
    await expectGrpcCode(
      () => on.clients.credentialQuery.revealField({ credentialId: members.metadata!.id, field: "API_KEY" }),
      Code.PermissionDenied,
      "the founder (an admin) revealing a member's credential",
    );
    const own = await member.credentialQuery.revealField({ credentialId: members.metadata!.id, field: "API_KEY" });
    expect(own.value, "each person reveals their own").toBe("member-secret");
  });

  it("[rpc:CredentialCommandController.update] [rpc:CredentialCommandController.setFields] [rpc:CredentialCommandController.delete] a teammate cannot change or delete another person's credential", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);
    const founders = await createCredential({ org: context.org, name: uniqueName("founders") }, on.clients);

    await expectGrpcCode(
      () => member.credentialCommand.update({ ...founders, spec: { ...founders.spec!, description: "mine now" } }),
      Code.PermissionDenied,
      "a teammate's update",
    );
    await expectGrpcCode(
      () =>
        member.credentialCommand.setFields({
          credentialId: founders.metadata!.id,
          fields: { API_KEY: { value: "planted", plain: false, description: "" } },
        }),
      Code.PermissionDenied,
      "a teammate's setFields",
    );
    await expectGrpcCode(
      () => member.credentialCommand.delete({ resourceId: founders.metadata!.id }),
      Code.PermissionDenied,
      "a teammate's delete",
    );
  });

  it("[rpc:CredentialQueryController.list] nobody lists another person's credential: each person lists their own", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);
    const founders = await createCredential({ org: context.org, name: uniqueName("founders") }, on.clients);
    const members = await createCredential({ org: context.org, name: uniqueName("members") }, member);

    const asMember = (await member.credentialQuery.list({ org: context.org })).items.map((c) => c.metadata?.id);
    const asFounder = (await on.clients.credentialQuery.list({ org: context.org })).items.map((c) => c.metadata?.id);
    expect(asMember).toContain(members.metadata?.id);
    expect(asMember).not.toContain(founders.metadata?.id);
    expect(asFounder, "an admin lists no member's credential").not.toContain(members.metadata?.id);
    expect(asFounder).toContain(founders.metadata?.id);
  });

  it("[rpc:CredentialCommandController.create] a member saves their own credential and cannot save the organization's", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);

    const own = await createCredential({ org: context.org, name: uniqueName("members") }, member);
    expect(own.spec?.owner.value).toBe(await on.accountIdOf(member));

    const refused = await expectGrpcCode(
      () =>
        member.credentialCommand.create(
          makeCredential({ org: context.org, name: uniqueName("team-key"), owner: "org" }),
        ),
      Code.PermissionDenied,
      "a member saving the organization's credential",
    );
    expect(refused.rawMessage).toBe(ORG_CREDENTIAL_CREATE_DENIED);
  });

  it("[rpc:CredentialQueryController.revealField] an organization's credential is write-only: its admin cannot reveal it", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const teams = await createCredential(
      { org: context.org, name: uniqueName("team-key"), owner: "org", fields: { API_KEY: { value: "team-secret" } } },
      on.clients,
    );
    await expectGrpcCode(
      () => on.clients.credentialQuery.revealField({ credentialId: teams.metadata!.id, field: "API_KEY" }),
      Code.PermissionDenied,
      "an admin revealing the organization's credential",
    );
    const updated = await on.clients.credentialCommand.setFields({
      credentialId: teams.metadata!.id,
      fields: { API_KEY: { value: "rotated", plain: false, description: "" } },
    });
    expect(updated.spec?.fields.API_KEY?.value, "its admin replaces it").toBe(REDACTED_MARKER);
  });

  // A schedule's runs have no person behind them, so what they use is
  // assigned on the schedule, and an assignment is its writer's: the server
  // stamps the writer and asks that they may use the credential (the refusal
  // of a credential the writer may not use is pinned in
  // parent-gated-create-authorization.conformance.test.ts). Authoring an
  // agent and its schedule is an admin's, so the writer here is one.
  async function adminSchedule(
    admin: ConformanceClients,
    org: string,
    credential: Credential,
    writer = "",
  ) {
    const agent = await admin.agentCommand.create(makeAgent({ org, name: uniqueName("admin-agent") }));
    fixtures.defer(() => admin.agentCommand.delete({ value: agent.metadata!.id }));
    const input = makeSchedule(org, uniqueName("admin-schedule"), agent.metadata!.slug);
    if (input.spec?.target?.case === "agent") {
      input.spec.target.value.credentials = [
        {
          ...assignCredential({ declarer: agentTarget(refOf(agent)), key: "PLAIN_FIELD", credential: refOf(credential) }),
          writer,
        },
      ];
    }
    return admin.scheduleCommand.create(input);
  }

  it("[rpc:ScheduleCommandController.create] a person assigns their own credential on a schedule they created, and the server stamps them as the writer", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const admin = await on.provisionWithRole(context, "admin");
    const own = await createCredential({ org: context.org, name: uniqueName("admins") }, admin);

    const schedule = await adminSchedule(admin, context.org, own, "someone-else");
    fixtures.defer(() => admin.scheduleCommand.delete({ value: schedule.metadata!.id }));
    const invocation = schedule.spec?.target;
    const assignments = invocation?.case === "agent" ? invocation.value.credentials : [];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.writer, "the writer is the caller, never what the client sent").toBe(
      await on.accountIdOf(admin),
    );
  });

  it("[rpc:CredentialQueryController.list] a member sees the organization's credentials only once granted `user` on one", async (ctx) => {
    const on = laneOrSkip(ctx);
    const context = await tenancy(on);
    const member = await on.provisionMember(context);
    const teams = await createCredential(
      { org: context.org, name: uniqueName("team-key"), owner: "org" },
      on.clients,
    );

    const before = (await member.credentialQuery.list({ org: context.org })).items.map((c) => c.metadata?.id);
    expect(before, "a member lists no organization credential they may not use").not.toContain(teams.metadata?.id);
    await expectGrpcCode(
      () => member.credentialQuery.get({ value: teams.metadata!.id }),
      Code.PermissionDenied,
      "a member's get of an organization credential they may not use",
    );

    if (!target.capabilities.perResourceGrants) {
      return ctx.skip("the edition grants roles on organizations only, so no one can be made a user of one credential");
    }
    await on.clients.iamPolicyCommand.create(
      policyTriple(
        { kind: "identity_account", id: await on.accountIdOf(member) },
        "user",
        { kind: "credential", id: teams.metadata!.id },
      ),
    );
    const after = (await member.credentialQuery.list({ org: context.org })).items.map((c) => c.metadata?.id);
    expect(after, "a `user` lists the credential it may use").toContain(teams.metadata?.id);
    const read = await member.credentialQuery.get({ value: teams.metadata!.id });
    expect(read.metadata?.id).toBe(teams.metadata?.id);
    await expectGrpcCode(
      () => member.credentialQuery.revealField({ credentialId: teams.metadata!.id, field: "PLAIN_FIELD" }),
      Code.PermissionDenied,
      "a `user` revealing the organization's credential",
    );
  });
});
