/**
 * One provider card on its own, for the standings the hub's suite does not
 * reach through a server: a provider this build does not know, missing from
 * a laptop's runner (it says so, with no command to copy); a provider that
 * unlocks no model (no models row); a provider served while the key list
 * cannot be read (it says whose key serves, the parent's unnamed one
 * included); a key on an endpoint that is not a full address (shown as
 * saved); and the check's words for a value newer than this build (none).
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ProviderKeyCheck } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { ProviderCard, checkWords, type ProviderCardProps } from "../hub/ProviderCard";
import { ORG_ID, fakeClient, readinessWrapper, server, storedKey } from "./readiness-fixture";

afterEach(cleanup);

function renderCard(props: Partial<ProviderCardProps> & Pick<ProviderCardProps, "report">) {
  const calls = fakeClient(server());
  render(
    <ProviderCard org={ORG_ID} orgName="Acme Research" viewer={{ canManage: true, local: false }} models={[]} {...props} />,
    { wrapper: readinessWrapper(calls.client) },
  );
  return screen.getByRole("article");
}

describe("ProviderCard", () => {
  it("says a laptop's runner has no key for a provider this build does not know, with nothing to copy", () => {
    const card = renderCard({
      report: { provider: "mistral", availability: { state: "missing", scope: "runners" } },
      viewer: { canManage: true, local: true },
    });

    expect(within(card).getByRole("heading", { name: "Mistral" })).toBeTruthy();
    expect(within(card).getByText("This machine's runner has no Mistral key.")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("names no models when the provider unlocks none", () => {
    const card = renderCard({ report: { provider: "anthropic", availability: { state: "missing", scope: "organization" } } });

    expect(within(card).getByRole("button", { name: "Connect Anthropic" })).toBeTruthy();
    expect(within(card).queryByText("Unlocks")).toBeNull();
    expect(within(card).queryByText("Ready to run")).toBeNull();
  });

  it("says the organization's own key serves when the key list cannot be read", () => {
    const card = renderCard({
      report: { provider: "anthropic", availability: { state: "served", source: "organization", parentOrg: "" } },
    });

    expect(within(card).getByText("Connected")).toBeTruthy();
    expect(within(card).getByText("This organization's own key serves it.")).toBeTruthy();
  });

  it("says the parent organization's key serves, unnamed when the server names no parent", () => {
    const card = renderCard({
      report: { provider: "anthropic", availability: { state: "served", source: "parent", parentOrg: "" } },
    });

    expect(within(card).getByText("Connected through the parent organization")).toBeTruthy();
    expect(within(card).getByText("The parent organization's key serves this organization.")).toBeTruthy();
  });

  it("shows a key's endpoint as saved when it is not a full address", () => {
    const card = renderCard({
      report: { provider: "openai", availability: { state: "served", source: "organization", parentOrg: "" } },
      storedKey: storedKey("openai", { keyHint: "Rt9e", baseUrl: "gateway.acme.example/v1" }),
    });

    expect(within(card).getByText(/^Key ending in Rt9e · on gateway\.acme\.example\/v1 · saved /)).toBeTruthy();
  });

  it("has no words for a check value newer than this build", () => {
    expect(checkWords(ProviderKeyCheck.checked, "Anthropic")).toBe("Checked with Anthropic");
    expect(checkWords(99 as ProviderKeyCheck, "Anthropic")).toBeNull();
  });
});
