/**
 * The launcher's first question, over a fake server: who sees it (a person
 * who may make agents, in an organization where nothing has ever run, when
 * the host asks for it, and never under a deep link, a guest or a pending
 * answer), what a pick does (the example's agent made with create, a taken
 * name read and used as it is and never applied over, "Describe your own"
 * under the next free name), what the chosen state shows (the key step first
 * when nothing can run, then the composer holding the agent, the sample
 * files and the first message), the ways out ("Change", "Just chat") and
 * the failures' words, and that the question ends once its session is
 * created. The composer is a probe that shows what it was mounted with; the
 * real composer's starting message is pinned in useComposer's own suite.
 * The suite's title holds CON-06 on the UX bar (test/ux-bar.json).
 */
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StigmerError, type AgentInput, type ResourceRef } from "@stigmer/client";
import { EXAMPLES } from "@stigmer/examples";
import type { SessionComposerProps } from "../../composer";
import {
  ANTHROPIC_CONNECTED,
  NOTHING_CONNECTED,
  ORG_ID,
  fakeClient,
  readinessWrapper,
  server,
  storedKey,
} from "../../models/__tests__/readiness-fixture";
import type { UseNewSessionFlowOptions } from "../useNewSessionFlow";
import { OWN_AGENT_FILE_LINE } from "../first-question/useStartFromExample";

const flow = vi.hoisted(() => ({ setAgentRef: vi.fn(), setResolution: vi.fn() }));

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    // Shows what the composer was mounted with; Send is free when the launcher holds nothing.
    SessionComposer: ({ onSubmit, sendBlockedReason, initialAgentRef, initialFiles, initialMessage, placeholder }: SessionComposerProps) => (
      <div role="group" aria-label="Composer">
        <p>agent: {initialAgentRef ? `${initialAgentRef.org}/${initialAgentRef.slug}` : "none"}</p>
        <p>files: {(initialFiles ?? []).map((file) => file.name).join(", ")}</p>
        <p>message: {initialMessage ?? ""}</p>
        <p>placeholder: {placeholder}</p>
        <button type="button" aria-label="Send message" disabled={sendBlockedReason !== undefined} onClick={() => void onSubmit(initialMessage ?? "hello")} />
      </div>
    ),
  };
});

vi.mock("../facets/SetupTab", () => ({ SetupTab: () => null, RunConfigSection: () => null }));

vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: (options: UseNewSessionFlowOptions) => ({
    harness: "stigmer" as const,
    setHarness: vi.fn(),
    modelId: undefined,
    setModelId: vi.fn(),
    clearModelPick: vi.fn(),
    agentRef: null,
    setAgentRef: flow.setAgentRef,
    resolution: null,
    setResolution: flow.setResolution,
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
    submit: async () => options.onSessionCreated("ses_first"),
  }),
}));

import { NewSessionViewer, type NewSessionViewerProps } from "../NewSessionViewer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  flow.setAgentRef.mockClear();
  flow.setResolution.mockClear();
});
afterEach(cleanup);

const QUESTION = "What should your agent do for your users?";
const TODAY = "What would you like to work on?";
const VARIANCE = EXAMPLES.find((example) => example.id === "variance-report")!;
const INVOICE = EXAMPLES.find((example) => example.id === "invoice-match")!;

/** What has run in the organization, as the all-time run summary answers it. */
function summary(completed: number) {
  return { activeCount: 0, phaseCounts: completed > 0 ? { completed } : {} };
}

interface Setup {
  readonly readiness?: typeof ANTHROPIC_CONNECTED;
  readonly canManage?: boolean;
  readonly ran?: number;
  /** Never answers "has anything run", so the gate stays pending. */
  readonly summaryNeverAnswers?: boolean;
  readonly create?: (input: AgentInput) => Promise<unknown>;
}

/** The fake server, with the reads and writes the first question adds. */
function setup({ readiness = ANTHROPIC_CONNECTED, canManage = true, ran = 0, summaryNeverAnswers = false, create }: Setup = {}) {
  const fake = server({ readiness, canManage });
  const calls = fakeClient(fake);
  calls.setKey.mockImplementation(async (input: { provider: string }) => {
    fake.readiness = ANTHROPIC_CONNECTED;
    fake.keys = [storedKey(input.provider)];
    return storedKey(input.provider);
  });
  const getRunSummary = vi.fn(() => (summaryNeverAnswers ? new Promise(() => {}) : Promise.resolve(summary(ran))));
  const made = (input: AgentInput) => ({ metadata: { org: ORG_ID, slug: input.slug ?? "", name: input.name } });
  const agent = {
    create: vi.fn(create ?? (async (input: AgentInput) => made(input))),
    getByReference: vi.fn(async (ref: ResourceRef) => ({ metadata: { org: ORG_ID, slug: ref.slug, name: "Variance Reporter" } })),
    apply: vi.fn(),
  };
  const client = { ...calls.client, run: { getRunSummary }, agent };
  return { calls, client, agent, getRunSummary };
}

