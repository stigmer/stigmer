import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ResourceRef } from "@stigmer/client";

// ---------------------------------------------------------------------------
// Launcher behavior: with the host's inspector the panel chip is PERSISTENT
// chrome (always mounted, not gated on attached context) and the panel opens
// on the attached workspaces' Explorer; without one there is no chip. How the
// first turn runs (engine, model, the auto-approve switch) is a row of the
// composer's configure menu.
//
// The composer is replaced with a prop-capturing probe so these tests exercise
// only the launcher's chrome without pulling in the full composer's provider
// requirements; the run-settings row it is handed is drawn for real.
// ---------------------------------------------------------------------------

const composerProps: Record<string, unknown>[] = [];
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: Record<string, unknown>) => {
      composerProps.push(props);
      return <div data-testid="composer-probe" />;
    },
  };
});

// A launcher flow with ZERO attached context — no agent, no workspace, no
// plugins/skills/vars. This is the case the old `hasContext` gate hid the chip for.
const emptyWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

const setAutoApproveAll = vi.fn();
const stubEmptyFlow = {
  harness: "stigmer" as const,
  setHarness: vi.fn(),
  modelId: undefined,
  setModelId: vi.fn(),
  agentRef: null,
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  pluginRefs: [] as ResourceRef[],
  setPluginRefs: vi.fn(),
  skillRefs: [] as ResourceRef[],
  setSkillRefs: vi.fn(),
  workspace: emptyWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn(), nextPageToken: "" },
  autoApproveAll: false,
  setAutoApproveAll,
  isSubmitting: false,
  submitError: null,
  submitFailure: null as Error | null,
  submit: vi.fn(),
};

// A launcher flow WITH attached context (a git workspace entry). Used to prove
// the composer stays centered regardless of context — the invariant that
// replaced the old `hasContext` position flip (layout stability).
const stubPopulatedFlow = {
  ...stubEmptyFlow,
  workspace: {
    ...emptyWorkspace,
    hasEntries: true,
    entries: [
      {
        id: "e1",
        name: "acme/app",
        type: "git" as const,
        gitUrl: "https://github.com/acme/app.git",
        gitBranch: "main",
      },
    ],
  },
};

// Swappable flow so individual tests can substitute the context-attached
// variant. The mock factory reads `mockFlow` at call time (the `mock` prefix
// is why Vitest permits referencing it inside the hoisted factory); tests
// reassign it before render and `beforeEach` resets it to the empty flow.
let mockFlow: typeof stubEmptyFlow | typeof stubPopulatedFlow = stubEmptyFlow;

vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: () => mockFlow,
}));

// No StigmerProvider here: the launcher's readiness read answers nothing, so
// it neither blocks Send nor shows its connect step (the readiness faces
// have their own suites: launcher-readiness, con-02-first-run).
vi.mock("../../models/hub/ModelsHub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../models/hub/ModelsHub")>();
  return {
    ...actual,
    useModelsHubData: () => ({
      org: "acme",
      orgName: "acme",
      viewer: { canManage: false, local: false },
      providers: null,
      models: null,
      keyOf: () => undefined,
      parentOrgNameOf: () => undefined,
      readinessOf: () => undefined,
      isLoading: true,
      readinessLoading: false,
      error: null,
      refresh: () => {},
    }),
  };
});

import { NewSessionViewer } from "../NewSessionViewer";
import { SessionInspector } from "../inspector/SessionInspector";

