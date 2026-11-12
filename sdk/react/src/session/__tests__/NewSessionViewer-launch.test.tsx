/**
 * Pins a launch into the launcher (`launch`): the composer starts on the
 * launch's agent with its files and written message, under its heading and
 * placeholder; each new key mounts a fresh composer, so a second link into
 * a launcher that stayed mounted never meets the first one's; a launch is
 * spent once its session is created, and the usual composer and heading
 * come back; a launch keeps the first question away, and a guest ignores
 * it. Then the journey's next line under the heading (`journeyLinks`):
 * asked only with the first question on, outside the first state, and not
 * while a launch sends the person somewhere. The composer is a probe that
 * records each mount and what it read then; the line is a probe too
 * (its own suite is the journey's).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { ResourceRef } from "@stigmer/client";

/** Each composer mount, with what it read when it mounted. */
const mounts: Array<{ agent: unknown; files: string[]; message: unknown; placeholder: unknown }> = [];
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: { initialAgentRef?: ResourceRef; initialFiles?: File[]; initialMessage?: string; placeholder?: string }) => {
      const [read] = useState(() => ({
        agent: props.initialAgentRef,
        files: (props.initialFiles ?? []).map((file) => file.name),
        message: props.initialMessage,
        placeholder: props.placeholder,
      }));
      useEffect(() => {
        mounts.push(read);
      }, [read]);
      return <div data-testid="composer-probe" />;
    },
  };
});

const lineAsked: boolean[] = [];
vi.mock("../../journey/JourneyNextLine.js", () => ({
  JourneyLauncherLine: ({ enabled }: { enabled: boolean }) => {
    lineAsked.push(enabled);
    return enabled ? <p data-testid="next-line">Next: make Variance Reporter yours</p> : null;
  },
}));

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

let createdHandler: ((sessionId: string) => void) | undefined;
vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: (options: { onSessionCreated: (sessionId: string) => void }) => {
    createdHandler = options.onSessionCreated;
    return mockFlow;
  },
}));

// No StigmerProvider here either for the first question: the host does not
// ask for it in this suite, so its gate answers "skip" and its picks are never
// made (the first question has its own suite: first-question).
const gateAsked: boolean[] = [];
vi.mock("../first-question/useFirstQuestionGate", () => ({
  useFirstQuestionGate: (_org: string, enabled: boolean) => {
    gateAsked.push(enabled);
    return "skip";
  },
}));
vi.mock("../first-question/useStartFromExample", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../first-question/useStartFromExample")>()),
  useStartFromExample: () => ({
    pickExample: async () => null,
    describeOwn: async () => null,
    pending: null,
    failure: null,
    clearFailure: () => {},
  }),
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
import type { SessionLaunch } from "../launch";

const AGENT = { org: "acme", slug: "variance-reporter" };
const LEDGER = new File(["account,budget,actual\n"], "ledger.csv", { type: "text/csv" });
const SAMPLE: SessionLaunch = { key: "link-1", agentRef: AGENT, files: [LEDGER], message: "Write the variance report.", heading: "Run it on the sample" };
const OWN: SessionLaunch = {
  key: "link-2",
  agentRef: AGENT,
  message: "Here is one of our ledgers.",
  heading: "Try it on your own file",
  placeholder: "Attach your file, then send",
};
const LINKS = { makeItYours: () => "/agents/acme/variance-reporter?tab=make-it-yours" };

beforeEach(() => {
  mounts.length = 0;
  lineAsked.length = 0;
  gateAsked.length = 0;
  mockFlow = stubEmptyFlow;
  createdHandler = undefined;
});
afterEach(cleanup);

describe("NewSessionViewer launch", () => {
  it("starts the composer on the launch's agent, files and message, under its heading", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} launch={SAMPLE} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Run it on the sample");
    expect(mounts).toEqual([{ agent: AGENT, files: ["ledger.csv"], message: "Write the variance report.", placeholder: expect.any(String) }]);
  });

  it("mounts a fresh composer for each new launch, with its own agent, files and message", () => {
    const { rerender } = render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} launch={SAMPLE} />);
    rerender(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} launch={OWN} />);

    expect(mounts).toHaveLength(2);
    expect(mounts[1]).toEqual({ agent: AGENT, files: [], message: "Here is one of our ledgers.", placeholder: "Attach your file, then send" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Try it on your own file");
  });

  it("spends a launch once its session is created: the usual composer and heading come back", () => {
    const onSessionCreated = vi.fn();
    render(<NewSessionViewer org="acme" onSessionCreated={onSessionCreated} launch={SAMPLE} heading="What would you like to work on?" />);
    act(() => createdHandler?.("ses_1"));

    expect(onSessionCreated).toHaveBeenCalledWith("ses_1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What would you like to work on?");
    expect(mounts.at(-1)).toEqual({ agent: undefined, files: [], message: undefined, placeholder: expect.any(String) });
  });

  it("keeps the first question away while a launch sends the person somewhere", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} launch={OWN} firstQuestion />);

    expect(gateAsked.length).toBeGreaterThan(0);
    expect(gateAsked.every((asked) => !asked)).toBe(true);
  });

  it("ignores a launch for a guest", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} launch={OWN} audience="guest" initialAgentRef={AGENT} />);

    expect(screen.queryByText("Try it on your own file")).toBeNull();
    expect(mounts.every((mount) => mount.message === undefined)).toBe(true);
  });
});

describe("NewSessionViewer journey line", () => {
  it("names the journey's next step under the heading once the first state is over", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} firstQuestion journeyLinks={LINKS} />);

    expect(lineAsked.at(-1)).toBe(true);
    const heading = screen.getByRole("heading", { level: 1 });
    const line = screen.getByTestId("next-line");
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("asks nothing while a launch sends the person somewhere, or without the first question", () => {
    const { unmount } = render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} firstQuestion journeyLinks={LINKS} launch={OWN} />);
    expect(lineAsked.every((asked) => !asked)).toBe(true);
    unmount();

    lineAsked.length = 0;
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} journeyLinks={LINKS} />);
    expect(lineAsked.every((asked) => !asked)).toBe(true);
    expect(screen.queryByTestId("next-line")).toBeNull();
  });

  it("draws no line without the host's links", () => {
    render(<NewSessionViewer org="acme" onSessionCreated={vi.fn()} firstQuestion />);

    expect(lineAsked).toEqual([]);
  });
});
