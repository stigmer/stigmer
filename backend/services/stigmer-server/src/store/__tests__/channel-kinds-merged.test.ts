/**
 * Pins the driver-neutral half of the merge of the AgentShare and
 * AgentChannel kinds into the Channel kind (../channel-kinds-merged.ts),
 * over rows built the way the releases before it wrote them
 * (channel-merge-rows.ts):
 *   - convertToChannel maps every field a reader reads: a public share's
 *     origins, messages, vaults, run settings, attachers, link token (to
 *     the web type status) and audience; an organization share; a Slack
 *     channel's install state, install facts and app reference, absent or
 *     present, its proactive flag dropped and counted; a WhatsApp channel's
 *     phone number id, app reference and proactive flag, kept;
 *   - the bytes of fields the contract had retired are dropped and
 *     counted, and so is a share's agent pin; any other field number
 *     fails naming it, wherever it sits (the envelope, either kind's spec
 *     and status, a channel's Slack or WhatsApp settings, a vault attacher
 *     entry), as does a field of the wrong wire type, a channel naming no
 *     provider, an install status of the other provider, and a kind the
 *     merge does not convert;
 *   - assignChannelSlugs keeps a shared slug for the older row (by creation
 *     time, a row without one counting as newest in either order, then by
 *     id) and gives the other `<slug>-<type>`, then `-2`; a slug no one
 *     else holds is kept, two organizations never collide, and a suffixed
 *     slug never takes a slug another row holds as its own;
 *   - encodeChannel writes the final slug and stamps the etag a write
 *     would stamp;
 *   - relabelChannelSessionRow moves a guest conversation's share id to the
 *     channel id, keeps a channel id the row already holds, re-stamps an
 *     etag only on a row that had one, and passes over a row without the
 *     label and a kind it does not relabel;
 *   - rekeyedChannelGrant re-keys a grant naming either kind to the
 *     channel's triple under the `grt_` prefix, and passes over a grant on
 *     another kind;
 *   - logChannelMerge warns once, with a count and a capped sample, when
 *     slugs changed, and nothing at warn otherwise;
 *   - the step's names are frozen literals, and its failure names the row
 *     and keeps the cause.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";

import { canonicalTripleText } from "../../domain/grant/constants.js";
import { derivedId } from "../../pipeline/steps/defaults.js";
import {
  AGENT_CHANNEL_MERGE_V37,
  CHANNEL_ID_LABEL_AT_MERGE,
  CHANNEL_MERGE_SLUG_SAMPLE,
  MERGED_CHANNEL_KINDS,
  SHARE_ID_LABEL_AT_MERGE,
  SHARE_MERGE_V37,
  assignChannelSlugs,
  convertToChannel,
  encodeChannel,
  logChannelMerge,
  rekeyedChannelGrant,
  relabelChannelSessionRow,
  unreadableChannelMergeRowError,
} from "../channel-kinds-merged.js";
import type { ConvertedChannel } from "../channel-kinds-merged.js";
import { etagOf } from "../etag.js";
import type { StoreLogger } from "../logger.js";
import { agentChannelRowBytes, MERGE_ORG, shareRowBytes } from "./channel-merge-rows.js";
import type { AgentChannelRow, ShareRow } from "./channel-merge-rows.js";
import { grantRow } from "./retired-instance-rows.js";

const OTHER_ORG = "org_01jz0000000000000000000001";

const reference = (slug: string) => ({ org: MERGE_ORG, slug });

const share = (row: ShareRow): ConvertedChannel => convertToChannel("agent_share", row.id, shareRowBytes(row));
const agentChannel = (row: AgentChannelRow): ConvertedChannel =>
  convertToChannel("agent_channel", row.id, agentChannelRowBytes(row));

/** A stored AgentChannel row whose spec names no provider, which no release wrote. */
function providerlessChannelRow(): Uint8Array {
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .bytes(toBinary(ApiResourceReferenceSchema, create(ApiResourceReferenceSchema, reference("helper"))))
    .finish();
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("AgentChannel")
    .tag(3, WireType.LengthDelimited)
    .bytes(toBinary(ApiResourceMetadataSchema, create(ApiResourceMetadataSchema, { id: "ach_bare", org: MERGE_ORG, slug: "bare" })))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec)
    .tag(5, WireType.LengthDelimited)
    .bytes(new Uint8Array())
    .finish();
}

