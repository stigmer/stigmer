/**
 * Pins what CreateTeamForm shows when the server refuses a team for a
 * reason other than the plan: the refusal's own message, as an alert under
 * the fields, and no created team handed to the host.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { StigmerContext } from "../../context";
import { CreateTeamForm } from "../CreateTeamForm";

afterEach(cleanup);

describe("CreateTeamForm refusal", () => {
  it("shows a refusal that is not a plan limit as an alert with the server's message", async () => {
    const create = vi.fn(async (): Promise<Team> => {
      throw new Error("a team named Site Reliability already exists");
    });
    const onCreated = vi.fn();
    render(
      <StigmerContext.Provider value={{ team: { create } } as never}>
        <CreateTeamForm org="org_acme" onCreated={onCreated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Site Reliability"), { target: { value: "Site Reliability" } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("a team named Site Reliability already exists");
    expect(create).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
