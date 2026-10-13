/**
 * Pins AccessMoveSummary: before a move it says what moves and what the
 * move deletes and stops, offering nothing to make again; after it, each
 * schedule and evaluator offers "Make it again as me" (done once, then
 * marked), each eval points to its page, and a failure is shown.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { MoveOrgAccessResultSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

const state = vi.hoisted(() => ({ remade: [] as string[], fail: false }));

vi.mock("../useRemakeAutomation.js", async (original) => ({
  ...(await original<typeof import("../useRemakeAutomation.js")>()),
  useRemakeAutomation: () => ({
    remake: (automation: { id: string }) => {
      state.remade.push(automation.id);
      return state.fail ? Promise.reject(new Error("could not make it again")) : Promise.resolve("new");
    },
    remaking: null,
    error: state.fail ? new Error("could not make it again") : null,
  }),
}));

import { AccessMoveSummary } from "../AccessMoveSummary";

const move = create(MoveOrgAccessResultSchema, {
  movedPolicies: 3,
  myVaultEntries: ["GITHUB_TOKEN"],
  automations: [
    { kind: "schedule", id: "sch_1", slug: "nightly", name: "Nightly" },
    { kind: "plugin_eval", id: "pev_1", slug: "", name: "" },
  ],
});

afterEach(() => {
  cleanup();
  state.remade = [];
  state.fail = false;
});

describe("AccessMoveSummary", () => {
  it("before the move: what moves, what it deletes and stops, nothing offered to make again", () => {
    render(<AccessMoveSummary move={move} invitationIds={["inv_1"]} moved={false} />);
    expect(screen.getByText(/Moves 3 roles and shares/)).toBeTruthy();
    expect(screen.getByText("GITHUB_TOKEN")).toBeTruthy();
    expect(screen.getByText(/An invitation you created here stop working/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make it again as me" })).toBeNull();
  });

  it("after the move: a schedule is made again once, an eval points to its page, links when the host routes them", async () => {
    render(
      <AccessMoveSummary
        move={move}
        invitationIds={[]}
        moved
        automationHref={(kind, slug) => (kind === "schedule" ? `/schedules/${slug}` : undefined)}
      />,
    );
    expect(screen.getByRole("link", { name: "Schedule: Nightly" }).getAttribute("href")).toBe("/schedules/nightly");
    expect(screen.getByText("Start it again from its page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make it again as me" }));
    expect(await screen.findByText("Made again as you")).toBeTruthy();
    expect(state.remade).toEqual(["sch_1"]);
  });

  it("shows a failure to make it again", () => {
    state.fail = true;
    render(<AccessMoveSummary move={create(MoveOrgAccessResultSchema, { movedPolicies: 1, automations: move.automations })} invitationIds={["a", "b"]} moved />);
    expect(screen.getByRole("alert").textContent).toContain("could not make it again");
    expect(screen.getByText(/Moved 1 role or share/)).toBeTruthy();
    expect(screen.getByText(/2 invitations you created here stopped working/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make it again as me" }));
    expect(state.remade).toEqual(["sch_1"]);
  });
});
