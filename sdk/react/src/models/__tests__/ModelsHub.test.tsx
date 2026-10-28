/**
 * Models & providers: one card per provider, in the server's order, each
 * with the act the person looking can take. Pins every face by role and
 * text: the admin's key form (and the save that asks the server again for
 * readiness and the key list), the member's line, a laptop's command for
 * each provider (matching the server's refusal), a server's runners, a
 * server that cannot see its runners, a provider served through the parent
 * organization, and the words for the save's check with the provider.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderAvailability } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { ProviderKeyCheck } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import type { DeploymentMode } from "@stigmer/client";
import { ModelsHub } from "../hub/ModelsHub";
import {
  ANTHROPIC_CONNECTED,
  LAPTOP_WITHOUT_KEYS,
  NOTHING_CONNECTED,
  ORG_ID,
  PARENT_ID,
  fakeClient,
  readiness,
  readinessWrapper,
  server,
  storedKey,
  type FakeServer,
} from "./readiness-fixture";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

function renderHub(fake: FakeServer, mode: DeploymentMode = "cloud") {
  const calls = fakeClient(fake);
  render(<ModelsHub org={ORG_ID} />, { wrapper: readinessWrapper(calls.client, mode) });
  return calls;
}

async function card(name: string): Promise<HTMLElement> {
  return screen.findByRole("article", { name });
}

describe("ModelsHub", () => {
  it("draws a card per provider in the server's order, with the models each unlocks by engine", async () => {
    renderHub(server());

    const cards = await screen.findAllByRole("article");
    expect(cards.map((element) => element.getAttribute("aria-labelledby") !== null)).toEqual([true, true]);
    expect(within(cards[0]).getByRole("heading", { name: "Anthropic" })).toBeTruthy();
    expect(within(cards[1]).getByRole("heading", { name: "OpenAI" })).toBeTruthy();
    expect(within(cards[0]).getByText("Unlocks")).toBeTruthy();
    expect(within(cards[0]).getByText("Claude Sonnet 4.6")).toBeTruthy();
    expect(within(cards[0]).getByText("Claude Sonnet 5")).toBeTruthy();
    expect(within(cards[1]).getByText("GPT-5")).toBeTruthy();
    // The header keeps its title and one sentence: no figures strip.
    expect(screen.getByRole("heading", { level: 1, name: "Models & providers" })).toBeTruthy();
    expect(screen.getByText("Which models Acme Research's agents can run, and the provider keys behind them.")).toBeTruthy();
  });

  it("gives an admin of an organization without a key the form, and asks again for readiness and keys after a save", async () => {
    const fake = server();
    const calls = renderHub(fake);
    const anthropic = await card("Anthropic");
    expect(within(anthropic).getByText("Not connected")).toBeTruthy();
    expect(within(anthropic).getByText("Runs that need Anthropic are refused until a key is added.")).toBeTruthy();
    expect(within(anthropic).getByRole("link", { name: /Get a key at console.anthropic.com/ }).getAttribute("href")).toBe(
      "https://console.anthropic.com/settings/keys",
    );

    fireEvent.click(within(anthropic).getByRole("button", { name: "Connect Anthropic" }));
    fireEvent.change(within(anthropic).getByLabelText("Anthropic API key"), { target: { value: "sk-ant-test" } });
    const readsBefore = calls.getModelReadiness.mock.calls.length;
    const listsBefore = calls.listKeys.mock.calls.length;
    fake.readiness = ANTHROPIC_CONNECTED;
    fake.keys = [storedKey("anthropic", { keyHint: "x7Qa", check: ProviderKeyCheck.checked })];
    fireEvent.click(within(anthropic).getByRole("button", { name: "Connect Anthropic" }));

    await waitFor(() => expect(within(anthropic).getByText("Connected")).toBeTruthy());
    expect(calls.setKey).toHaveBeenCalledTimes(1);
    expect(calls.setKey.mock.calls[0][0]).toMatchObject({ org: ORG_ID, provider: "anthropic", apiKey: "sk-ant-test", baseUrl: "" });
    expect(calls.getModelReadiness.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(calls.listKeys.mock.calls.length).toBeGreaterThan(listsBefore);
    expect(within(anthropic).getByText(/Key ending in x7Qa · Checked with Anthropic/)).toBeTruthy();
    expect(within(anthropic).getByText("Ready to run")).toBeTruthy();
  });

  it("tells a member who connects a provider, with no form", async () => {
    renderHub(server({ canManage: false }));
    const anthropic = await card("Anthropic");

    await waitFor(() =>
      expect(
        within(anthropic).getByText(
          "An admin of Acme Research connects Anthropic. Ask one to add its key in Models & providers, and these models are ready for everyone in Acme Research.",
        ),
      ).toBeTruthy(),
    );
    expect(within(anthropic).queryByRole("button")).toBeNull();
    expect(within(anthropic).queryByLabelText("Anthropic API key")).toBeNull();
  });

  it("shows a laptop the command that gives its runner each provider's key, as the server's refusal says", async () => {
    const calls = renderHub(server({ readiness: LAPTOP_WITHOUT_KEYS }), "local");
    const anthropic = await card("Anthropic");
    const openai = await card("OpenAI");

    expect(screen.getByText("Which models your agents can run on this machine, and the providers behind them.")).toBeTruthy();
    expect(within(anthropic).getByText("Runs that need Anthropic are refused until this machine's runner has a key.")).toBeTruthy();
    expect(within(anthropic).getByText("Run stigmer setup in a terminal on this machine, then restart Stigmer:")).toBeTruthy();
    expect(within(anthropic).getByText(/stigmer setup\s+stigmer down && stigmer up/)).toBeTruthy();
    expect(within(anthropic).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(within(openai).getByText("Set OPENAI_API_KEY in the shell you start Stigmer from, then restart Stigmer:")).toBeTruthy();
    expect(within(openai).getByText(/export OPENAI_API_KEY=<your key>\s+stigmer down && stigmer up/)).toBeTruthy();
    // A laptop's keys belong to the machine: no form, no key list read, no permission asked.
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    expect(calls.listKeys).not.toHaveBeenCalled();
    expect(calls.checkMyPermission).not.toHaveBeenCalled();
  });

  it("says whoever runs a remote server's runners gives them the key", async () => {
    renderHub(
      server({
        readiness: readiness({
          anthropic: ProviderAvailability.missing_from_runners,
          openai: ProviderAvailability.served_by_runners,
        }),
      }),
      "enterprise",
    );
    const anthropic = await card("Anthropic");
    const openai = await card("OpenAI");

    expect(within(anthropic).getByText("This server's runners have no Anthropic key; whoever runs them gives them one.")).toBeTruthy();
    expect(within(anthropic).queryByText(/stigmer setup/)).toBeNull();
    expect(within(openai).getByText("Set on this server's runners")).toBeTruthy();
    expect(within(openai).getByText("This server's runners reach OpenAI.")).toBeTruthy();
  });

  it("says a provider is configured where the runner runs when the server cannot see its runners", async () => {
    renderHub(
      server({
        readiness: readiness({
          anthropic: ProviderAvailability.availability_unknown,
          openai: ProviderAvailability.availability_unknown,
        }),
      }),
      "local",
    );
    const anthropic = await card("Anthropic");

    expect(within(anthropic).getByText("Configured where the runner runs")).toBeTruthy();
    expect(within(anthropic).queryByRole("button")).toBeNull();
    expect(within(anthropic).queryByText(/stigmer setup/)).toBeNull();
  });

  it("names the parent organization whose key serves, with the key's endpoint and the check's words", async () => {
    renderHub(
      server({
        readiness: readiness({
          anthropic: { availability: ProviderAvailability.served_by_parent_organization, parentOrg: PARENT_ID },
          openai: ProviderAvailability.served_by_organization,
        }),
        keys: [
          storedKey("anthropic", {
            keyHint: "m2Lk",
            inheritedFromOrg: PARENT_ID,
            baseUrl: "https://gateway.acme.example/v1",
            check: ProviderKeyCheck.unchecked,
            lastUsedDaysAgo: 2,
          }),
          storedKey("openai", { keyHint: "Rt9e" }),
        ],
      }),
    );
    const anthropic = await card("Anthropic");
    const openai = await card("OpenAI");

    await waitFor(() => expect(within(anthropic).getByText("Connected through Acme Holdings")).toBeTruthy());
    expect(
      within(anthropic).getByText(
        "Key ending in m2Lk · from Acme Holdings (parent organization) · Saved, not checked: Anthropic did not answer · on gateway.acme.example · last used Oct 26",
      ),
    ).toBeTruthy();
    // An inherited key is the parent's: nobody here replaces or removes it.
    expect(within(anthropic).queryByRole("button", { name: "Replace key" })).toBeNull();
    // A key whose check says nothing gets no check words.
    expect(within(openai).getByText(/^Key ending in Rt9e · saved Oct 21 by ada@acme.example · not used yet$/)).toBeTruthy();
    expect(within(openai).getByRole("button", { name: "Replace key" })).toBeTruthy();
  });

  it("removes an own key after a confirmation, and asks the server again", async () => {
    const fake = server({ readiness: ANTHROPIC_CONNECTED, keys: [storedKey("anthropic")] });
    const calls = renderHub(fake);
    const anthropic = await card("Anthropic");
    await waitFor(() => expect(within(anthropic).getByRole("button", { name: "Remove" })).toBeTruthy());

    fireEvent.click(within(anthropic).getByRole("button", { name: "Remove" }));
    expect(
      within(anthropic).getByText(
        "Remove the Anthropic key? Runs that need Anthropic are refused until a key serves Acme Research again.",
      ),
    ).toBeTruthy();
    fake.readiness = NOTHING_CONNECTED;
    fake.keys = [];
    fireEvent.click(within(anthropic).getByRole("button", { name: "Remove key" }));

    await waitFor(() => expect(within(anthropic).getByText("Not connected")).toBeTruthy());
    expect(calls.deleteKey.mock.calls[0][0]).toMatchObject({ org: ORG_ID, provider: "anthropic" });
  });

  it("offers an own key's endpoint on a replace, with the endpoint field's hint, and saves against it", async () => {
    const fake = server({
      readiness: ANTHROPIC_CONNECTED,
      keys: [storedKey("anthropic", { baseUrl: "https://gateway.acme.example" })],
    });
    const calls = renderHub(fake);
    const anthropic = await card("Anthropic");
    await waitFor(() => expect(within(anthropic).getByText(/on gateway\.acme\.example/)).toBeTruthy());

    fireEvent.click(within(anthropic).getByRole("button", { name: "Replace key" }));
    const baseUrl = within(anthropic).getByLabelText("Base URL (optional)");
    expect(baseUrl).toHaveProperty("value", "https://gateway.acme.example");
    expect(within(anthropic).getByText(/Leave the base URL empty for Anthropic's own API/)).toBeTruthy();
    fireEvent.change(within(anthropic).getByLabelText("Anthropic API key"), { target: { value: "sk-ant-new" } });
    fireEvent.click(within(anthropic).getByRole("button", { name: "Replace key" }));

    await waitFor(() => expect(calls.setKey).toHaveBeenCalledTimes(1));
    expect(calls.setKey.mock.calls[0][0]).toMatchObject({ provider: "anthropic", apiKey: "sk-ant-new", baseUrl: "https://gateway.acme.example" });
  });

  it("shows a refused save in the server's words, and keeps the form open", async () => {
    const calls = renderHub(server());
    calls.setKey.mockRejectedValueOnce(new Error("Anthropic refused this key."));
    const anthropic = await card("Anthropic");
    await waitFor(() => expect(within(anthropic).getByRole("button", { name: "Connect Anthropic" })).toBeTruthy());

    fireEvent.click(within(anthropic).getByRole("button", { name: "Connect Anthropic" }));
    fireEvent.change(within(anthropic).getByLabelText("Anthropic API key"), { target: { value: "sk-ant-bad" } });
    fireEvent.click(within(anthropic).getByRole("button", { name: "Connect Anthropic" }));

    expect((await within(anthropic).findByRole("alert")).textContent).toContain("Anthropic refused this key.");
    expect(within(anthropic).getByLabelText("Anthropic API key")).toBeTruthy();
    expect(within(anthropic).getByText("Not connected")).toBeTruthy();
  });

  it("keeps the key when the admin cancels the removal", async () => {
    const calls = renderHub(server({ readiness: ANTHROPIC_CONNECTED, keys: [storedKey("anthropic")] }));
    const anthropic = await card("Anthropic");
    await waitFor(() => expect(within(anthropic).getByRole("button", { name: "Remove" })).toBeTruthy());

    fireEvent.click(within(anthropic).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(anthropic).getByRole("button", { name: "Cancel" }));

    expect(within(anthropic).getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(within(anthropic).getByText("Connected")).toBeTruthy();
    expect(calls.deleteKey).not.toHaveBeenCalled();
  });

  it("says what went wrong when readiness cannot be read, and tries again", async () => {
    const fake = server();
    const calls = fakeClient(fake);
    let fail = true;
    calls.getModelReadiness.mockImplementation(async () => {
      if (fail) throw new Error("the server is unreachable");
      return fake.readiness;
    });
    render(<ModelsHub org={ORG_ID} />, { wrapper: readinessWrapper(calls.client) });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the server is unreachable");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await card("Anthropic")).toBeTruthy();
  });
});
