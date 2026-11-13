/**
 * TeamListPanel's rows: each team is a row named by its name (its id when
 * the name is empty) with its description beneath, and opening a row hands
 * that team to onOpen.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { TeamSchema, type Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { TeamListPanel } from "../TeamListPanel";

afterEach(cleanup);

const SRE: Team = create(TeamSchema, {
  metadata: { id: "tm_sre", name: "Site Reliability" },
  spec: { description: "On call" },
});
const UNNAMED: Team = create(TeamSchema, { metadata: { id: "tm_x", name: "" } });

describe("TeamListPanel rows", () => {
  it("opens the team a person picks", () => {
    const onOpen = vi.fn();
    render(<TeamListPanel teams={[SRE, UNNAMED]} isLoading={false} error={null} onOpen={onOpen} />);

    expect(screen.getByRole("list", { name: "Teams" })).toBeTruthy();
    expect(screen.getByText("On call")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Site Reliability" }));
    expect(onOpen).toHaveBeenCalledWith(SRE);

    fireEvent.click(screen.getByRole("button", { name: "tm_x" }));
    expect(onOpen).toHaveBeenLastCalledWith(UNNAMED);
  });
});
