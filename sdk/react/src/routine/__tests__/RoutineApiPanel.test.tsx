/**
 * The routine's API panel and the curl it shows:
 *
 *   - `buildRoutineFireCurl` posts to the fire RPC's Connect path from the
 *     generated descriptor, reads the key from `$STIGMER_API_KEY` (never a
 *     secret in the copied line), drops the Authorization line only for a
 *     server that trusts every request, and quotes the JSON body so a quote
 *     in it cannot end the shell argument;
 *   - the panel's three postures: where the edition shares a routine with no
 *     one but its creator (open source answers `can_grant_access` false) it
 *     says to use the creator's key; where it does, someone who may create a
 *     service account is offered the form with Viewer preset, and anyone
 *     else is told an admin does it, with the link; the key's reach is
 *     stated wherever the setup is;
 *   - a server that trusts every request gets no key line and no setup, and
 *     an unknown public address shows the shared notice instead of a
 *     command nobody can run.
 *
 * The generated client is a fake behind the one provider seam.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { RoutineApiPanel, buildRoutineFireCurl } from "../RoutineApiPanel";

beforeAll(() => {
  // happy-dom does not implement the native dialog show/close methods.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

const ROUTINE: Routine = create(RoutineSchema, {
  metadata: { id: "rtn_01triage", name: "Triage new alerts", slug: "triage", org: "org_acme" },
  status: { audit: { specAudit: { createdBy: { id: "ida_ana", displayName: "Ana" } } } },
});

describe("buildRoutineFireCurl", () => {
  it("posts the id and an example note to the fire RPC with the key from the environment", () => {
    expect(
      buildRoutineFireCurl({ baseUrl: "https://api.example.com/", routineId: "rtn_01triage", withKey: true }),
    ).toBe(
      [
        "curl -X POST https://api.example.com/ai.stigmer.agentic.routine.v1.RoutineCommandController/fire \\",
        '  -H "Authorization: Bearer $STIGMER_API_KEY" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"id":"rtn_01triage","text":"Sentry alert SEN-4521 fired"}'`,
      ].join("\n"),
    );
  });

  it("drops the Authorization line for a server that trusts every request", () => {
    const curl = buildRoutineFireCurl({ baseUrl: "http://localhost:7234", routineId: "rtn_1", withKey: false });
    expect(curl).not.toContain("Authorization");
    expect(curl.split("\n")).toHaveLength(3);
  });

  it("keeps the body one shell argument whatever the id holds", () => {
    const curl = buildRoutineFireCurl({ baseUrl: "http://h", routineId: `a'b"c`, withKey: false });
    expect(curl).toContain(`-d '{"id":"a'\\''b\\"c","text":"Sentry alert SEN-4521 fired"}'`);
  });
});

interface Answers {
  readonly authenticationRequired?: boolean;
  readonly canGrant?: boolean;
  readonly canCreateAccount?: boolean;
  readonly baseUrl?: string;
}

function renderPanel(answers: Answers, onManageAccess?: () => void) {
  const checkMyPermission = vi.fn(
    async (input: { relation: string; resource: { kind: string } }) => ({
      isAuthorized:
        input.relation === "can_grant_access"
          ? answers.canGrant ?? false
          : input.relation === "can_create_identity_account"
            ? answers.canCreateAccount ?? false
            : false,
    }),
  );
  const client = {
    baseUrl: answers.baseUrl ?? "https://api.example.com",
    platform: {
      getServerInfo: vi.fn().mockResolvedValue({
        authenticationRequired: answers.authenticationRequired ?? true,
      }),
    },
    grant: { checkMyPermission },
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  render(
    <RoutineApiPanel routine={ROUTINE} onManageAccess={onManageAccess} serviceAccountsHref="#/sa" />,
    { wrapper: Wrapper },
  );
  return { checkMyPermission };
}

describe("RoutineApiPanel", () => {
  it("names the creator every call acts as, and shows the call", async () => {
    renderPanel({});
    expect(screen.getByText(/Each call is a run that acts as Ana, with the text as its note/)).toBeTruthy();
    const curl = await screen.findByText(/RoutineCommandController\/fire/);
    expect(curl.textContent).toContain("Authorization: Bearer $STIGMER_API_KEY");
    expect(screen.getByText(/at most 30\s+times an hour outside its schedule/)).toBeTruthy();
  });

  it("tells open source to use the creator's own key, with no setup steps", async () => {
    renderPanel({ canGrant: false });
    await screen.findByText("Use an API key of the person who created this routine.");
    expect(screen.queryByText("Who may call it")).toBeNull();
  });

  it("offers an admin the service account with Viewer preset, and the Participant grant", async () => {
    const onManageAccess = vi.fn();
    renderPanel({ canGrant: true, canCreateAccount: true }, onManageAccess);

    await screen.findByText("Who may call it");
    expect(screen.getByText(/Only the person who created this routine may do this/)).toBeTruthy();
    expect(screen.getByText(/Viewer is the least/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Create a service account" }));
    const viewer = (await screen.findByRole("radio", { name: /^Viewer/ })) as HTMLInputElement;
    expect(viewer.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Give it Participant" }));
    expect(onManageAccess).toHaveBeenCalledOnce();
  });

  it("tells someone who may not create a service account that an admin does, with the link", async () => {
    renderPanel({ canGrant: true, canCreateAccount: false });

    await screen.findByText(/An organization admin creates service accounts and their keys/);
    expect(screen.getByRole("link", { name: "Service accounts" }).getAttribute("href")).toBe("#/sa");
    expect(screen.queryByRole("button", { name: "Create a service account" })).toBeNull();
  });

  it("drops the key and the setup for a server that trusts every request", async () => {
    const { checkMyPermission } = renderPanel({ authenticationRequired: false, canGrant: true });

    await waitFor(() => expect(screen.getByText(/RoutineCommandController\/fire/).textContent).not.toContain("Authorization"));
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    expect(screen.queryByText("Who may call it")).toBeNull();
    expect(screen.queryByText("Use an API key of the person who created this routine.")).toBeNull();
  });

  it("says the address is unknown instead of showing a command nobody can run", async () => {
    renderPanel({ baseUrl: "/api" });
    await screen.findByText(/can.t show the command/);
    expect(screen.queryByText(/RoutineCommandController\/fire/)).toBeNull();
  });
});
