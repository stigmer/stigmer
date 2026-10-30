import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import {
  OAuthAppSchema,
  type OAuthApp,
} from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/spec_pb";
import type { CheckMyPermissionInput } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "@stigmer/react-core";
import { OAuthAppDetailPanel } from "../OAuthAppDetailPanel";

/**
 * Pins two things about the detail panel:
 *
 *   - the save names the fields the form edits, so a spec field the form
 *     does not know about keeps its stored value. The secret has its own
 *     contract: an empty secret input leaves `spec.client_secret` unnamed,
 *     so the stored secret stays, and a newly entered one is named and
 *     replaces it;
 *   - Edit is offered only with `can_edit` and Delete only with
 *     `can_delete` on the app, so an organization admin who may view an app
 *     they did not create is never handed a control the server would
 *     refuse (both belong to the creator; stigmer/stigmer#1257).
 */

const REDACTED = "***REDACTED***";

const APP: OAuthApp = create(OAuthAppSchema, {
  metadata: {
    id: "oa-1",
    name: "GitHub OAuth",
    slug: "github-oauth",
    org: "acme",
  },
  spec: {
    provider: "github",
    clientId: "gh-client-1",
    clientSecret: REDACTED,
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo"],
    tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
    addresses: ["github.com", "https://api.githubcopilot.com/mcp"],
  },
});

function renderPanel(
  update: ReturnType<typeof vi.fn>,
  checkMyPermission: ReturnType<typeof vi.fn> = vi.fn(async () => ({
    isAuthorized: true,
  })),
) {
  const client = {
    oauthapp: { update },
    grant: { checkMyPermission },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <OAuthAppDetailPanel oauthApp={APP} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("OAuthAppDetailPanel save payload", () => {
  it("keeps the stored secret, unnamed, when the secret input is left empty", async () => {
    const update = vi.fn(async (_resource: OAuthApp, _paths: string[]) => APP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const provider = await screen.findByLabelText("Provider");
    fireEvent.change(provider, { target: { value: "github-enterprise" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<OAuthApp>(update);
    const spec = sent.resource.spec;

    // Empty secret input → the secret is not named → the server keeps the
    // stored secret.
    expect(sent.paths).not.toContain("spec.client_secret");
    // The edited field.
    expect(spec?.provider).toBe("github-enterprise");
    expect(sent.paths).toContain("spec.provider");
    // The form's other fields travel from the edit state.
    expect(spec?.tokenEndpointAuthMethod).toBe(TokenEndpointAuthMethod.CLIENT_SECRET_POST);
    expect(spec?.scopes).toEqual(["repo"]);
    expect(spec?.addresses).toEqual(["github.com", "https://api.githubcopilot.com/mcp"]);
    // An update names its app by id.
    expect(sent.id).toBe(APP.metadata?.id);
  });

  it("sends a newly entered secret instead of the marker", async () => {
    const update = vi.fn(async (_resource: OAuthApp, _paths: string[]) => APP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const secret = await screen.findByLabelText("Client secret");
    fireEvent.change(secret, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<OAuthApp>(update);
    expect(sent.paths).toContain("spec.client_secret");
    expect(sent.resource.spec?.clientSecret).toBe("new-secret");
  });
});

describe("OAuthAppDetailPanel edit and delete gates", () => {
  it("offers Edit only with can_edit and Delete only with can_delete on the app", async () => {
    const checkMyPermission = vi.fn(async (input: CheckMyPermissionInput) => ({
      isAuthorized: input.relation === "can_delete",
    }));
    renderPanel(vi.fn(), checkMyPermission);

    await screen.findByRole("button", { name: "Delete" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    const asked = checkMyPermission.mock.calls.map(
      ([input]) =>
        `${input.resource?.kind}:${input.resource?.id}:${input.relation}`,
    );
    // can_delete gates both Delete and the slug field (rename).
    expect([...new Set(asked)].sort()).toEqual([
      "oauth_app:oa-1:can_delete",
      "oauth_app:oa-1:can_edit",
    ]);
    expect(await screen.findByRole("button", { name: "Rename" })).toBeTruthy();
  });

  it("an admin who did not create the app reads it with neither control", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(vi.fn(), checkMyPermission);

    await waitFor(() =>
      expect(new Set(checkMyPermission.mock.calls.map(([input]) => input.relation))).toEqual(
        new Set(["can_edit", "can_delete"]),
      ),
    );
    // The configuration stays readable; only the change affordances are withheld.
    expect(screen.getByRole("heading", { name: "github" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("OAuthAppDetailPanel rename", () => {
  it("renames through the kind's rename for whoever may delete it, and hands the renamed resource to onUpdated", async () => {
    const renamed = clone(OAuthAppSchema, APP);
    if (renamed.metadata !== undefined) {
      renamed.metadata.slug = "renamed-slug";
    }
    const rename = vi.fn(async () => renamed);
    const onUpdated = vi.fn();
    const client = {
      oauthapp: { rename },
      grant: { checkMyPermission: async () => ({ isAuthorized: true }) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <OAuthAppDetailPanel oauthApp={APP} onUpdated={onUpdated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Slug", undefined, { timeout: 5000 }), {
      target: { value: "renamed-slug" },
    });
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    // The field settles before it takes the rename, however slow the runner.
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(button);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(renamed), { timeout: 5000 });
    expect(rename.mock.calls[0]).toEqual([expect.objectContaining({ resourceId: APP.metadata?.id, slug: "renamed-slug" })]);
  });
});
