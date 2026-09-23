/**
 * Pins GrantAccessForm's grantee rules:
 *
 *   - the role list follows the chosen grantee, and switching from a
 *     person to a team clears a role the team cannot hold, so the form
 *     never submits a grant the server's role check would refuse;
 *   - a team is granted as `team:<id>#member`, the only spelling the
 *     server accepts for a team.
 *
 * The picker is stubbed with two buttons that choose a person or a team;
 * the role selector is the real one, reading the generated role tables
 * (an agent: a person may be owner or viewer, a team only viewer).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefViewSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { personGrantee, teamGrantee } from "@stigmer/sdk";
import type { GranteeCandidate } from "../useGranteeCandidates";

const createPolicy = vi.hoisted(() => vi.fn(async (_spec: IamPolicySpec) => ({})));

vi.mock("../useCreateIamPolicy.js", () => ({
  useCreateIamPolicy: () => ({
    create: createPolicy,
    isCreating: false,
    error: null,
    clearError: () => {},
  }),
}));

const PERSON: GranteeCandidate = {
  kind: "identity_account",
  grantee: personGrantee("ida_alice"),
  name: "Alice",
  email: "alice@example.com",
  view: create(ApiResourceRefViewSchema, { kind: "identity_account", id: "ida_alice" }),
};
const TEAM: GranteeCandidate = {
  kind: "team",
  grantee: teamGrantee("tm_sre"),
  name: "Site Reliability",
  description: "",
  team: create(TeamSchema, { metadata: { id: "tm_sre", name: "Site Reliability" } }),
};

vi.mock("../PrincipalPicker.js", () => ({
  PrincipalPicker: ({ onChange }: { onChange: (g: GranteeCandidate | null) => void }) => (
    <div>
      <button type="button" onClick={() => onChange(PERSON)}>choose person</button>
      <button type="button" onClick={() => onChange(TEAM)}>choose team</button>
    </div>
  ),
}));

import { GrantAccessForm } from "../GrantAccessForm";

function renderForm() {
  return render(
    <GrantAccessForm
      resourceKind={ApiResourceKind.agent}
      resourceKindString="agent"
      resourceId="agt_1"
      orgId="acme"
      includeTeams
    />,
  );
}

afterEach(() => {
  cleanup();
  createPolicy.mockClear();
});

describe("GrantAccessForm", () => {
  it("offers a team only the team roles and clears a role the team cannot hold", () => {
    renderForm();
    fireEvent.click(screen.getByText("choose person"));
    expect(screen.getByLabelText(/Owner/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Owner/));
    expect((screen.getByRole("button", { name: /Grant access/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("choose team"));
    expect(screen.queryByLabelText(/Owner/)).toBeNull();
    expect((screen.getByRole("button", { name: /Grant access/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a role the new grantee can also hold", () => {
    renderForm();
    fireEvent.click(screen.getByText("choose person"));
    fireEvent.click(screen.getByLabelText(/Viewer/));
    fireEvent.click(screen.getByText("choose team"));
    expect((screen.getByRole("button", { name: /Grant access/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("grants a team as its members", async () => {
    renderForm();
    fireEvent.click(screen.getByText("choose team"));
    fireEvent.click(screen.getByLabelText(/Viewer/));
    fireEvent.click(screen.getByRole("button", { name: /Grant access/ }));

    await waitFor(() => expect(createPolicy).toHaveBeenCalledTimes(1));
    const spec = createPolicy.mock.calls[0]![0];
    expect([spec.principal?.kind, spec.principal?.id, spec.principal?.relation]).toEqual([
      "team",
      "tm_sre",
      "member",
    ]);
    expect([spec.resource?.kind, spec.resource?.id, spec.relation]).toEqual(["agent", "agt_1", "viewer"]);
  });
});
