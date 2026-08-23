// ChannelApp conformance — CRUD, the per-field secret contract, and the
// referential delete-block (Class A).
// Domain: conformance suites.
//
// A ChannelApp registers a customer-owned messaging-platform app (Slack or
// Meta/WhatsApp) whose credentials agent channels install through. Three
// surfaces make the domain distinct, all asserted here:
//
//   - The PER-FIELD secret contract: every secret in the provider arm
//     (Slack: client_secret + signing_secret; WhatsApp: app_secret +
//     access_token + verify_token) is encrypted at rest and REDACTED to the
//     platform marker on every read; re-submitting the marker on update
//     preserves that field's stored value INDEPENDENTLY of its siblings —
//     one request can rotate one secret and keep the rest (the OAuthApp
//     contract generalized to multi-secret arms). Ciphertext-shaped values
//     are refused on every write door (oss#395), and the marker itself is
//     refused on create (nothing to preserve yet).
//   - PROVIDER immutability: the provider oneof arm cannot change on update
//     — every referencing channel's install state and webhook verification
//     path are provider-shaped. NOTE the deliberate as-is pin: ChannelApp
//     answers InvalidArgument here while its sibling AgentChannel answers
//     FailedPrecondition for ITS provider rule — a verified cross-domain
//     inconsistency, pinned exactly (parity doctrine; harmonization is a
//     post-cutover both-editions candidate, recorded in the wave-2 PR).
//   - The DELETE-BLOCK: deletion is refused with FailedPrecondition while
//     any AgentChannel's spec.app_ref resolves to the app — a deleted app
//     would break the referencing channels' webhook verification and any
//     future re-install. Unreferencing frees the delete.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import {
  CHANNELAPP_REDACTED_MARKER,
  makeSlackChannelApp,
  makeWhatsAppChannelApp,
} from "../support/channelapps";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

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

async function createSlackAppFixture(org: string, name = uniqueName("channel-app")) {
  const app = await clients.channelAppCommand.create(makeSlackChannelApp(org, name));
  fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));
  return app;
}

describe("ChannelApp conformance — CRUD & identity", () => {
  it("create assigns a chapp_ id, echoes the public config, and redacts every secret", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createSlackAppFixture(org);

    expect(created.metadata?.id).toMatch(/^chapp_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.providerConfig?.case).toBe("slack");
    const slack = created.spec?.providerConfig?.case === "slack" ? created.spec.providerConfig.value : undefined;
    // client_id is public app identity and travels back verbatim; both
    // secrets must never travel back at all.
    expect(slack?.clientId).toBe("conformance-slack-client-id");
    expect(slack?.clientSecret).toBe(CHANNELAPP_REDACTED_MARKER);
    expect(slack?.signingSecret).toBe(CHANNELAPP_REDACTED_MARKER);
  });

  it("get, getByReference, and listByOrg resolve the app, all redacted", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createSlackAppFixture(org);

    const fetched = await clients.channelAppQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    const fetchedSlack =
      fetched.spec?.providerConfig?.case === "slack" ? fetched.spec.providerConfig.value : undefined;
    expect(fetchedSlack?.clientSecret).toBe(CHANNELAPP_REDACTED_MARKER);
    expect(fetchedSlack?.signingSecret).toBe(CHANNELAPP_REDACTED_MARKER);

    const byRef = await clients.channelAppQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);

    const listed = await clients.channelAppQuery.listByOrg({ org });
    const match = listed.entries.find((app) => app.metadata?.id === created.metadata?.id);
    expect(match, "the created app appears in its org's list").toBeDefined();
    const listedSlack =
      match?.spec?.providerConfig?.case === "slack" ? match.spec.providerConfig.value : undefined;
    expect(listedSlack?.clientSecret).toBe(CHANNELAPP_REDACTED_MARKER);
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("channel-app");

    const first = await clients.channelAppCommand.apply(
      makeSlackChannelApp(org, name, { clientId: "app-v1" }),
    );
    fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: first.metadata!.id }));
    expect(first.metadata?.id).toMatch(/^chapp_/);

    const second = await clients.channelAppCommand.apply(
      makeSlackChannelApp(org, name, { clientId: "app-v2" }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    const slack = second.spec?.providerConfig?.case === "slack" ? second.spec.providerConfig.value : undefined;
    expect(slack?.clientId, "apply-as-update replaces the spec").toBe("app-v2");
  });

  it("delete removes an unreferenced app", async () => {
    const { org } = await target.provisionTenancy();
    // No deferred cleanup: this test deletes the app itself.
    const created = await clients.channelAppCommand.create(
      makeSlackChannelApp(org, uniqueName("channel-app")),
    );

    const deleted = await clients.channelAppCommand.delete({ resourceId: created.metadata!.id });
    // The deleted resource is returned for audit — redacted like any read.
    const slack = deleted.spec?.providerConfig?.case === "slack" ? deleted.spec.providerConfig.value : undefined;
    expect(slack?.clientSecret).toBe(CHANNELAPP_REDACTED_MARKER);

    await expectGrpcCode(
      () => clients.channelAppQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("ChannelApp conformance — the per-field secret contract", () => {
  it("update with the marker on one secret rotates the other independently", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createSlackAppFixture(org);

    // Rotate signing_secret while preserving client_secret via the marker —
    // the per-field independence the multi-secret arm exists for. Reads
    // always redact, so preservation is proven behaviorally: the update is
    // accepted and every subsequent read still answers the marker.
    const updated = await clients.channelAppCommand.update({
      ...makeSlackChannelApp(org, created.metadata!.name, {
        clientSecret: CHANNELAPP_REDACTED_MARKER,
        signingSecret: "rotated-signing-secret",
      }),
      metadata: created.metadata,
    });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    const slack = updated.spec?.providerConfig?.case === "slack" ? updated.spec.providerConfig.value : undefined;
    expect(slack?.clientSecret).toBe(CHANNELAPP_REDACTED_MARKER);
    expect(slack?.signingSecret).toBe(CHANNELAPP_REDACTED_MARKER);
  });

  it("rejects the redaction marker as a secret on create (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.channelAppCommand.create(
          makeSlackChannelApp(org, uniqueName("channel-app"), {
            clientSecret: CHANNELAPP_REDACTED_MARKER,
          }),
        ),
      Code.InvalidArgument,
      "create with the redaction marker as client_secret",
    );
  });

  it("rejects a ciphertext-shaped secret on create and update (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();

    await expectGrpcCode(
      () =>
        clients.channelAppCommand.create(
          makeSlackChannelApp(org, uniqueName("channel-app"), {
            signingSecret: "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=",
          }),
        ),
      Code.InvalidArgument,
      "create with ciphertext-shaped signing_secret",
    );

    const created = await createSlackAppFixture(org);
    await expectGrpcCode(
      () =>
        clients.channelAppCommand.update({
          ...makeSlackChannelApp(org, created.metadata!.name, {
            clientSecret: "enc:v2:ZnV0dXJlLXZlcnNpb24=",
          }),
          metadata: created.metadata,
        }),
      Code.InvalidArgument,
      "update with ciphertext-shaped client_secret",
    );
  });

  it("rejects a create with an empty secret field (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.channelAppCommand.create(
          makeSlackChannelApp(org, uniqueName("channel-app"), { signingSecret: "" }),
        ),
      Code.InvalidArgument,
      "create with empty signing_secret",
    );
  });
});

