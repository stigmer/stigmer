/**
 * The launcher's two readiness faces on their own, over a hand-built hub
 * answer, for what the launcher's suite does not reach through a server:
 * the line above the composer for a member (who learns an admin connects
 * it) and for a remote server's runners (whoever runs them gives them a
 * key), with the link to Models & providers rather than a connect act; no
 * line for a provider that serves; and neither face for a provider the
 * server did not report, or before the server has judged any model.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectProviderPanel, ModelNeedsProvider } from "../ConnectProvider";
import type { ModelsHubData } from "../hub/ModelsHub";
import type { ProviderReadiness } from "../readiness";
import { ORG_ID } from "./readiness-fixture";

afterEach(cleanup);

function hub(providers: readonly ProviderReadiness[] | null, fields: Partial<ModelsHubData> = {}): ModelsHubData {
  return {
    org: ORG_ID,
    orgName: "Acme Research",
    viewer: { canManage: false, local: false },
    providers,
    models: [],
    keyOf: () => undefined,
    parentOrgNameOf: () => undefined,
    readinessOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: () => {},
    ...fields,
  };
}

const ANTHROPIC_MISSING: ProviderReadiness = { provider: "anthropic", availability: { state: "missing", scope: "organization" } };

describe("ModelNeedsProvider", () => {
  it("tells a member an admin connects the provider, and links Models & providers", () => {
    render(<ModelNeedsProvider hub={hub([ANTHROPIC_MISSING])} provider="anthropic" modelName="Claude Sonnet 4.6" />);

    const reason = screen.getByText(/^Connect Anthropic to run Claude Sonnet 4\.6\./);
    expect(reason.textContent).toBe(
      "Connect Anthropic to run Claude Sonnet 4.6. An admin of Acme Research connects it; until then, pick a model marked ready.",
    );
    expect(screen.getByRole("link", { name: "Models & providers" }).getAttribute("href")).toBe("/models");
  });

  it("says whoever runs a remote server's runners gives them the key", () => {
    render(
      <ModelNeedsProvider
        hub={hub([{ provider: "openai", availability: { state: "missing", scope: "runners" } }])}
        provider="openai"
        modelName="GPT-5"
      />,
    );

    expect(screen.getByText(/^Connect OpenAI to run GPT-5\./).textContent).toBe(
      "Connect OpenAI to run GPT-5. This server's runners have no OpenAI key; whoever runs them gives them one.",
    );
  });

  it("names no act for a provider that serves", () => {
    render(
      <ModelNeedsProvider
        hub={hub([{ provider: "anthropic", availability: { state: "served", source: "organization", parentOrg: "" } }])}
        provider="anthropic"
        modelName="Claude Sonnet 4.6"
      />,
    );

    expect(screen.getByText(/^Connect Anthropic to run Claude Sonnet 4\.6\./).textContent).toBe(
      "Connect Anthropic to run Claude Sonnet 4.6. ",
    );
  });

  it("draws nothing for a provider the server did not report", () => {
    const { container } = render(
      <ModelNeedsProvider hub={hub([ANTHROPIC_MISSING])} provider="mistral" modelName="Mistral Large" />,
    );

    expect(container.childElementCount).toBe(0);
  });
});

describe("ConnectProviderPanel", () => {
  it("draws nothing for a provider the server did not report", () => {
    const { container } = render(
      <ConnectProviderPanel hub={hub([ANTHROPIC_MISSING])} harness="stigmer" provider="mistral" modelName="Mistral Large" />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("draws nothing before the server has judged any model", () => {
    const { container } = render(
      <ConnectProviderPanel
        hub={hub([ANTHROPIC_MISSING], { models: null })}
        harness="stigmer"
        provider="anthropic"
        modelName="Claude Sonnet 4.6"
      />,
    );

    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole("heading", { name: "Connect a model provider to start" })).toBeNull();
  });
});
