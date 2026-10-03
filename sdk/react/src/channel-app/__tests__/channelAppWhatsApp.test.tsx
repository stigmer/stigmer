import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ChannelAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { PublicBaseUrlContext } from "../../public-base-url-context";
import { CreateChannelAppForm, type ChannelAppCreateHandoff } from "../CreateChannelAppForm";
import { ChannelAppDetailPanel } from "../ChannelAppDetailPanel";

afterEach(cleanup);

function createMockStigmer(overrides: {
  create?: (input: ChannelAppInput) => Promise<unknown>;
  update?: (input: ChannelAppInput) => Promise<unknown>;
  baseUrl?: string;
} = {}) {
  return {
    baseUrl: overrides.baseUrl ?? "https://api.stigmer.ai",
    channelapp: {
      create: overrides.create ?? vi.fn().mockResolvedValue({
        metadata: { id: "chapp_new", org: "acme", slug: "acme-whatsapp" },
      }),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    // The detail panel gates its credentials form and deletion on the
    // caller's permissions; these cases are the creator's view.
    iamPolicy: {
      checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: true }),
    },
  } as never;
}

function Providers({
  client,
  publicBaseUrl,
  children,
}: {
  client: unknown;
  publicBaseUrl?: string;
  children: ReactNode;
}) {
  return (
    <StigmerContext.Provider value={client as never}>
      <PublicBaseUrlContext.Provider value={publicBaseUrl}>
        {children}
      </PublicBaseUrlContext.Provider>
    </StigmerContext.Provider>
  );
}

/** A WhatsApp channel app as the server returns it — secrets redacted. */
function makeWhatsAppApp() {
  return {
    metadata: { id: "chapp_1", org: "acme", slug: "acme-whatsapp", name: "Acme WhatsApp" },
    spec: {
      providerConfig: {
        case: "whatsapp",
        value: {
          appId: "1234567890123456",
          appSecret: "***REDACTED***",
          accessToken: "***REDACTED***",
          verifyToken: "***REDACTED***",
        },
      },
    },
  } as never;
}

describe("CreateChannelAppForm — WhatsApp branch", () => {
  it("switches the credential fields when the provider changes", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <CreateChannelAppForm org="acme" />
      </Providers>,
    );

    // Slack is the default: manifest + OAuth credentials.
    expect(screen.getByText(/slack app manifest/i)).toBeTruthy();
    expect(screen.getByLabelText(/client id/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /whatsapp/i }));

    // WhatsApp: Meta credentials, no manifest (Meta has no equivalent).
    expect(screen.queryByText(/slack app manifest/i)).toBeNull();
    expect(screen.getByLabelText(/app id/i)).toBeTruthy();
    expect(screen.getByLabelText(/app secret/i)).toBeTruthy();
    expect(screen.getByLabelText(/access token/i)).toBeTruthy();
    expect(screen.getByLabelText(/verify token/i)).toBeTruthy();
  });

  it("pre-generates a strong verify token the user can override", () => {
    render(
      <Providers client={createMockStigmer()}>
        <CreateChannelAppForm org="acme" />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("radio", { name: /whatsapp/i }));

    // Generated, not empty: the token is customer-authored but
    // a strong default prevents guessable handshake secrets.
    const tokenInput = screen.getByLabelText(/verify token/i) as HTMLInputElement;
    expect(tokenInput.value).toMatch(/^[0-9a-f]{64}$/);

    fireEvent.change(tokenInput, { target: { value: "my-own-token" } });
    expect(tokenInput.value).toBe("my-own-token");
  });

  it("submits the whatsapp arm and hands the verify token to the host", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "chapp_new", org: "acme" },
    });
    const onCreated =
      vi.fn<(app: unknown, handoff: ChannelAppCreateHandoff) => void>();

    render(
      <Providers client={createMockStigmer({ create })}>
        <CreateChannelAppForm org="acme" onCreated={onCreated} />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("radio", { name: /whatsapp/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Acme WhatsApp" },
    });
    fireEvent.change(screen.getByLabelText(/app id/i), {
      target: { value: "1234567890123456" },
    });
    fireEvent.change(screen.getByLabelText(/app secret/i), {
      target: { value: "shhh-secret" },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: "EAAG-token" },
    });
    fireEvent.change(screen.getByLabelText(/verify token/i), {
      target: { value: "verify-me" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /register channel app/i }),
    );

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      name: "Acme WhatsApp",
      org: "acme",
      whatsapp: {
        appId: "1234567890123456",
        appSecret: "shhh-secret",
        accessToken: "EAAG-token",
        verifyToken: "verify-me",
      },
    });

    // The handoff carries the once-visible token: the detail panel shows
    // it alongside the freshly-minted webhook URL (it answers redacted
    // from now on).
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][1]).toEqual({ verifyToken: "verify-me" });
  });

  it("hands off no secrets for Slack apps", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "chapp_new", org: "acme" },
    });
    const onCreated =
      vi.fn<(app: unknown, handoff: ChannelAppCreateHandoff) => void>();

    render(
      <Providers client={createMockStigmer({ create })}>
        <CreateChannelAppForm org="acme" onCreated={onCreated} />
      </Providers>,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Acme Bot" },
    });
    fireEvent.change(screen.getByLabelText(/client id/i), {
      target: { value: "123.456" },
    });
    fireEvent.change(screen.getByLabelText(/client secret/i), {
      target: { value: "cs" },
    });
    fireEvent.change(screen.getByLabelText(/signing secret/i), {
      target: { value: "ss" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /register channel app/i }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][1]).toEqual({});
  });
});

