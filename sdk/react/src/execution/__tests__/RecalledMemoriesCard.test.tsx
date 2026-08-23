// The retriever transparency card (stigmer/stigmer#293 Phase 3a, DD-008
// D5): an honest "Recalled N of M memories" join of the status report
// against the spec snapshot — and NOTHING for wholesale, the majority
// case that must stay noise-free.

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import {
  RecalledMemoriesReportSchema,
  type RecalledMemoriesReport,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  RecalledMemoryFactSchema,
  type RecalledMemoryFact,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  RecalledMemoriesCard,
  resolveInjectedFacts,
} from "../RecalledMemoriesCard";

function makeFact(id: string, content: string): RecalledMemoryFact {
  return create(RecalledMemoryFactSchema, { memoryId: id, content });
}

function makeReport(
  overrides: Partial<Pick<RecalledMemoriesReport, "selectionActive" | "injectedMemoryIds" | "embeddingModel">>,
): RecalledMemoriesReport {
  return create(RecalledMemoriesReportSchema, {
    selectionActive: true,
    embeddingModel: "text-embedding-3-small",
    ...overrides,
  });
}

const SNAPSHOT: RecalledMemoryFact[] = [
  makeFact("mem_a", "Prefers concise answers."),
  makeFact("mem_b", "Works in the Europe/Berlin timezone."),
  makeFact("mem_c", "Deploys with Bazel."),
  makeFact("mem_d", "Reviews PRs on Fridays."),
];

afterEach(cleanup);

describe("resolveInjectedFacts", () => {
  it("preserves snapshot order regardless of the report's id order", () => {
    const report = makeReport({ injectedMemoryIds: ["mem_d", "mem_a"] });
    expect(resolveInjectedFacts(report, SNAPSHOT).map((f) => f.memoryId)).toEqual([
      "mem_a",
      "mem_d",
    ]);
  });

  it("skips an unknown id — never invents a fact", () => {
    const report = makeReport({ injectedMemoryIds: ["mem_b", "mem_ghost"] });
    expect(resolveInjectedFacts(report, SNAPSHOT).map((f) => f.memoryId)).toEqual([
      "mem_b",
    ]);
  });

  it("returns nothing against an empty snapshot", () => {
    const report = makeReport({ injectedMemoryIds: ["mem_a"] });
    expect(resolveInjectedFacts(report, [])).toEqual([]);
  });
});

describe("RecalledMemoriesCard", () => {
  it("renders nothing for a wholesale report (selection_active=false)", () => {
    const report = makeReport({
      selectionActive: false,
      injectedMemoryIds: [],
      embeddingModel: "",
    });
    const { container } = render(
      <RecalledMemoriesCard report={report} facts={SNAPSHOT} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("summarizes the selection with the wire count and the embedding model", () => {
    const report = makeReport({ injectedMemoryIds: ["mem_a", "mem_c"] });
    render(<RecalledMemoriesCard report={report} facts={SNAPSHOT} />);

    expect(screen.getByRole("status", { name: "Recalled 2 of 4 memories" })).toBeTruthy();
    expect(screen.getByText("text-embedding-3-small")).toBeTruthy();
    // Collapsed by default: the facts are behind the disclosure.
    expect(screen.queryByText("Prefers concise answers.")).toBeNull();
  });

  it("expands to exactly the injected facts, in snapshot order", async () => {
    const report = makeReport({ injectedMemoryIds: ["mem_c", "mem_a"] });
    render(<RecalledMemoriesCard report={report} facts={SNAPSHOT} />);
    const user = userEvent.setup();

    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.getAttribute("aria-controls")).toBeTruthy();

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Prefers concise answers.", "Deploys with Bazel."]);
    // Non-injected snapshot facts never render.
    expect(screen.queryByText("Works in the Europe/Berlin timezone.")).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("keeps the summary count honest when an id cannot be resolved", async () => {
    // Contractually impossible (injected ids ⊂ snapshot, the merge path's
    // never-invent pin) — but if it ever happens, the count stays the wire
    // truth and the list simply omits the unresolvable entry.
    const report = makeReport({ injectedMemoryIds: ["mem_b", "mem_ghost"] });
    render(<RecalledMemoriesCard report={report} facts={SNAPSHOT} />);

    expect(screen.getByRole("status", { name: "Recalled 2 of 4 memories" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button"));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
