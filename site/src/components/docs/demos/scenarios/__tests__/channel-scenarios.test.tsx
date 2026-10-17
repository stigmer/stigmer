/**
 * The two channel connect demos (Slack, WhatsApp) answer the channel
 * panel's reads under the list methods the console calls: an agent's
 * channels through ChannelQueryController/listByAgent (none before
 * the demo plays) and the organization's channel apps through
 * ChannelAppQueryController/list (none for Slack, the registered Meta app
 * for WhatsApp); and the caller's permission check through
 * GrantQueryController/checkMyPermission, which says yes, so the panel
 * shows its connect affordance to the demo's editor. The dialog's advisory
 * read of the organization's channels (ChannelQueryController/list) answers
 * none.
 *
 * The player is pinned to one beat, its step-change callback fired the way
 * Scenar's timed player fires it, and the page's fetches are answered by the
 * fixtures the scenario handed its preview provider, so the real
 * ChannelsPanel draws each beat: empty before the connect, the installed
 * channel after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { type ComponentProps, type ComponentType, type ReactNode, useEffect } from "react";
import type { ScenarioStep } from "@scenar/core";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { getResponse, type HttpHandler } from "msw";
import { ChannelListSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelAppsSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/io_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { CheckAuthorizationResultSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";

import { ConnectSlackChannel } from "../connect-slack-channel/index";
import { ConnectWhatsAppChannel } from "../connect-whatsapp-channel/index";
import { connectSlackSteps } from "../connect-slack-channel/steps";
import { connectWhatsAppSteps } from "../connect-whatsapp-channel/steps";

const handedFixtures: (readonly HttpHandler[])[] = [];

/** The beat the stand-in player draws. */
const playback: { beat: number } = { beat: 0 };

vi.mock("@scenar/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scenar/react")>();
  function PinnedBeatPlayer<T>(props: {
    readonly steps?: ScenarioStep<T>[];
    readonly children: (data: T, stepIndex: number) => ReactNode;
    readonly onStepChange?: (data: T, index: number) => void;
  }) {
    const { steps, children, onStepChange } = props;
    const step = steps?.[playback.beat];
    if (step === undefined) throw new Error(`the scenario has no beat ${playback.beat}`);
    useEffect(() => {
      onStepChange?.(step.data, playback.beat);
    }, [onStepChange, step]);
    return <div data-demo-step={playback.beat}>{children(step.data, playback.beat)}</div>;
  }
  return { ...actual, ScenarioPlayer: PinnedBeatPlayer };
});

vi.mock("../../shared/StigmerPreviewProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/StigmerPreviewProvider")>();
  function RecordingPreviewProvider(props: ComponentProps<typeof actual.StigmerPreviewProvider>) {
    handedFixtures.push(props.fixtures ?? []);
    return <actual.StigmerPreviewProvider {...props} />;
  }
  return { StigmerPreviewProvider: RecordingPreviewProvider };
});

/** Answers a fetch the way the scenario's MSW fixtures do; anything else is a 404. */
async function answerFromFixtures(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const request = new Request(new URL(url, "https://docs.example/"), input instanceof Request ? input : init);
  const response = await getResponse([...(handedFixtures.at(-1) ?? [])], request);
  return response ?? new Response(null, { status: 404 });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(answerFromFixtures));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  handedFixtures.length = 0;
  playback.beat = 0;
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
    const channels = fromJson(ChannelListSchema, await ask(fixtures, ChannelQueryController, "listByAgent"));
    expect(channels.entries).toEqual([]);
    const channelApps = fromJson(ChannelAppsSchema, await ask(fixtures, ChannelAppQueryController, "list"));
    expect(channelApps.entries).toHaveLength(apps);
  });

  it.each([
    ["Slack", ConnectSlackChannel],
    ["WhatsApp", ConnectWhatsAppChannel],
  ] as const)("%s answers the caller's permission check yes", async (_name, Scenario) => {
    const fixtures = fixturesOf(Scenario);
    const answer = fromJson(CheckAuthorizationResultSchema, await ask(fixtures, GrantQueryController, "checkMyPermission"));
    expect(answer.isAuthorized).toBe(true);
  });

  it.each([
    ["Slack", ConnectSlackChannel],
    ["WhatsApp", ConnectWhatsAppChannel],
  ] as const)("%s answers the dialog's organization-wide channel read with none", async (_name, Scenario) => {
    const fixtures = fixturesOf(Scenario);
    const channels = fromJson(ChannelListSchema, await ask(fixtures, ChannelQueryController, "list"));
    expect(channels.entries).toEqual([]);
  });

  it.each([
    ["Slack", ConnectSlackChannel, connectSlackSteps],
    ["WhatsApp", ConnectWhatsAppChannel, connectWhatsAppSteps],
  ] as const)("%s draws the real channels panel: empty before the connect, the installed channel after", async (_name, Scenario, steps) => {
    playback.beat = steps.findIndex((step) => step.data.view === "channels-empty");
    render(<Scenario />);
    expect(await screen.findByText("No channels yet")).toBeTruthy();
    cleanup();

    playback.beat = steps.findIndex((step) => step.data.view === "channels-connected");
    render(<Scenario />);
    expect(await screen.findByText("1 channel")).toBeTruthy();
  });
});