describe("ChannelAppDetailPanel — WhatsApp branch", () => {
  it("shows the callback URL and the handed-off verify token together, once", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ChannelAppDetailPanel
          channelApp={makeWhatsAppApp()}
          createHandoff={{ verifyToken: "verify-me" }}
        />
      </Providers>,
    );

    // Phase two of the setup needs both values in one place: the URL is
    // minted at creation, the token was just entered and never answers
    // in cleartext again.
    expect(screen.getByText(/finish setup in meta/i)).toBeTruthy();
    expect(
      screen.getByText("https://api.stigmer.ai/webhook/whatsapp/chapp_1"),
    ).toBeTruthy();
    expect(screen.getByText("verify-me")).toBeTruthy();
    // The subscribed field is named so the checklist is complete.
    expect(screen.getByText(/messages/)).toBeTruthy();
  });

  it("explains the token's one-time visibility when there is no handoff", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ChannelAppDetailPanel channelApp={makeWhatsAppApp()} />
      </Providers>,
    );

    expect(screen.getByText(/shown once at registration/i)).toBeTruthy();
    expect(screen.queryByText("verify-me")).toBeNull();
  });

  it("rotates credentials through the whatsapp arm, preserving untouched secrets", async () => {
    const update = vi.fn().mockResolvedValue({});

    render(
      <Providers client={createMockStigmer({ update })}>
        <ChannelAppDetailPanel channelApp={makeWhatsAppApp()} />
      </Providers>,
    );

    // Rotate one secret; the others keep the redaction marker, which the
    // server treats as "keep the stored value".
    fireEvent.change(await screen.findByLabelText(/access token/i), {
      target: { value: "EAAG-new-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({
      // The generated mapper carries metadata.id for exact update addressing.
      id: "chapp_1",
      name: "Acme WhatsApp",
      org: "acme",
      slug: "acme-whatsapp",
      whatsapp: {
        appId: "1234567890123456",
        appSecret: "***REDACTED***",
        accessToken: "EAAG-new-token",
        verifyToken: "***REDACTED***",
      },
    });
  });

  it("keeps the Slack detail body for Slack apps", () => {
    const slackApp = {
      metadata: { id: "chapp_s", org: "acme", slug: "acme-bot", name: "Acme Bot" },
      spec: {
        providerConfig: {
          case: "slack",
          value: {
            clientId: "123.456",
            clientSecret: "***REDACTED***",
            signingSecret: "***REDACTED***",
          },
        },
      },
    } as never;

    render(
      <Providers client={createMockStigmer()}>
        <ChannelAppDetailPanel channelApp={slackApp} />
      </Providers>,
    );

    expect(screen.getByText(/finish setup in slack/i)).toBeTruthy();
    expect(
      screen.getByText("https://api.stigmer.ai/webhook/slack/chapp_s"),
    ).toBeTruthy();
    expect(screen.queryByText(/finish setup in meta/i)).toBeNull();
  });
});

