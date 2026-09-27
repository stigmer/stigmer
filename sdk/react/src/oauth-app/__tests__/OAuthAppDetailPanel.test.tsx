import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OAuthAppSchema,
  type OAuthApp,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { OAuthAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { OAuthAppDetailPanel } from "../OAuthAppDetailPanel";

/**
 * Pins two things about the detail panel:
 *
 *   - the full-spec-replace wipe bug: the panel must spread
 *     `toOAuthAppUpdateInput` and override only what it edits, so a spec
 *     field the form does not know about survives the save. The secret has
 *     its own contract: an empty secret input sends the fetched value — the
 *     server's redaction marker — which the update pipeline treats as "keep
 *     the stored secret" (oss#395 pins the marker/ciphertext boundary);
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
    iamPolicy: { checkMyPermission },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <OAuthAppDetailPanel oauthApp={APP} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("OAuthAppDetailPanel save payload", () => {
  it("keeps the stored secret (redaction marker) when the secret input is left empty", async () => {
    const update = vi.fn(async (_input: OAuthAppInput) => APP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const provider = await screen.findByLabelText("Provider");
    fireEvent.change(provider, { target: { value: "github-enterprise" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // Empty secret input → the redaction marker rides along → the server
    // preserves the stored secret.
    expect(input.clientSecret).toBe(REDACTED);
    // The edited field.
    expect(input.provider).toBe("github-enterprise");
    // Unedited fields round-trip.
    expect(input.tokenEndpointAuthMethod).toBe(
      TokenEndpointAuthMethod.CLIENT_SECRET_POST,
    );
    expect(input.scopes).toEqual(["repo"]);
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("github-oauth");
  });

  it("sends a newly entered secret instead of the marker", async () => {
    const update = vi.fn(async (_input: OAuthAppInput) => APP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const secret = await screen.findByLabelText("Client secret");
    fireEvent.change(secret, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].clientSecret).toBe("new-secret");
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
    expect(asked.sort()).toEqual([
      "oauth_app:oa-1:can_delete",
      "oauth_app:oa-1:can_edit",
    ]);
  });

  it("an admin who did not create the app reads it with neither control", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(vi.fn(), checkMyPermission);

    await waitFor(() => expect(checkMyPermission).toHaveBeenCalledTimes(2));
    // The configuration stays readable; only the change affordances are withheld.
    expect(screen.getByRole("heading", { name: "github" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
