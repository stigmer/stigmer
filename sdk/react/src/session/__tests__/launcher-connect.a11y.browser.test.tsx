// Accessibility audit — the launcher's readiness faces.
//
// Covers the connect step that takes the composer's place when nothing can
// run (an admin's key form, a member's line, a laptop's command) and the
// one line above the composer when only the chosen model cannot, each in
// light and dark against the shipped stylesheet, at the launcher's width.
// The session flow is a stand-in: the audit is of what the launcher draws
// from the readiness answer, not of the composer, which has its own audits.

import { afterEach, describe, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ResourceRef, Stigmer } from "@stigmer/client";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import {
  LAPTOP_WITHOUT_KEYS,
  NOTHING_CONNECTED,
  OPENAI_ONLY,
  ORG_ID,
  fakeClient,
  readinessWrapper,
  server,
  type FakeServer,
} from "../../models/__tests__/readiness-fixture.js";

vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: () => ({
    harness: "native" as const,
    setHarness: () => {},
    modelId: undefined,
    setModelId: () => {},
    clearModelPick: () => {},
    agentRef: null,
    setAgentRef: () => {},
    resolution: null,
    setResolution: () => {},
    agentRunDefaults: undefined,
    pluginRefs: [] as ResourceRef[],
    setPluginRefs: () => {},
    skillRefs: [] as ResourceRef[],
    setSkillRefs: () => {},
    workspace: { entries: [], hasEntries: false, toInput: () => [], addGitRepo: () => {}, addLocalPath: () => {}, remove: () => {}, clear: () => {} },
    autoApproveAll: false,
    setAutoApproveAll: () => {},
    offersEnvironment: false,
    environmentDefaults: undefined,
    isSubmitting: false,
    submitError: null,
    submitFailure: null,
    submit: async () => {},
  }),
}));

// The composer is audited on its own; here it stands as a labelled box.
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return { ...actual, SessionComposer: () => <textarea aria-label="Start a new session" /> };
});

import { NewSessionViewer } from "../NewSessionViewer.js";

const CANVAS = { width: 960, height: 900 } as const;

function audited(fake: FakeServer, mode: (typeof COLOR_MODES)[number], deployment: "cloud" | "local" = "cloud") {
  const { client } = fakeClient(fake);
  const Wrapper = readinessWrapper(client, deployment);
  return renderAudited(
    <Wrapper>
      <NewSessionViewer org={ORG_ID} onSessionCreated={() => {}} />
    </Wrapper>,
    mode,
    { ...CANVAS, client: client as unknown as Stigmer },
  );
}

afterEach(resetAudit);

describe("Launcher readiness a11y", () => {
  it.each(COLOR_MODES)("the connect step for an admin (%s)", async (mode) => {
    const container = audited(server({ readiness: NOTHING_CONNECTED }), mode);
    await screen.findByLabelText("Anthropic API key");
    await auditA11y(container, `launcher connect admin · ${mode}`);
  });

  it.each(COLOR_MODES)("the connect step for a member (%s)", async (mode) => {
    const container = audited(server({ readiness: NOTHING_CONNECTED, canManage: false }), mode);
    await screen.findByText(/An admin of Acme Research connects Anthropic/);
    await auditA11y(container, `launcher connect member · ${mode}`);
  });

  it.each(COLOR_MODES)("the connect step on a laptop (%s)", async (mode) => {
    const container = audited(server({ readiness: LAPTOP_WITHOUT_KEYS }), mode, "local");
    await screen.findByRole("button", { name: "Copy" });
    await auditA11y(container, `launcher connect local · ${mode}`);
  });

  it.each(COLOR_MODES)("the line above the composer when only the chosen model cannot run (%s)", async (mode) => {
    const container = audited(server({ readiness: OPENAI_ONLY }), mode);
    await screen.findByText("Connect Anthropic to run Claude Sonnet 4.6.");
    await auditA11y(container, `launcher model needs provider · ${mode}`);
  });
});