/** A stored row of either kind holding exactly the given spec and status bytes, and one more envelope field when given. */
function rawRow(kindString: "AgentShare" | "AgentChannel", spec: Uint8Array, status: Uint8Array, extraEnvelopeField?: number): Uint8Array {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string(kindString)
    .tag(3, WireType.LengthDelimited)
    .bytes(toBinary(ApiResourceMetadataSchema, create(ApiResourceMetadataSchema, { id: "raw", org: MERGE_ORG, slug: "raw" })))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec)
    .tag(5, WireType.LengthDelimited)
    .bytes(status);
  if (extraEnvelopeField !== undefined) {
    writer.tag(extraEnvelopeField, WireType.Varint).int32(1);
  }
  return writer.finish();
}

describe("the step's names are frozen literals", () => {
  it("merges agent_share and agent_channel into channel, its grants re-keyed by both", () => {
    expect(MERGED_CHANNEL_KINDS).toEqual(["agent_share", "agent_channel"]);
    expect(SHARE_MERGE_V37.kind).toEqual(["agent_share", "channel"]);
    expect(SHARE_MERGE_V37.kindString).toEqual(["AgentShare", "Channel"]);
    expect(AGENT_CHANNEL_MERGE_V37.kind).toEqual(["agent_channel", "channel"]);
    expect(AGENT_CHANNEL_MERGE_V37.kindString).toEqual(["AgentChannel", "Channel"]);
    expect(SHARE_ID_LABEL_AT_MERGE).toBe("stigmer.ai/share-id");
    expect(CHANNEL_ID_LABEL_AT_MERGE).toBe("stigmer.ai/channel-id");
  });
});

