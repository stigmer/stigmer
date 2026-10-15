/**
 * Pins the deleting rule's seat on both guest profile lanes
 * (steps.ts `loadLinkedChannel`, run by LoadChannelForProfile and
 * LoadChannelForMemberProfile): a hosted chat link names only its web
 * channel, so neither the deleting rule's interceptor nor the anonymous
 * lane's Authorizer sees the channel's organization. A web channel whose
 * organization is being deleted answers the lanes' one refusal
 * (linkNotFound), byte-identical to a missing channel's, while the
 * organization's row still stands; a web channel of a live organization
 * loads as before; a deletion table that cannot be read is an
 * infrastructure fault (INTERNAL), never a pass. Real sqlite store.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { makeOrganization } from "../../../store/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { linkNotFound, loadLinkedChannel } from "../steps.js";

const ORG = "org_01j9deletingorganization0";
const CHANNEL_ID = "chn_01j9linkedchannel";

describe("a hosted chat link of an organization being deleted", () => {
  let temp: TempStore;

  beforeEach(async () => {
    temp = tempStore();
    await temp.store.saveResource(
      ApiResourceKind.organization,
      ORG,
      OrganizationSchema,
      makeOrganization({ id: ORG, slug: "acme" }),
    );
    await temp.store.saveResource(
      ApiResourceKind.channel,
      CHANNEL_ID,
      ChannelSchema,
      create(ChannelSchema, {
        metadata: { id: CHANNEL_ID, org: ORG },
        spec: { enabled: true, type: { case: "web", value: {} } },
      }),
    );
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("loads while the organization is live", async () => {
    const channel = await loadLinkedChannel(temp.store, CHANNEL_ID);
    expect(channel.metadata?.id).toBe(CHANNEL_ID);
  });

  it("answers the missing channel's refusal once the organization is marked, its row still standing", async () => {
    await temp.store.organizationDeletions.mark(ORG, new Date().toISOString());
    const error = await loadLinkedChannel(temp.store, CHANNEL_ID).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe(
      linkNotFound(CHANNEL_ID).rawMessage,
    );
  });

  it("answers INTERNAL when the deletion table cannot be read", async () => {
    vi.spyOn(temp.store.organizationDeletions, "isDeleting").mockRejectedValueOnce(
      new Error("store down"),
    );
    const error = await loadLinkedChannel(temp.store, CHANNEL_ID).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
