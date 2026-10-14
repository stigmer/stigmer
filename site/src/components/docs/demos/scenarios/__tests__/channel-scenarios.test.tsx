/**
 * The two channel connect demos (Slack, WhatsApp) answer the channel
 * panel's reads under the list methods the console calls: an agent's
 * channels through AgentChannelQueryController/listByAgent (none before
 * the demo plays) and the organization's channel apps through
 * ChannelAppQueryController/list (none for Slack, the registered Meta app
 * for WhatsApp).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { getResponse, type HttpHandler } from "msw";
import { AgentChannelListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { ChannelAppsSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";

import { ConnectSlackChannel } from "../connect-slack-channel/index";
import { ConnectWhatsAppChannel } from "../connect-whatsapp-channel/index";

const handedFixtures: (readonly HttpHandler[])[] = [];

vi.mock("../../shared/StigmerPreviewProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/StigmerPreviewProvider")>();
  function RecordingPreviewProvider(props: ComponentProps<typeof actual.StigmerPreviewProvider>) {
    handedFixtures.push(props.fixtures ?? []);
    return <actual.StigmerPreviewProvider {...props} />;
  }
  return { StigmerPreviewProvider: RecordingPreviewProvider };
});

afterEach(() => {
  cleanup();
  handedFixtures.length = 0;
});

function fixturesOf(Scenario: ComponentType): readonly HttpHandler[] {
  render(<Scenario />);
  const fixtures = handedFixtures.at(-1);
  if (fixtures === undefined) throw new Error("the scenario handed its preview provider no fixtures");
  return fixtures;
}

async function ask(fixtures: readonly HttpHandler[], service: { readonly typeName: string }, method: string): Promise<JsonValue> {
  const request = new Request(`https://api.example/${service.typeName}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const response = await getResponse([...fixtures], request);
  expect(response?.status).toBe(200);
  return (await response!.json()) as JsonValue;
}

describe("the channel connect demos", () => {
  it.each([
    ["Slack", ConnectSlackChannel, 0],
    ["WhatsApp", ConnectWhatsAppChannel, 1],
  ] as const)("%s answers an agent's channels and the organization's channel apps", async (_name, Scenario, apps) => {
    const fixtures = fixturesOf(Scenario);
    const channels = fromJson(AgentChannelListSchema, await ask(fixtures, AgentChannelQueryController, "listByAgent"));
    expect(channels.entries).toEqual([]);
    const channelApps = fromJson(ChannelAppsSchema, await ask(fixtures, ChannelAppQueryController, "list"));
    expect(channelApps.entries).toHaveLength(apps);
  });
});
