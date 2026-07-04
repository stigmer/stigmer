import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Launcher panel behavior: the session panel chip is PERSISTENT chrome (always
// mounted, not gated on attached context), and opening the panel homes on the
// Config facet — the pre-session view that carries the run defaults, since the
// Explorer has no workspace yet.
//
// The composer is replaced with a prop-capturing probe so these tests exercise
// only the panel chrome (chip + WorkspaceSurface rail) without pulling in the
// full composer's provider requirements. The Config facet (SetupTab) renders
// for real so "homes on Config" is asserted through the live rail.
// ---------------------------------------------------------------------------

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});

// A launcher flow with ZERO attached context — no agent, no workspace, no
// MCP/skills/vars. This is the case the old `hasContext` gate hid the chip for.
const emptyWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

const stubEmptyFlow = {
  harness: "native" as const,
  setHarness: vi.fn(),
  modelId: undefined,
  setModelId: vi.fn(),
  agentRef: null,
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: emptyWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  isSubmitting: false,
  submitError: null,
  submit: vi.fn(),
};

// A launcher flow WITH attached context (a git workspace entry). Used to prove
// the composer stays centered regardless of context — the invariant that
// replaced the old `hasContext` position flip (DD-16 layout stability).
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

import { NewSessionViewer } from "../NewSessionViewer";

beforeEach(() => {
  cleanup();
  mockFlow = stubEmptyFlow;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewSessionViewer — persistent panel chip", () => {
  it("renders the chip with zero attached context (not gated on hasContext)", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show panel" })).toBeTruthy();
  });

  it("homes on the Config facet when the panel opens", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    // The Config rail view is the active (checked) one; Explorer is not — the
    // launcher's `defaultView: "configure"` home view.
    const config = screen.getByRole("radio", { name: "Config" });
    const explorer = screen.getByRole("radio", { name: "Explorer" });
    expect(config.getAttribute("aria-checked")).toBe("true");
    expect(explorer.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the chip mounted as the collapse control once the panel is open", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    // Chip is still present with zero context — now as the hide affordance, so
    // an open panel always has its toggle (the vanishing-toggle defect the old
    // context gate could produce is impossible by construction).
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeTruthy();
  });
});

describe("NewSessionViewer — composer stays centered", () => {
  // The composer's wrapper is the probe's parent (wrapper > h1 + composer +
  // footer). `my-auto` is unconditional safe-centering; the old `my-6`
  // top-anchor that appeared once context was attached is gone (DD-16).
  const composerWrapper = () => screen.getByTestId("composer-probe").parentElement;

  it("centers the composer with zero attached context", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    expect(composerWrapper()?.className).toContain("my-auto");
    expect(composerWrapper()?.className).not.toContain("my-6");
  });

  it("keeps the composer centered when context is attached (no position flip)", () => {
    mockFlow = stubPopulatedFlow;
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} />);
    // Regression guard: attaching a workspace previously top-anchored the
    // composer. Centering must now hold irrespective of attached context.
    expect(composerWrapper()?.className).toContain("my-auto");
    expect(composerWrapper()?.className).not.toContain("my-6");
  });
});