describe("ChannelAppDetailPanel — the server's public address (stigmer/stigmer#1335)", () => {
  // A client behind a same-origin proxy talks to the server through a
  // relative baseUrl. Slack and Meta call the webhook from outside the page,
  // so the panel builds it only from an absolute address the host named,
  // and says so when there is none, instead of offering a relative URL.
  const UNKNOWN_ADDRESS = /doesn't know your Stigmer server's public address/;

  const slackApp = {
    metadata: { id: "chapp_s", org: "acme", slug: "acme-bot", name: "Acme Bot" },
    spec: {
      providerConfig: {
        case: "slack",
        value: {
          clientId: "123.456",
          clientSecret: "***REDACTED***",
          signingSecret: "***REDACTED***",
        },
      },
    },
  } as never;

  it("says the WhatsApp callback URL is unknown for a relative baseUrl, offering nothing to copy", () => {
    render(
      <Providers client={createMockStigmer({ baseUrl: "/" })}>
        <ChannelAppDetailPanel
          channelApp={makeWhatsAppApp()}
          createHandoff={{ verifyToken: "verify-me" }}
        />
      </Providers>,
    );

    expect(screen.getByText("Callback URL")).toBeTruthy();
    expect(screen.getByText(UNKNOWN_ADDRESS)).toBeTruthy();
    expect(screen.queryByText(/\/webhook\/whatsapp\//)).toBeNull();
    // The verify token is not an address and is still offered.
    expect(screen.getByText("verify-me")).toBeTruthy();
  });

  it("says the Slack request URL is unknown and leaves event subscriptions out of the manifest", () => {
    render(
      <Providers client={createMockStigmer({ baseUrl: "/" })}>
        <ChannelAppDetailPanel channelApp={slackApp} consoleOrigin="https://console.acme.example" />
      </Providers>,
    );

    expect(screen.getByText("Events request URL")).toBeTruthy();
    expect(screen.getByText(UNKNOWN_ADDRESS)).toBeTruthy();
    expect(screen.queryByText(/\/webhook\/slack\//)).toBeNull();
    expect(document.body.textContent).not.toContain("request_url");
    expect(document.body.textContent).not.toContain("event_subscriptions");
    // The OAuth redirect is the console's own address and is unaffected.
    expect(
      screen.getAllByText(/https:\/\/console\.acme\.example\/oauth\/slack\/callback/).length,
    ).toBeGreaterThan(0);
  });

  it("builds both webhook URLs from the host's public base URL", () => {
    const { unmount } = render(
      <Providers client={createMockStigmer({ baseUrl: "/" })} publicBaseUrl="https://api.acme.example/">
        <ChannelAppDetailPanel channelApp={slackApp} />
      </Providers>,
    );
    expect(screen.getByText("https://api.acme.example/webhook/slack/chapp_s")).toBeTruthy();
    expect(document.body.textContent).toContain(
      'request_url: "https://api.acme.example/webhook/slack/chapp_s"',
    );
    unmount();

    render(
      <Providers client={createMockStigmer({ baseUrl: "/" })} publicBaseUrl="https://api.acme.example">
        <ChannelAppDetailPanel channelApp={makeWhatsAppApp()} />
      </Providers>,
    );
    expect(screen.getByText("https://api.acme.example/webhook/whatsapp/chapp_1")).toBeTruthy();
    expect(screen.queryByText(UNKNOWN_ADDRESS)).toBeNull();
  });
});