beforeEach(() => {
  cleanup();
  composerProps.length = 0;
  mockFlow = stubEmptyFlow;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewSessionViewer — persistent panel chip", () => {
  it("renders the chip with zero attached context (not gated on hasContext)", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} inspector={<SessionInspector />} />);
    expect(screen.getByRole("button", { name: "Show panel" })).toBeTruthy();
  });

  it("offers no chip and no panel without the host's inspector", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();
  });

  it("opens on the Explorer, with no Config facet", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} inspector={<SessionInspector />} />);

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    expect(screen.getByRole("radio", { name: "Explorer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Config" })).toBeNull();
  });

  it("adds a local folder the person picks from the explorer's footer", async () => {
    render(
      <NewSessionViewer
        org="acme"
        onSessionCreated={vi.fn()}
        enableLocal
        onBrowseLocalFolder={async () => "/Users/ada/billing"}
        inspector={<SessionInspector />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Folder" }));
    await waitFor(() => expect(emptyWorkspace.addLocalPath).toHaveBeenCalledWith("/Users/ada/billing"));
  });

  it("keeps the chip mounted as the collapse control once the panel is open", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} inspector={<SessionInspector />} />);

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    // Chip is still present with zero context — now as the hide affordance, so
    // an open panel always has its toggle (the vanishing-toggle defect the old
    // context gate could produce is impossible by construction).
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeTruthy();
  });
});

describe("NewSessionViewer — auto-approve placement (#816 rework)", () => {
  const INDICATOR_TEXT = "Auto-approving tool calls for this session";

  it("shows no indicator while auto-approve is off — the launcher stays clean", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.queryByText(INDICATOR_TEXT)).toBeNull();
  });

  it("shows the armed-only indicator when a seed pre-arms the session, with Turn off", () => {
    mockFlow = { ...stubEmptyFlow, autoApproveAll: true };
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);

    expect(screen.getByText(INDICATOR_TEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(setAutoApproveAll).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("offers the auto-approve switch in the composer's run settings, wired to the flow", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);

    const settings = composerProps.at(-1)?.extraSettings as readonly { item: { id: string }; panel: React.ReactElement }[];
    expect(settings.map((setting) => setting.item.id)).toEqual(["run-settings"]);
    render(settings[0]!.panel);
    const toggle = screen.getByRole("switch", { name: "Auto-approve" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(setAutoApproveAll).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("NewSessionViewer — composer stays centered", () => {
  // The composer's wrapper is the probe's parent (wrapper > h1 + composer +
  // footer). `my-auto` is unconditional safe-centering; the old `my-6`
  // top-anchor that appeared once context was attached is gone.
  const composerWrapper = () => screen.getByTestId("composer-probe").parentElement;

  it("centers the composer with zero attached context", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(composerWrapper()?.className).toContain("stg:my-auto");
    expect(composerWrapper()?.className).not.toContain("stg:my-6");
  });

  it("keeps the composer centered when context is attached (no position flip)", () => {
    mockFlow = stubPopulatedFlow;
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    // Regression guard: attaching a workspace previously top-anchored the
    // composer. Centering must now hold irrespective of attached context.
    expect(composerWrapper()?.className).toContain("stg:my-auto");
    expect(composerWrapper()?.className).not.toContain("stg:my-6");
  });
});

describe("NewSessionViewer — a first message refused because the plan's agent hours are used", () => {
  it("says when they reset and where the plans are", async () => {
    const { refusal } = await import("../../billing/__tests__/fixtures");
    const copy = "This organization has used the 10 agent hours its Free plan includes this month.";
    mockFlow = {
      ...stubEmptyFlow,
      submitFailure: refusal(copy, "AGENT_HOURS_USED_UP", {
        org: "acme",
        plan: "Free",
        included_hours: "10",
        resets_at: "2026-11-01T00:00:00.000Z",
      }),
    };
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" }).getAttribute("href")).toBe("/settings/billing");
    expect(screen.queryByRole("link", { name: "Open Models & providers" })).toBeNull();
  });
});

describe("NewSessionViewer — a run refused for want of a provider key", () => {
  it("says where the key is added, and shows nothing for any other failure", async () => {
    const { refusal } = await import("../../billing/__tests__/fixtures");
    const copy = "This organization has no OpenAI key for model 'gpt-5', so the run was not started.";
    mockFlow = {
      ...stubEmptyFlow,
      submitFailure: refusal(copy, "PROVIDER_KEY_REQUIRED", { org: "acme", provider: "openai", model: "gpt-5" }),
    };
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Models & providers" }).getAttribute("href")).toBe("/models");

    cleanup();
    mockFlow = { ...stubEmptyFlow, submitFailure: new Error("something else") };
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "Open Models & providers" })).toBeNull();
  });
});
