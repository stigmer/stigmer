import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { CreateOAuthAppForm } from "../CreateOAuthAppForm";

/**
 * Pins the create form's addresses: an app is created only once it lists
 * at least one address the app signs in to, and the list typed (comma or
 * newline separated) reaches the server as its entries, trimmed.
 */

const CREATED = create(OAuthAppSchema, { metadata: { id: "oa-1", name: "Slack", org: "acme" } });

function renderForm(createApp: ReturnType<typeof vi.fn>) {
  const client = { oauthapp: { create: createApp } } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <CreateOAuthAppForm org="acme" />
    </StigmerContext.Provider>,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

describe("CreateOAuthAppForm addresses", () => {
  it("creates only once an address is listed, and sends every address typed", async () => {
    const createApp = vi.fn(async (_input: OAuthAppInput) => CREATED);
    renderForm(createApp);

    fill("Name", "Slack");
    fill("Provider", "Slack");
    fill("Client ID", "client-1");
    fill("Client secret", "secret-1");
    fill("Authorization URL", "https://slack.com/oauth/v2/authorize");
    fill("Token URL", "https://slack.com/api/oauth.v2.access");
    const submit = screen.getByRole("button", { name: "Create OAuth app" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fill("Addresses", " https://mcp.slack.com/mcp ,\nslack.com ");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(createApp).toHaveBeenCalledTimes(1));
    expect(createApp.mock.calls[0]![0]).toMatchObject({
      name: "Slack",
      org: "acme",
      addresses: ["https://mcp.slack.com/mcp", "slack.com"],
    });
  });
});