function launch(client: unknown, props: Partial<NewSessionViewerProps> = {}) {
  const onSessionCreated = vi.fn();
  render(<NewSessionViewer org={ORG_ID} onSessionCreated={onSessionCreated} firstQuestion {...props} />, {
    wrapper: readinessWrapper(client),
  });
  return { onSessionCreated };
}

/** The Connect codes the refusals carry (connectrpc's `Code`, which this package does not depend on). */
const Code = { AlreadyExists: 6, PermissionDenied: 7, Unavailable: 14 } as const;

const taken = () => new StigmerError("already-exists", "Agent slug 'taken' already exists in Acme Research", Code.AlreadyExists);

describe("CON-06 a new person's first screen asks what their agent should do for their users; one pick makes the agent and puts its sample and first message in front of them", () => {
  describe("who sees the question", () => {
    it("asks it in an organization where nothing has run, of a person who may make agents", async () => {
      const { client } = setup();
      launch(client);
      expect(await screen.findByRole("heading", { level: 1, name: QUESTION })).toBeTruthy();
      expect(screen.getByText(/Stigmer runs agents inside your product, doing jobs for your users/)).toBeTruthy();
      for (const example of EXAMPLES) expect(screen.getByRole("button", { name: example.name })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Describe it" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Just chat with Stigmer" })).toBeTruthy();
      expect(screen.queryByRole("group", { name: "Composer" })).toBeNull();
    });

    it("describes each card by whose product it is and what goes in and comes out", async () => {
      const { client } = setup();
      launch(client);
      const card = await screen.findByRole("button", { name: VARIANCE.name });
      expect(card.getAttribute("aria-describedby")).toBeTruthy();
      expect(within(card).getByText(VARIANCE.for)).toBeTruthy();
      expect(within(card).getByText(VARIANCE.gives)).toBeTruthy();
      expect(within(card).getByText(VARIANCE.gets)).toBeTruthy();
      expect(within(card).getByText("ledger.csv")).toBeTruthy();
    });

    it("is off unless the host asks for it", async () => {
      const { client } = setup();
      launch(client, { firstQuestion: false });
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
    });

    it("is not asked where something has run", async () => {
      const { client } = setup({ ran: 3 });
      launch(client);
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
    });

    it("is not asked of a member who may not make agents", async () => {
      const { client } = setup({ canManage: false });
      launch(client);
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
    });

    it("never meets a person a deep link sends to a specific agent", async () => {
      const { client, getRunSummary } = setup();
      launch(client, { initialAgentRef: { org: "acme", slug: "reviewer" } });
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(getRunSummary).not.toHaveBeenCalled();
    });

    it("never meets a person a plugin page's Start a chat sends to chat with that plugin", async () => {
      const { client, getRunSummary } = setup();
      launch(client, { initialPluginRefs: [{ org: "acme", slug: "ledger-tools" }] });
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(getRunSummary).not.toHaveBeenCalled();
    });

    it("never meets a guest", async () => {
      const { client, getRunSummary } = setup();
      launch(client, { audience: "guest", initialAgentRef: { org: "acme", slug: "helper" } });
      await screen.findByRole("group", { name: "Composer" });
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(getRunSummary).not.toHaveBeenCalled();
    });

    it("holds its place while the answer is pending: neither the question nor the composer flashes", async () => {
      const { client, getRunSummary } = setup({ summaryNeverAnswers: true });
      launch(client);
      await waitFor(() => expect(getRunSummary).toHaveBeenCalled());
      expect(screen.getByText("Loading").closest("[aria-busy=true]")).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(screen.queryByText(TODAY)).toBeNull();
      expect(screen.queryByRole("group", { name: "Composer" })).toBeNull();
    });
  });

  describe("a pick", () => {
    it("makes the example's agent with create, and the composer holds the agent, its sample and its first message", async () => {
      const { client, agent } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));

      expect(await screen.findByRole("heading", { level: 1, name: "Send it the sample" })).toBeTruthy();
      expect(agent.create).toHaveBeenCalledTimes(1);
      expect(agent.create.mock.calls[0]![0]).toMatchObject({
        name: "Variance Reporter",
        slug: "variance-reporter",
        org: ORG_ID,
        instructions: VARIANCE.agent.instructions,
        disallowedTools: ["Bash"],
      });
      expect(agent.apply).not.toHaveBeenCalled();
      const composer = screen.getByRole("group", { name: "Composer" });
      expect(within(composer).getByText(`agent: ${ORG_ID}/variance-reporter`)).toBeTruthy();
      expect(within(composer).getByText("files: ledger.csv")).toBeTruthy();
      expect(within(composer).getByText(`message: ${VARIANCE.message}`)).toBeTruthy();
      expect(await screen.findByText("Variance Reporter is made. Its sample ledger is attached.")).toBeTruthy();
    });

    it("lands focus on what was made and says so politely", async () => {
      const { client } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      const line = await screen.findByText("Variance Reporter is made. Its sample ledger is attached.");
      await waitFor(() => expect(document.activeElement?.contains(line)).toBe(true));
      expect(screen.getByText("Variance Reporter is made.", { selector: "[aria-live=polite]" })).toBeTruthy();
    });

    it("attaches every sample of a two-file example and says so", async () => {
      const { client } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: INVOICE.name }));
      expect(await screen.findByText("files: invoice-4471.csv, po-2210.csv")).toBeTruthy();
      expect(await screen.findByText("Invoice Matcher is made. Its sample invoice and purchase order are attached.")).toBeTruthy();
    });

    it("uses an agent whose name is taken as it is: read by its name, never applied over", async () => {
      const { client, agent } = setup({
        create: async () => {
          throw taken();
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      expect(await screen.findByText(`agent: ${ORG_ID}/variance-reporter`)).toBeTruthy();
      expect(agent.getByReference).toHaveBeenCalledWith({ org: ORG_ID, slug: "variance-reporter" });
      expect(agent.apply).not.toHaveBeenCalled();
    });

    it("shows the key step under the chosen bar when nothing can run, then the composer once the key is in", async () => {
      const { client, calls } = setup({ readiness: NOTHING_CONNECTED });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));

      expect(await screen.findByRole("heading", { level: 1, name: "One more thing before it runs" })).toBeTruthy();
      expect(await screen.findByText("Variance Reporter is made. Its sample ledger is attached.")).toBeTruthy();
      expect(screen.queryByText("Connect a model provider to start")).toBeNull();
      expect(screen.queryByRole("group", { name: "Composer" })).toBeNull();
      const card = await screen.findByRole("article", { name: "Anthropic" });
      fireEvent.change(await within(card).findByLabelText("Anthropic API key"), { target: { value: "sk-ant-first" } });
      fireEvent.click(within(card).getByRole("button", { name: "Connect Anthropic" }));

      expect(await screen.findByRole("heading", { level: 1, name: "Send it the sample" })).toBeTruthy();
      expect(calls.setKey).toHaveBeenCalled();
      const composer = screen.getByRole("group", { name: "Composer" });
      expect(within(composer).getByText("files: ledger.csv")).toBeTruthy();
      expect(within(composer).getByText(`message: ${VARIANCE.message}`)).toBeTruthy();
      expect(within(composer).getByRole("button", { name: "Send message" })).toHaveProperty("disabled", false);
    });

    it("goes back to the cards on Change, clearing the picked agent, and a second pick mounts its own composer", async () => {
      const { client } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      await screen.findByText("files: ledger.csv");
      fireEvent.click(screen.getByRole("button", { name: "Change" }));

      expect(await screen.findByRole("heading", { level: 1, name: QUESTION })).toBeTruthy();
      expect(flow.setAgentRef).toHaveBeenCalledWith(null);
      fireEvent.click(screen.getByRole("button", { name: INVOICE.name }));
      expect(await screen.findByText(`agent: ${ORG_ID}/invoice-matcher`)).toBeTruthy();
      expect(screen.getByText("files: invoice-4471.csv, po-2210.csv")).toBeTruthy();
    });
  });

  describe("describe your own", () => {
    it("makes their words the instructions, with the line about files, under the next free name", async () => {
      const { client, agent } = setup({
        create: async (input) => {
          if (input.slug === "your-agent") throw taken();
          return { metadata: { org: ORG_ID, slug: input.slug, name: input.name } };
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Describe it" }));
      const words = "Read a user's shipping manifest and list every late parcel.";
      fireEvent.change(screen.getByLabelText("Describe your own"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Make this agent" }));

      expect(await screen.findByRole("heading", { level: 1, name: "Give it a first job" })).toBeTruthy();
      expect(agent.create.mock.calls.map(([input]) => input.slug)).toEqual(["your-agent", "your-agent-2"]);
      expect(agent.create.mock.calls[1]![0]).toMatchObject({ name: "Your agent 2", instructions: `${words}\n\n${OWN_AGENT_FILE_LINE}` });
      expect(agent.getByReference).not.toHaveBeenCalled();
      const composer = screen.getByRole("group", { name: "Composer" });
      expect(within(composer).getByText(`agent: ${ORG_ID}/your-agent-2`)).toBeTruthy();
      expect(within(composer).getByText("files:")).toBeTruthy();
      expect(within(composer).getByText("placeholder: Attach one of your own files and say what you need")).toBeTruthy();
    });

    it("describes the agent by the first line of their words, cut at a word when it runs long", async () => {
      const { client, agent } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Describe it" }));
      const words = `${"Read every shipping manifest a user uploads and ".repeat(5)}list the late parcels.\nThen sort them by how late they are.`;
      fireEvent.change(screen.getByLabelText("Describe your own"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Make this agent" }));
      await screen.findByRole("heading", { level: 1, name: "Give it a first job" });
      const description = agent.create.mock.calls[0]![0].description ?? "";
      expect(description.endsWith("\u2026")).toBe(true);
      expect(description.length).toBeLessThanOrEqual(161);
      expect(words.startsWith(description.slice(0, -1))).toBe(true);
      expect(description.slice(0, -1).endsWith(" ")).toBe(false);
    });

    it("goes back to the examples from the open box", async () => {
      const { client } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Describe it" }));
      fireEvent.click(screen.getByRole("button", { name: "Back to examples" }));
      expect(await screen.findByRole("button", { name: "Describe it" })).toBeTruthy();
      expect(screen.queryByLabelText("Describe your own")).toBeNull();
    });

    it("says who can when the server refuses a described agent", async () => {
      const { client } = setup({
        create: async () => {
          throw new StigmerError("permission-denied", "not allowed", Code.PermissionDenied);
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Describe it" }));
      fireEvent.change(screen.getByLabelText("Describe your own"), { target: { value: "Summarize a report." } });
      fireEvent.click(screen.getByRole("button", { name: "Make this agent" }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Your agent wasn't made.")).toBeTruthy();
      expect(within(alert).getByText(/You can't make agents in this organization/)).toBeTruthy();
    });

    it("says so after ten taken names instead of trying forever", async () => {
      const { client, agent } = setup({
        create: async () => {
          throw taken();
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Describe it" }));
      fireEvent.change(screen.getByLabelText("Describe your own"), { target: { value: "Summarize a report." } });
      fireEvent.click(screen.getByRole("button", { name: "Make this agent" }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Your agent wasn't made.")).toBeTruthy();
      expect(within(alert).getByText(/already has 10 agents named Your agent/)).toBeTruthy();
      expect(agent.create).toHaveBeenCalledTimes(10);
    });
  });

  describe("the ways out and the failures", () => {
    it("Just chat returns today's launcher, with no agent picked", async () => {
      const { client } = setup();
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: "Just chat with Stigmer" }));
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.getByText("agent: none")).toBeTruthy();
      expect(flow.setAgentRef).toHaveBeenCalledWith(null);
    });

    it("says who can when the server refuses, with Try again and Just chat", async () => {
      const { client, agent } = setup({
        create: async () => {
          throw new StigmerError("permission-denied", "not allowed", Code.PermissionDenied);
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Variance Reporter wasn't made.")).toBeTruthy();
      expect(within(alert).getByText("You can't make agents in this organization. An admin can make it and share it with you.")).toBeTruthy();
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(agent.create).toHaveBeenCalledTimes(2));
      expect(within(alert).getByRole("button", { name: "Just chat with Stigmer" })).toBeTruthy();
    });

    it("says what the server said for any other failure, and that nothing changed", async () => {
      const { client } = setup({
        create: async () => {
          throw new StigmerError("unavailable", "The server is restarting", Code.Unavailable);
        },
      });
      launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("The server is restarting. Nothing in your organization changed.")).toBeTruthy();
    });

    it("ends once its session is created: the launcher, kept mounted, does not ask again", async () => {
      const { client } = setup();
      const { onSessionCreated } = launch(client);
      fireEvent.click(await screen.findByRole("button", { name: VARIANCE.name }));
      fireEvent.click(await screen.findByRole("button", { name: "Send message" }));
      await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith("ses_first"));
      expect(await screen.findByRole("heading", { level: 1, name: TODAY })).toBeTruthy();
      expect(screen.queryByText(QUESTION)).toBeNull();
    });
  });
});
