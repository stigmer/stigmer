/**
 * WriteBacksWidget lists a session's pull requests: nothing when no run
 * wrote back, otherwise a "Pull Requests" section whose count tag equals
 * the deduplicated write-backs listed beneath it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { WorkspaceWriteBackSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";
import { WriteBacksWidget } from "../WriteBacksWidget";

afterEach(cleanup);

function runWithWriteBacks(id: string, entryNames: string[]): Run {
  return create(RunSchema, {
    metadata: { id },
    status: {
      workspaceWriteBacks: entryNames.map((workspaceEntryName) =>
        create(WorkspaceWriteBackSchema, { workspaceEntryName }),
      ),
    },
  });
}

describe("WriteBacksWidget", () => {
  it("renders nothing when no run wrote back", () => {
    const { container } = render(<WriteBacksWidget runs={[create(RunSchema)]} />);
    expect(container.innerHTML).toBe("");
  });

  it("counts and lists one pull request per workspace entry across runs", () => {
    render(
      <WriteBacksWidget
        runs={[runWithWriteBacks("run_1", ["web", "api"]), runWithWriteBacks("run_2", ["api"])]}
      />,
    );

    const section = screen.getByRole("region", { name: "Pull Requests" });
    expect(within(section).getByText("2")).toBeTruthy();
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("api");
    expect(items[1]!.textContent).toContain("web");
  });
});
