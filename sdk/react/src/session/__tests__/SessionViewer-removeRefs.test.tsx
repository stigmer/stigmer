import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { OrgProvider } from "../../organization/OrgProvider";
import {
  ACME_ID,
  GLOBEX_ID,
  ORGS,
  WhenOrgsLoaded,
} from "../../organization/__tests__/org-fixture";

// ---------------------------------------------------------------------------
// Removing an MCP server or a skill from the Config facet compares the
// references by the id of the org they name: a reference can name its org by
// slug (one a host or URL supplied) or by id (a stored or picked one), so a
// removal drops every attachment of that resource in that org and leaves a
// namesake in another org. The composer, thread and dock are probes; the
// Config facet (SetupTab) renders for real.
// ---------------------------------------------------------------------------

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});

vi.mock("../../run/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));

vi.mock("../../run/FileReviewDock", () => ({
  FileReviewDock: () => <div data-testid="file-review-dock-probe" />,
}));

const stubWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  removeEntry: vi.fn(),
  clear: vi.fn(),
};

const stubConv = {
  org: ACME_ID,
  session: { spec: {} } as Record<string, unknown>,
  isLoading: false,
  loadError: null,
  completedRuns: [],
  activeStreamRun: null,
  activePhase: null,
  isStreaming: false,
  isConnecting: false,
  sendFollowUp: vi.fn(),
  canSendFollowUp: true,
  isSending: false,
  sendError: null,
  clearSendError: vi.fn(),
  pendingUserMessage: null,
  workspaceEntries: [],
  mcpServerUsages: [],
  skillRefs: [],
  pendingApprovals: [],
  submitApproval: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  fileChangeSets: [],
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  streamError: null,
  reconnectStream: vi.fn(),
  approvalError: null,
  retryLastSend: vi.fn(),
};

// The same server attached twice, once naming its org by slug and once by
// id, and a namesake in another org; likewise for a skill.
const mcpServerUsages: McpServerUsageInput[] = [
  { mcpServerRef: { org: "acme", slug: "github" } },
  { mcpServerRef: { org: ACME_ID, slug: "github" } },
  { mcpServerRef: { org: GLOBEX_ID, slug: "github" } },
];
const skillRefs: ResourceRef[] = [
  { org: ACME_ID, slug: "triage" },
  { org: "acme", slug: "triage" },
  { org: "globex", slug: "triage" },
];

const stubSessionPageFlow = {
  conv: stubConv,
  harness: "native" as const,
  executionTarget: undefined,
  model: [undefined, vi.fn()] as const,
  interactionMode: ["agent" as const, vi.fn()] as const,
  agentRef: { org: ACME_ID, slug: "support-bot" },
  setAgentRef: vi.fn(),
  clearAgent: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  agentVersion: {
    pinnedHash: "",
    currentHash: "",
    agentName: "",
    isOutdated: false,
    labelOf: (hash: string) => hash.slice(0, 12),
    update: vi.fn(),
    isUpdating: false,
    updateError: null,
  },
  mcpServerUsages,
  setMcpServerUsages: vi.fn(),
  skillRefs,
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  submitApproval: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: null,
  allRuns: [],
  sandboxWorkspaceRoot: undefined,
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

// OrgProvider reads the same client hook, so the stub answers the person's
// organizations too. It is one stable client: OrgProvider refetches the
// organizations whenever the client it is handed changes.
const client = vi.hoisted(() => ({ current: null as unknown }));
// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => {
    client.current ??= {
      run: {
        uploadAttachment: vi.fn(),
        getArtifactContent: vi.fn(),
      },
      organization: {
        findMyOrganizations: async () => ({ entries: ORGS }),
      },
    };
    return client.current;
  },
}));

import { SessionViewer } from "../SessionViewer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderConfigFacet() {
  render(
    <OrgProvider>
      <WhenOrgsLoaded>
        <SessionViewer sessionId="ses_1" org={ACME_ID} defaultPanelOpen />
      </WhenOrgsLoaded>
    </OrgProvider>,
  );
  fireEvent.click(await screen.findByRole("radio", { name: "Config" }));
}

describe("SessionViewer — removing an attached reference compares orgs by id", () => {
  it("drops every attachment of the removed MCP server, and only in its org", async () => {
    await renderConfigFacet();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove MCP server github" })[0]);

    expect(stubSessionPageFlow.setMcpServerUsages).toHaveBeenCalledExactlyOnceWith([
      { mcpServerRef: { org: GLOBEX_ID, slug: "github" } },
    ]);
  });

  it("drops every attachment of the removed skill, and only in its org", async () => {
    await renderConfigFacet();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove skill triage" })[0]);

    expect(stubSessionPageFlow.setSkillRefs).toHaveBeenCalledExactlyOnceWith([
      { org: "globex", slug: "triage" },
    ]);
  });
});