describe("convertToChannel", () => {
  it("converts a public share to a web channel, field by field", () => {
    const converted = share({
      id: "ash_1",
      slug: "support",
      name: "Support",
      labels: { team: "support" },
      createdAt: new Date("2026-01-02T03:04:05Z"),
      agentRef: { ...reference("helper"), id: "agt_1" },
      enabled: true,
      vaults: [reference("keys"), reference("more-keys")],
      runConfig: { modelName: "claude-sonnet", maxCostUsd: 2 },
      vaultAttachers: { vlt_1: "ida_1" },
      audience: ChannelAudience.public,
      allowedOrigins: ["https://example.com", "https://docs.example.com"],
      messages: { rateLimited: "Slow down", unavailable: "Back soon", conversationEnded: "Bye" },
      linkToken: "tok_1",
    });
    expect(converted).toMatchObject({
      fromKind: "agent_share",
      id: "ash_1",
      org: MERGE_ORG,
      slug: "support",
      createdAt: "2026-01-02T03:04:05.000Z",
      type: "web",
      dropped: { slackProactiveFlag: false, sharePin: false, retiredFields: false },
    });
    const channel = converted.channel;
    expect(channel.kind).toBe("Channel");
    expect(channel.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(channel.metadata).toMatchObject({ id: "ash_1", org: MERGE_ORG, slug: "support", name: "Support", labels: { team: "support" } });
    expect(channel.spec?.agentRef).toMatchObject({ ...reference("helper"), id: "agt_1" });
    expect(channel.spec?.enabled).toBe(true);
    expect(channel.spec?.vaults).toMatchObject([reference("keys"), reference("more-keys")]);
    expect(channel.spec?.runConfig).toMatchObject({ modelName: "claude-sonnet", maxCostUsd: 2 });
    expect(channel.spec?.type.case).toBe("web");
    expect(channel.spec?.type.value).toMatchObject({
      audience: ChannelAudience.public,
      allowedOrigins: ["https://example.com", "https://docs.example.com"],
      messages: { rateLimited: "Slow down", unavailable: "Back soon", conversationEnded: "Bye" },
    });
    expect(channel.status?.vaultAttachers).toEqual({ vlt_1: "ida_1" });
    expect(channel.status?.installState).toBe(ChannelInstallState.channel_install_state_unspecified);
    expect(channel.status?.typeStatus.case).toBe("web");
    expect(channel.status?.typeStatus.value).toMatchObject({ linkToken: "tok_1" });
    expect(channel.status?.audit?.specAudit?.createdAt).toBeDefined();
  });

  it("converts an organization share to a web channel of the organization's audience, with no link status when it held no token", () => {
    const converted = share({ id: "ash_2", slug: "internal", agentRef: reference("helper"), audience: ChannelAudience.org });
    expect(converted.type).toBe("web");
    expect(converted.createdAt).toBe("");
    expect(converted.channel.spec?.type).toMatchObject({ case: "web", value: { audience: ChannelAudience.org, allowedOrigins: [] } });
    expect(converted.channel.spec?.vaults).toEqual([]);
    expect(converted.channel.spec?.runConfig).toBeUndefined();
    expect(converted.channel.status?.typeStatus.case).toBeUndefined();
  });

  it("converts a Slack channel: install state and facts kept, app reference absent or present, proactive flag dropped and counted", () => {
    const slackInstall = {
      teamId: "T1",
      teamName: "Acme",
      botUserId: "U1",
      grantedScopes: ["chat:write", "im:history"],
      installerSlackUserId: "U2",
      channelAppId: "cap_1",
    };
    const bare = agentChannel({
      id: "ach_1",
      slug: "support",
      agentRef: reference("helper"),
      enabled: true,
      provider: "slack",
      installState: ChannelInstallState.installed,
      slackInstall,
      vaults: [reference("keys")],
      runConfig: { modelName: "claude-sonnet" },
      vaultAttachers: { vlt_1: "ida_1" },
      proactive: true,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(bare).toMatchObject({
      fromKind: "agent_channel",
      type: "slack",
      createdAt: "2026-03-01T00:00:00.000Z",
      dropped: { slackProactiveFlag: true, sharePin: false, retiredFields: false },
    });
    const bareType = bare.channel.spec?.type;
    expect(bareType?.case).toBe("slack");
    expect(bareType?.case === "slack" ? bareType.value.appRef : "not slack").toBeUndefined();
    expect(bare.channel.spec?.enabled).toBe(true);
    expect(bare.channel.spec?.vaults).toMatchObject([reference("keys")]);
    expect(bare.channel.spec?.runConfig).toMatchObject({ modelName: "claude-sonnet" });
    expect(bare.channel.status?.installState).toBe(ChannelInstallState.installed);
    expect(bare.channel.status?.typeStatus.case).toBe("slack");
    expect(bare.channel.status?.typeStatus.value).toMatchObject(slackInstall);
    expect(bare.channel.status?.vaultAttachers).toEqual({ vlt_1: "ida_1" });

    const bound = agentChannel({
      id: "ach_2",
      slug: "sales",
      agentRef: reference("helper"),
      provider: "slack",
      appRef: reference("slack-app"),
      installState: ChannelInstallState.pending_install,
    });
    expect(bound.channel.spec?.type).toMatchObject({ case: "slack", value: { appRef: reference("slack-app") } });
    expect(bound.channel.status?.installState).toBe(ChannelInstallState.pending_install);
    expect(bound.channel.status?.typeStatus.case).toBeUndefined();
    expect(bound.dropped.slackProactiveFlag).toBe(false);
  });

  it("converts a WhatsApp channel: phone number id, app reference and proactive flag kept", () => {
    const whatsappInstall = { phoneNumberId: "15550001", displayPhoneNumber: "+1 555 0001", verifiedName: "Acme", channelAppId: "cap_2" };
    const converted = agentChannel({
      id: "ach_3",
      slug: "whatsapp-support",
      agentRef: reference("helper"),
      provider: "whatsapp",
      phoneNumberId: "15550001",
      appRef: reference("meta-app"),
      proactive: true,
      installState: ChannelInstallState.installed,
      whatsappInstall,
    });
    expect(converted.type).toBe("whatsapp");
    expect(converted.dropped).toEqual({ slackProactiveFlag: false, sharePin: false, retiredFields: false });
    expect(converted.channel.spec?.type).toMatchObject({
      case: "whatsapp",
      value: { phoneNumberId: "15550001", appRef: reference("meta-app"), proactiveMessagingEnabled: true },
    });
    expect(converted.channel.status?.installState).toBe(ChannelInstallState.installed);
    expect(converted.channel.status?.typeStatus).toMatchObject({ case: "whatsapp", value: whatsappInstall });
  });

  it("drops the bytes of fields the contract had retired, and counts them", () => {
    const fromShare = share({ id: "ash_4", slug: "a", agentRef: reference("helper"), audience: ChannelAudience.public, retiredFieldBytes: true });
    const fromChannel = agentChannel({ id: "ach_4", slug: "b", agentRef: reference("helper"), provider: "slack", retiredFieldBytes: true });
    for (const converted of [fromShare, fromChannel]) {
      expect(converted.dropped.retiredFields, converted.id).toBe(true);
      expect(converted.channel.spec?.$unknown ?? [], converted.id).toEqual([]);
      expect(converted.channel.status?.$unknown ?? [], converted.id).toEqual([]);
      expect(converted.channel.spec?.agentRef, converted.id).toMatchObject(reference("helper"));
    }
  });

  it("drops a share's agent pin and counts it, and counts no pin for an empty one", () => {
    const pinned = share({ id: "ash_5", slug: "a", agentRef: reference("helper"), audience: ChannelAudience.public, agentPin: "agt_1" });
    expect(pinned.dropped).toEqual({ slackProactiveFlag: false, sharePin: true, retiredFields: false });
    expect(pinned.channel.status?.$unknown ?? []).toEqual([]);
    const empty = share({ id: "ash_6", slug: "b", agentRef: reference("helper"), audience: ChannelAudience.public, agentPin: "" });
    expect(empty.dropped.sharePin).toBe(false);
  });

  it("keeps a share enabled when its pin names the agent its reference names", () => {
    const converted = share({ id: "ash_8", slug: "a", agentRef: { org: MERGE_ORG, id: "agt_1" }, enabled: true, audience: ChannelAudience.public, agentPin: "agt_1" });
    expect(converted.channel.spec?.enabled).toBe(true);
    expect(converted.disabledForStalePin).toBe(false);
  });

  it("converts a share whose pin names another agent disabled, as the link answered nothing before", () => {
    const rebound = share({ id: "ash_9", slug: "a", agentRef: { org: MERGE_ORG, id: "agt_2" }, enabled: true, audience: ChannelAudience.public, agentPin: "agt_1" });
    expect(rebound.channel.spec?.enabled).toBe(false);
    expect(rebound.disabledForStalePin).toBe(true);
    const unresolved = share({ id: "ash_10", slug: "b", agentRef: reference("helper"), enabled: true, audience: ChannelAudience.public, agentPin: "agt_1" });
    expect(unresolved.channel.spec?.enabled, "a reference that never resolved to the pinned id").toBe(false);
    expect(unresolved.disabledForStalePin).toBe(true);
  });

  it("refuses a field number the merge does not know, naming it", () => {
    expect(() => share({ id: "ash_7", slug: "a", agentRef: reference("helper"), unknownSpecField: 40 })).toThrow(
      "the share's spec holds field 40, which the merge does not know",
    );
    expect(() => agentChannel({ id: "ach_7", slug: "a", agentRef: reference("helper"), provider: "slack", unknownSpecField: 41 })).toThrow(
      "the agent channel's spec holds field 41, which the merge does not know",
    );
  });

  it("refuses a field number the merge does not know in the envelope, naming it", () => {
    expect(() => convertToChannel("agent_share", "ash_raw", rawRow("AgentShare", new Uint8Array(), new Uint8Array(), 6))).toThrow(
      "the resource holds field 6, which the merge does not know",
    );
  });

  it("refuses a field number the merge does not know in a share's status, naming it", () => {
    const status = new BinaryWriter().tag(7, WireType.Varint).int32(1).finish();
    expect(() => convertToChannel("agent_share", "ash_raw", rawRow("AgentShare", new Uint8Array(), status))).toThrow(
      "the share's status holds field 7, which the merge does not know",
    );
  });

  it("refuses any field in a channel's Slack settings, which declared none", () => {
    const slack = new BinaryWriter().tag(1, WireType.Varint).int32(1).finish();
    const spec = new BinaryWriter().tag(3, WireType.LengthDelimited).bytes(slack).finish();
    expect(() => convertToChannel("agent_channel", "ach_raw", rawRow("AgentChannel", spec, new Uint8Array()))).toThrow(
      "the agent channel's Slack settings holds field 1, which the merge does not know",
    );
  });

  it("refuses a field number the merge does not know in a channel's WhatsApp settings, naming it", () => {
    const whatsapp = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("106540352242922")
      .tag(2, WireType.Varint)
      .int32(1)
      .finish();
    const spec = new BinaryWriter().tag(6, WireType.LengthDelimited).bytes(whatsapp).finish();
    expect(() => convertToChannel("agent_channel", "ach_raw", rawRow("AgentChannel", spec, new Uint8Array()))).toThrow(
      "the agent channel's WhatsApp settings holds field 2, which the merge does not know",
    );
  });

  it("refuses a field number the merge does not know in a channel's status, naming it", () => {
    const spec = new BinaryWriter().tag(3, WireType.LengthDelimited).bytes(new Uint8Array()).finish();
    const status = new BinaryWriter().tag(6, WireType.Varint).int32(1).finish();
    expect(() => convertToChannel("agent_channel", "ach_raw", rawRow("AgentChannel", spec, status))).toThrow(
      "the agent channel's status holds field 6, which the merge does not know",
    );
  });

  it("refuses a field number the merge does not know in a vault attacher entry, naming it", () => {
    const entry = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("vlt_1")
      .tag(2, WireType.LengthDelimited)
      .string("ida_1")
      .tag(3, WireType.Varint)
      .int32(1)
      .finish();
    const status = new BinaryWriter().tag(3, WireType.LengthDelimited).bytes(entry).finish();
    expect(() => convertToChannel("agent_share", "ash_raw", rawRow("AgentShare", new Uint8Array(), status))).toThrow(
      "its vault_attachers entry holds field 3, which the merge does not know",
    );
  });

  it("refuses a field of the wrong wire type, naming the field and both types", () => {
    const spec = new BinaryWriter()
      .tag(3, WireType.LengthDelimited)
      .bytes(new Uint8Array())
      .tag(2, WireType.LengthDelimited)
      .bytes(new Uint8Array([1]))
      .finish();
    expect(() => convertToChannel("agent_channel", "ach_raw", rawRow("AgentChannel", spec, new Uint8Array()))).toThrow(
      `its enabled has wire type ${WireType.LengthDelimited}, not ${WireType.Varint}`,
    );
  });

  it("refuses a channel whose spec names no provider", () => {
    expect(() => convertToChannel("agent_channel", "ach_bare", providerlessChannelRow())).toThrow(
      "its spec names no provider (slack or whatsapp)",
    );
  });

  it("refuses a channel whose install status is the other provider's", () => {
    expect(() =>
      agentChannel({ id: "ach_8", slug: "a", agentRef: reference("helper"), provider: "slack", whatsappInstall: { phoneNumberId: "1" } }),
    ).toThrow("its install status is whatsapp's, and its spec slack's");
    expect(() =>
      agentChannel({ id: "ach_9", slug: "b", agentRef: reference("helper"), provider: "whatsapp", phoneNumberId: "1", slackInstall: { teamId: "T1" } }),
    ).toThrow("its install status is slack's, and its spec whatsapp's");
  });

  it("refuses a kind the merge does not convert, and bytes that do not decode", () => {
    expect(() => convertToChannel("channel", "chn_1", shareRowBytes({ id: "chn_1", slug: "a" }))).toThrow(
      "channel is not a kind the merge converts",
    );
    expect(() => convertToChannel("agent_share", "ash_bad", new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("assignChannelSlugs", () => {
  const at = (iso: string) => new Date(iso);

  it("keeps a shared slug for the older row and gives the other its type as a suffix", () => {
    const rows = [
      agentChannel({ id: "ach_1", slug: "support", provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(new Map([["ach_1", "support-slack"]]));
  });

  it("counts a row with no creation time as the newest", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public }),
      agentChannel({ id: "ach_1", slug: "support", provider: "whatsapp", phoneNumberId: "1", createdAt: at("2026-02-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(new Map([["ash_1", "support-web"]]));
  });

  it("counts a row with no creation time as the newest whichever order the rows come in", () => {
    const timed = agentChannel({ id: "ach_1", slug: "support", provider: "slack", createdAt: at("2026-02-01T00:00:00Z") });
    const untimed = share({ id: "ash_1", slug: "support", audience: ChannelAudience.public });
    expect(assignChannelSlugs([timed, untimed])).toEqual(new Map([["ash_1", "support-web"]]));
    expect(assignChannelSlugs([untimed, timed])).toEqual(new Map([["ash_1", "support-web"]]));
  });

  it("orders two rows created at once by id", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: "support", provider: "slack", createdAt: at("2026-01-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(new Map([["ash_1", "support-web"]]));
  });

  it("numbers a suffixed slug another loser already took", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: "support", provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
      agentChannel({ id: "ach_2", slug: "support", provider: "slack", createdAt: at("2026-03-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(
      new Map([
        ["ach_1", "support-slack"],
        ["ach_2", "support-slack-2"],
      ]),
    );
  });

  it("keeps a slug no other row of its organization held", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: "billing", provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows).size).toBe(0);
  });

  it("never lets two organizations' slugs collide", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-02-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: "support", org: OTHER_ORG, provider: "slack", createdAt: at("2026-01-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows).size).toBe(0);
  });

  it("never gives a loser a slug another row holds as its own, however new that row is", () => {
    const rows = [
      share({ id: "ash_1", slug: "support", audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: "support", provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
      agentChannel({ id: "ach_9", slug: "support-slack", provider: "slack", createdAt: at("2026-09-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(new Map([["ach_1", "support-slack-2"]]));
  });

  it("fits a suffixed slug to the 63 characters a slug may hold, numbered ones too", () => {
    const long = `a${"b".repeat(58)}-c`;
    expect(long).toHaveLength(61);
    const rows = [
      share({ id: "ash_1", slug: long, audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: long, provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
      agentChannel({ id: "ach_2", slug: long, provider: "slack", createdAt: at("2026-03-01T00:00:00Z") }),
    ];
    const changed = assignChannelSlugs(rows);
    expect(changed).toEqual(
      new Map([
        ["ach_1", `a${"b".repeat(56)}-slack`],
        ["ach_2", `a${"b".repeat(54)}-slack-2`],
      ]),
    );
    for (const slug of changed.values()) {
      expect(slug.length, slug).toBeLessThanOrEqual(63);
    }
  });

  it("fits a slug whose cut ends at a hyphen without a doubled hyphen", () => {
    const long = `${"a".repeat(56)}-${"b".repeat(6)}`;
    const rows = [
      share({ id: "ash_1", slug: long, audience: ChannelAudience.public, createdAt: at("2026-01-01T00:00:00Z") }),
      agentChannel({ id: "ach_1", slug: long, provider: "slack", createdAt: at("2026-02-01T00:00:00Z") }),
    ];
    expect(assignChannelSlugs(rows)).toEqual(new Map([["ach_1", `${"a".repeat(56)}-slack`]]));
  });
});

describe("encodeChannel", () => {
  it("writes the final slug and stamps the etag a write would stamp", () => {
    const row = agentChannel({ id: "ach_1", slug: "support", name: "Support", labels: { team: "a" }, provider: "slack", agentRef: reference("helper") });
    const decoded = fromBinary(ChannelSchema, encodeChannel(row, "support-slack"));
    expect(decoded.kind).toBe("Channel");
    expect(decoded.metadata?.id).toBe("ach_1");
    expect(decoded.metadata?.slug).toBe("support-slack");
    expect(decoded.metadata?.etag).not.toBe("");
    expect(decoded.metadata?.etag).toBe(etagOf(ChannelSchema, decoded));
  });
});

describe("relabelChannelSessionRow", () => {
  const session = (labels: Record<string, string>, etag = "") =>
    toBinary(SessionSchema, create(SessionSchema, { metadata: { id: "ses_1", org: MERGE_ORG, labels, etag } }));

  it("moves a guest conversation's share id to the channel id", () => {
    const relabelled = relabelChannelSessionRow("session", session({ [SHARE_ID_LABEL_AT_MERGE]: "ash_1", team: "a" }));
    expect(fromBinary(SessionSchema, relabelled!).metadata?.labels).toEqual({ team: "a", [CHANNEL_ID_LABEL_AT_MERGE]: "ash_1" });
    const run = toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_1", labels: { [SHARE_ID_LABEL_AT_MERGE]: "ash_1" } } }));
    expect(fromBinary(RunSchema, relabelChannelSessionRow("run", run)!).metadata?.labels).toEqual({
      [CHANNEL_ID_LABEL_AT_MERGE]: "ash_1",
    });
  });

  it("keeps a channel id the row already holds", () => {
    const relabelled = relabelChannelSessionRow(
      "session",
      session({ [SHARE_ID_LABEL_AT_MERGE]: "ash_1", [CHANNEL_ID_LABEL_AT_MERGE]: "ach_2" }),
    );
    expect(fromBinary(SessionSchema, relabelled!).metadata?.labels).toEqual({ [CHANNEL_ID_LABEL_AT_MERGE]: "ach_2" });
  });

  it("re-stamps an etag only on a row that had one", () => {
    const stamped = fromBinary(SessionSchema, relabelChannelSessionRow("session", session({ [SHARE_ID_LABEL_AT_MERGE]: "ash_1" }, "stale"))!);
    expect(stamped.metadata?.etag).not.toBe("stale");
    expect(stamped.metadata?.etag).toBe(etagOf(SessionSchema, stamped));
    const unstamped = fromBinary(SessionSchema, relabelChannelSessionRow("session", session({ [SHARE_ID_LABEL_AT_MERGE]: "ash_1" }))!);
    expect(unstamped.metadata?.etag).toBe("");
  });

  it("passes over a row without the share id, and a kind it does not relabel", () => {
    expect(relabelChannelSessionRow("session", session({ [CHANNEL_ID_LABEL_AT_MERGE]: "ach_1" }))).toBeUndefined();
    expect(relabelChannelSessionRow("agent", session({ [SHARE_ID_LABEL_AT_MERGE]: "ash_1" }))).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => relabelChannelSessionRow("session", new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("rekeyedChannelGrant", () => {
  it.each([
    { from: "agent_share", id: "ash_1" },
    { from: "agent_channel", id: "ach_1" },
  ])("re-keys a grant on $from to the channel's triple under a grt_ id", ({ from, id }) => {
    const rekeyed = rekeyedChannelGrant(
      grantRow({ id: "grt_old", principal: "identity_account:ida_1", relation: "viewer", resource: `${from}:${id}` }),
    );
    const migrated = fromBinary(GrantSchema, rekeyed!.data);
    expect(migrated.spec?.resource).toMatchObject({ kind: "channel", id });
    expect(rekeyed!.id).toBe(derivedId("grt", canonicalTripleText(migrated.spec!)));
    expect(rekeyed!.id.startsWith("grt_")).toBe(true);
    expect(migrated.metadata?.id).toBe(rekeyed!.id);
  });

  it("re-keys a grant whose principal is either kind", () => {
    const rekeyed = rekeyedChannelGrant(
      grantRow({ id: "grt_old", principal: "agent_channel:ach_1", relation: "viewer", resource: "session:ses_1" }),
    );
    expect(fromBinary(GrantSchema, rekeyed!.data).spec?.principal).toMatchObject({ kind: "channel", id: "ach_1" });
  });

  it("passes over a grant on another kind", () => {
    for (const resource of ["agent:agt_1", "channel:ash_1"]) {
      expect(rekeyedChannelGrant(grantRow({ id: "grt_x", principal: "identity_account:ida_1", relation: "viewer", resource }))).toBeUndefined();
    }
  });
});

describe("logChannelMerge", () => {
  function recording(): { readonly warned: Array<{ message: string; fields?: Record<string, unknown> }>; readonly info: Array<Record<string, unknown> | undefined>; readonly logger: StoreLogger } {
    const warned: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const info: Array<Record<string, unknown> | undefined> = [];
    return {
      warned,
      info,
      logger: {
        debug() {},
        info(_message: string, fields?: Record<string, unknown>) {
          info.push(fields);
        },
        warn(message: string, fields?: Record<string, unknown>) {
          warned.push({ message, fields });
        },
      },
    };
  }

  it("warns once with the count and a capped sample when slugs changed", () => {
    const winner = share({ id: "ash_0", slug: "support", agentRef: { org: MERGE_ORG, id: "agt_1" }, audience: ChannelAudience.public, agentPin: "agt_1", createdAt: new Date("2026-01-01T00:00:00Z") });
    const losers = Array.from({ length: CHANNEL_MERGE_SLUG_SAMPLE + 2 }, (_, i) =>
      agentChannel({ id: `ach_${String(i).padStart(2, "0")}`, slug: "support", provider: "slack", proactive: true, createdAt: new Date("2026-02-01T00:00:00Z") }),
    );
    const rows = [winner, ...losers];
    const changed = assignChannelSlugs(rows);
    const { warned, info, logger } = recording();
    logChannelMerge(logger, rows, changed);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.fields?.count).toBe(losers.length);
    const sample = warned[0]!.fields?.sample;
    expect(sample).toHaveLength(CHANNEL_MERGE_SLUG_SAMPLE);
    expect((sample as ReadonlyArray<string>)[0]).toBe(`${MERGE_ORG}/support -> support-slack (ach_00)`);
    expect((sample as ReadonlyArray<string>)[1]).toBe(`${MERGE_ORG}/support -> support-slack-2 (ach_01)`);
    expect(info).toEqual([{ channels: rows.length, slackProactiveFlagsDropped: losers.length, sharePinsDropped: 1, retiredFieldsDropped: 0 }]);
  });

  it("warns once with the count and a capped sample when shares were converted disabled for a stale pin", () => {
    const stale = Array.from({ length: CHANNEL_MERGE_SLUG_SAMPLE + 1 }, (_, i) =>
      share({ id: `ash_${String(i).padStart(2, "0")}`, slug: `link-${i}`, agentRef: { org: MERGE_ORG, id: "agt_2" }, enabled: true, audience: ChannelAudience.public, agentPin: "agt_1" }),
    );
    const { warned, logger } = recording();
    logChannelMerge(logger, stale, assignChannelSlugs(stale));
    expect(warned).toHaveLength(1);
    expect(warned[0]!.message).toContain("converted disabled");
    expect(warned[0]!.fields?.count).toBe(stale.length);
    const sample = warned[0]!.fields?.sample as ReadonlyArray<string>;
    expect(sample).toHaveLength(CHANNEL_MERGE_SLUG_SAMPLE);
    expect(sample[0]).toBe(`${MERGE_ORG}/link-0 (ash_00)`);
  });

  it("logs nothing at warn when no slug changed", () => {
    const rows = [share({ id: "ash_1", slug: "support", audience: ChannelAudience.public })];
    const { warned, logger } = recording();
    logChannelMerge(logger, rows, assignChannelSlugs(rows));
    logChannelMerge(logger, [], new Map());
    expect(warned).toEqual([]);
  });
});

describe("unreadableChannelMergeRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableChannelMergeRowError("agent_share", "ash_1", cause);
    expect(error.message).toBe(
      "agent_share 'ash_1' cannot be read to merge the agent share and agent channel kinds into the channel kind: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