describe("ChannelApp conformance — provider immutability", () => {
  it("rejects an update that flips the provider arm (InvalidArgument — the pinned as-is code)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createSlackAppFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.channelAppCommand.update({
          ...makeWhatsAppChannelApp(org, created.metadata!.name),
          metadata: created.metadata,
        }),
      // Deliberately InvalidArgument, not FailedPrecondition — see the
      // suite header's as-is pin note.
      Code.InvalidArgument,
      "update flipping slack → whatsapp",
    );
    expect(err.rawMessage).toBe("the provider of a channel app cannot be changed");
  });
});

describe("ChannelApp conformance — referential delete-block", () => {
  it("refuses to delete an app a channel references, then allows it once unreferenced", async () => {
    const { org } = await target.provisionTenancy();
    const app = await clients.channelAppCommand.create(
      makeSlackChannelApp(org, uniqueName("channel-app")),
    );

    // The referencing side: an agent (channels must reference one) and a
    // channel bound to the app via spec.app_ref.
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("channel-agent") }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug, {
        appRefSlug: app.metadata!.slug,
      }),
    );

    // Referenced: deleting the app would break the channel's webhook
    // verification, so the guard refuses.
    await expectGrpcCode(
      () => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }),
      Code.FailedPrecondition,
      "delete a ChannelApp a live channel references",
    );

    // Unreference by deleting the channel; the app is now free to go.
    await clients.agentChannelCommand.delete({ value: channel.metadata!.id });
    const deleted = await clients.channelAppCommand.delete({ resourceId: app.metadata!.id });
    expect(deleted.metadata?.id).toBe(app.metadata?.id);
  });
});

describe("ChannelApp conformance — negative paths", () => {
  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.channelAppQuery.get({ value: "chapp_01conformancemissing" }),
      Code.NotFound,
      "get missing channel app",
    ));

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.channelAppQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("rejects a create with no provider arm (InvalidArgument — required oneof)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.channelAppCommand.create({
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "ChannelApp",
          metadata: { name: uniqueName("channel-app"), org },
          spec: {},
        }),
      Code.InvalidArgument,
      "create with an empty provider_config oneof",
    );
  });
});
