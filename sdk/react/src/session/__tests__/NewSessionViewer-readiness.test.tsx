/**
 * The launcher's readiness before Send, over a fake server's readiness
 * answer. Pins the three states: nothing can run on any engine, so the
 * connect step takes the composer's place with this person's act (an
 * admin's form, a member's line, a laptop's command, and the first provider
 * the server reports missing when it judged none of this engine's models);
 * only the chosen model
 * cannot run, so one line above the composer says why and Send is held with
 * that reason; and everything else, an unknown provider included, blocks
 * nothing. A guest is never judged. The composer is a probe that records
 * what the launcher hands it; the held Send itself is pinned on the real
 * composer in SessionComposer-sendBlocked. The suite's title holds CON-03 on
 * the UX bar (test/ux-bar.json).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ResourceRef } from "@stigmer/client";
import { create } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  GetModelReadinessOutputSchema,
  ProviderAvailability,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import type { SessionComposerProps } from "../../composer";
import {
  ANTHROPIC_CONNECTED,
  LAPTOP_WITHOUT_KEYS,
  NOTHING_CONNECTED,
  NOTHING_CONNECTED_BESIDE_UNJUDGED,
  OPENAI_ONLY,
  ORG_ID,
  fakeClient,
  readiness,
  readinessWrapper,
  server,
  type FakeServer,
} from "../../models/__tests__/readiness-fixture";

const composerProps: SessionComposerProps[] = [];

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: SessionComposerProps) => {
      composerProps.push(props);
      return <div data-testid="composer-probe" />;
    },
  };
});

vi.mock("../facets/SetupTab", () => ({ SetupTab: () => null }));

const flow = {
  harness: "stigmer" as const,
  setHarness: vi.fn(),
  modelId: undefined as string | undefined,
  setModelId: vi.fn(),
  clearModelPick: vi.fn(),
  agentRef: null,
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  agentRunDefaults: undefined,
  pluginRefs: [] as ResourceRef[],
  setPluginRefs: vi.fn(),
  skillRefs: [] as ResourceRef[],
  setSkillRefs: vi.fn(),
  workspace: { entries: [], hasEntries: false, toInput: vi.fn(() => []), addGitRepo: vi.fn(), addLocalPath: vi.fn(), remove: vi.fn(), clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  offersEnvironment: false,
  environmentDefaults: undefined,
  isSubmitting: false,
  submitError: null,
  submitFailure: null,
  submit: vi.fn(),
};
let mockFlow = flow;

vi.mock("../useNewSessionFlow", () => ({ useNewSessionFlow: () => mockFlow }));

import { NewSessionViewer } from "../NewSessionViewer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => {
  cleanup();
  composerProps.length = 0;
  mockFlow = flow;
});

function renderLauncher(
  fake: FakeServer,
  options: { mode?: "cloud" | "local"; audience?: "guest"; modelsHubHref?: string } = {},
) {
  const calls = fakeClient(fake);
  render(
    <NewSessionViewer
      org={ORG_ID}
      onSessionCreated={vi.fn()}
      audience={options.audience}
      initialAgentRef={options.audience === "guest" ? { org: ORG_ID, slug: "helper" } : undefined}
      modelsHubHref={options.modelsHubHref}
    />,
    { wrapper: readinessWrapper(calls.client, options.mode) },
  );
  return calls;
}

const lastComposer = () => composerProps.at(-1);

describe("CON-03 the launcher says a provider is missing before a run fails", () => {
  it("puts the connect step in the composer's place when nothing can run, with an admin's key form", async () => {
    renderLauncher(server({ readiness: NOTHING_CONNECTED }));

    expect(await screen.findByRole("heading", { level: 1, name: "Connect a model provider to start" })).toBeTruthy();
    expect(
      screen.getByText(
        "Claude Sonnet 4.6 on Stigmer runs on Anthropic. Once Acme Research has an Anthropic key, you can send your first task.",
      ),
    ).toBeTruthy();
    const card = screen.getByRole("article", { name: "Anthropic" });
    await waitFor(() => expect(within(card).getByLabelText("Anthropic API key")).toBeTruthy());
    expect(screen.getByRole("link", { name: "every provider is in Models & providers" }).getAttribute("href")).toBe("/models");
    expect(screen.getByText(/Or connect OpenAI/)).toBeTruthy();
    expect(screen.queryByTestId("composer-probe")).toBeNull();
    expect(screen.queryByText("Press Enter to send, Shift+Enter for a new line")).toBeNull();
  });

  it("puts the connect step there too beside a model the server judges no provider for", async () => {
    renderLauncher(server({ readiness: NOTHING_CONNECTED_BESIDE_UNJUDGED }));

    expect(await screen.findByRole("heading", { level: 1, name: "Connect a model provider to start" })).toBeTruthy();
    expect(screen.queryByTestId("composer-probe")).toBeNull();
  });

  it("tells a member who connects the provider, in the same place", async () => {
    renderLauncher(server({ readiness: NOTHING_CONNECTED, canManage: false }));

    const card = await screen.findByRole("article", { name: "Anthropic" });
    await waitFor(() => expect(within(card).getByText(/An admin of Acme Research connects Anthropic/)).toBeTruthy());
    expect(within(card).queryByLabelText("Anthropic API key")).toBeNull();
    expect(screen.queryByTestId("composer-probe")).toBeNull();
  });

  it("shows a laptop the command that gives its runner a key", async () => {
    renderLauncher(server({ readiness: LAPTOP_WITHOUT_KEYS }), { mode: "local" });

    expect(
      await screen.findByText(
        "Claude Sonnet 4.6 on Stigmer runs on Anthropic. Give this machine's runner a key, and you can send your first task.",
      ),
    ).toBeTruthy();
    const card = screen.getByRole("article", { name: "Anthropic" });
    expect(within(card).getByText(/stigmer setup\s+stigmer down && stigmer up/)).toBeTruthy();
    expect(screen.queryByTestId("composer-probe")).toBeNull();
  });

  it("offers the first provider the server reports missing when it judged none of this engine's models", async () => {
    // Nothing runs, and only the Claude Agent engine's model was judged: the
    // launcher's engine (Stigmer) names no provider of its own.
    renderLauncher(
      server({
        readiness: create(GetModelReadinessOutputSchema, {
          providers: [
            { provider: "openai", availability: ProviderAvailability.missing_from_organization },
            { provider: "anthropic", availability: ProviderAvailability.missing_from_organization },
          ],
          models: [
            {
              harness: Harness.CLAUDE,
              model: "claude-sonnet-5",
              provider: "anthropic",
              availability: ProviderAvailability.missing_from_organization,
            },
          ],
        }),
      }),
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Connect a model provider to start" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "OpenAI" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Anthropic" })).toBeNull();
    expect(screen.queryByTestId("composer-probe")).toBeNull();
  });

  it("holds Send with its reason, and says it in one line above the composer, when only the chosen model cannot run", async () => {
    renderLauncher(server({ readiness: OPENAI_ONLY }), { modelsHubHref: "#/models" });

    expect(await screen.findByText("Connect Anthropic to run Claude Sonnet 4.6.")).toBeTruthy();
    expect(screen.getByText("Send waits until Anthropic is connected, or pick a model marked ready.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect Anthropic" }).getAttribute("href")).toBe("#/models");
    expect(screen.getByTestId("composer-probe")).toBeTruthy();
    expect(lastComposer()?.sendBlockedReason).toBe("Connect Anthropic to run Claude Sonnet 4.6.");
    // The picker gets the same answer, to mark the model it shows.
    expect(lastComposer()?.modelReadinessOf?.("stigmer", "claude-sonnet-4.6")?.availability.state).toBe("missing");
    expect(lastComposer()?.modelReadinessOf?.("stigmer", "gpt-5")?.availability.state).toBe("served");
  });

  it("judges the model the person picked, not the engine's default", async () => {
    mockFlow = { ...flow, modelId: "gpt-5" };
    renderLauncher(server({ readiness: OPENAI_ONLY }));

    await waitFor(() => expect(lastComposer()?.modelReadinessOf?.("stigmer", "gpt-5")).toBeTruthy());
    expect(lastComposer()?.sendBlockedReason).toBeUndefined();
    expect(screen.queryByText(/Connect Anthropic to run/)).toBeNull();
  });

  it("says a laptop's fix in the line, for a provider its runner lacks", async () => {
    renderLauncher(
      server({
        readiness: readiness({
          anthropic: ProviderAvailability.missing_from_runners,
          openai: ProviderAvailability.served_by_runners,
        }),
      }),
      { mode: "local" },
    );

    const reason = await screen.findByText("Connect Anthropic to run Claude Sonnet 4.6.");
    expect(reason.closest("p")?.textContent).toContain("Run stigmer setup, then stigmer down && stigmer up.");
    expect(screen.getByRole("link", { name: "Models & providers" }).getAttribute("href")).toBe("/models");
  });

  it("blocks nothing when the chosen model can run", async () => {
    const calls = renderLauncher(server({ readiness: ANTHROPIC_CONNECTED }));

    await waitFor(() => expect(calls.getModelReadiness).toHaveBeenCalled());
    await waitFor(() => expect(lastComposer()?.modelReadinessOf?.("stigmer", "claude-sonnet-4.6")).toBeTruthy());
    expect(lastComposer()?.sendBlockedReason).toBeUndefined();
    expect(screen.getByRole("heading", { level: 1, name: "What would you like to work on?" })).toBeTruthy();
    expect(screen.queryByText(/Connect Anthropic/)).toBeNull();
  });

  it("blocks nothing for a provider the server cannot see", async () => {
    renderLauncher(
      server({
        readiness: readiness({
          anthropic: ProviderAvailability.availability_unknown,
          openai: ProviderAvailability.availability_unknown,
        }),
      }),
      { mode: "local" },
    );

    await waitFor(() => expect(lastComposer()?.modelReadinessOf?.("stigmer", "claude-sonnet-4.6")).toBeTruthy());
    expect(lastComposer()?.sendBlockedReason).toBeUndefined();
    expect(screen.queryByText("Connect a model provider to start")).toBeNull();
  });

  it("never judges a guest, who cannot ask", async () => {
    const calls = renderLauncher(server({ readiness: NOTHING_CONNECTED }), { audience: "guest" });

    await waitFor(() => expect(screen.getByTestId("composer-probe")).toBeTruthy());
    expect(calls.getModelReadiness).not.toHaveBeenCalled();
    expect(lastComposer()?.sendBlockedReason).toBeUndefined();
    expect(lastComposer()?.modelReadinessOf).toBeUndefined();
  });
});
