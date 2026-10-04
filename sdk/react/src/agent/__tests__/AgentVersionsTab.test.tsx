/**
 * The agent detail view's Versions tab: the tab carries the number of
 * versions the agent has; it lists them newest first through the shared
 * timeline, the current one marked; selecting an older version shows how
 * its instructions differ from the current version's; and an agent with no
 * recorded version yet says its next change records the first.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);

const CURRENT = "b".repeat(64);
const OLDER = "a".repeat(64);

function renderView(versions: ReturnType<typeof create<typeof AgentVersionEntrySchema>>[]) {
  const agent = samples.agent({ name: "Reviewer", org: ACME_ID });
  const listVersions = vi.fn(async () => ({ versions, totalCount: versions.length, nextPageToken: "" }));
  render(<AgentDetailView org="acme" slug="reviewer" />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), listVersions },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
  return { listVersions };
}

describe("AgentDetailView — the Versions tab", () => {
  it("lists the versions with the current one marked, and diffs an older version's instructions against the current", async () => {
    renderView([
      create(AgentVersionEntrySchema, {
        versionHash: CURRENT,
        isCurrent: true,
        tag: "stable",
        message: "tighter review",
        specSnapshot: { instructions: "Review pull requests.\nFlag missing tests." },
      }),
      create(AgentVersionEntrySchema, {
        versionHash: OLDER,
        message: "first cut",
        specSnapshot: { instructions: "Review pull requests." },
      }),
    ]);

    const tab = await screen.findByRole("tab", { name: /Versions/ });
    expect(within(tab).getByText("2")).toBeTruthy();
    fireEvent.click(tab);

    expect(await screen.findByText("tighter review")).toBeTruthy();
    expect(screen.getByText("stable")).toBeTruthy();
    fireEvent.click(screen.getByText("first cut"));

    expect(await screen.findByText(/Comparing/)).toBeTruthy();
    expect(screen.getByText("instructions")).toBeTruthy();
    expect(screen.getByText("Flag missing tests.")).toBeTruthy();
  });

  it("says an agent with no recorded version records its first on its next change", async () => {
    renderView([]);

    fireEvent.click(await screen.findByRole("tab", { name: /Versions/ }));

    expect(await screen.findByText("No versions yet. The agent's next change records its first version.")).toBeTruthy();
  });
});
