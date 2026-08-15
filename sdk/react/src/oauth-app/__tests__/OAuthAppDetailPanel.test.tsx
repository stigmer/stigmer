import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OAuthAppSchema,
  type OAuthApp,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import type { OAuthAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { OAuthAppDetailPanel } from "../OAuthAppDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: the panel must
 * spread `toOAuthAppUpdateInput` and override only what it edits, so a
 * spec field the form does not know about survives the save. The secret
 * has its own contract: an empty secret input sends the fetched value —
 * the server's redaction marker — which the update pipeline treats as
 * "keep the stored secret" (oss#395 pins the marker/ciphertext boundary).
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

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    oauthapp: { update },
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const secret = await screen.findByLabelText("Client secret");
    fireEvent.change(secret, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0].clientSecret).toBe("new-secret");
  });
});
