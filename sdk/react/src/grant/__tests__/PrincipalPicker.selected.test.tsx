/**
 * The share picker once a team is chosen: the field shows the team's name
 * with "Team" beneath it, so the person granting can see a team (all its
 * members) is about to get access rather than one person, and the clear
 * button names the team and hands back no selection.
 *
 * The organization's access list and team list are stubbed.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../useResourceAccess.js", () => ({
  useResourceAccess: () => ({
    members: [],
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("../../team/useTeamList.js", () => ({
  useTeamList: () => ({ teams: [], isLoading: false, error: null }),
}));

import { PrincipalPicker, type SelectedGrantee } from "../PrincipalPicker";

afterEach(cleanup);

const SRE: SelectedGrantee = {
  kind: "team",
  grantee: { kind: "team", id: "tm_sre" },
  name: "Site Reliability",
  description: "On call",
  team: create(TeamSchema, { metadata: { id: "tm_sre", name: "Site Reliability", slug: "site-reliability" } }),
};

describe("PrincipalPicker — a chosen team", () => {
  it("reads as a team under its name, and clears to no selection", () => {
    const onChange = vi.fn((value: SelectedGrantee | null) => {
      void value;
    });
    render(<PrincipalPicker org="acme" value={SRE} onChange={onChange} />);

    expect(screen.getByText("Site Reliability")).toBeTruthy();
    expect(screen.getByText("Team")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear selected team" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
