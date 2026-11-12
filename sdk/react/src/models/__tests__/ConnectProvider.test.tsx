/**
 * The launcher's two readiness faces on their own, over a hand-built hub
 * answer, for what the launcher's suite does not reach through a server:
 * the line above the composer for a member (who learns an admin connects
 * it) and for a remote server's runners (whoever runs them gives them a
 * key), with the link to Models & providers rather than a connect act; no
 * line for a provider that serves; neither face for a provider the server
 * did not report, or before the server has judged any model; and the panel's
 * lead by who adds the key: the reason Stigmer wants their own key for the
 * person who adds it, and whose key it is for anyone else.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectProviderPanel, ModelNeedsProvider } from "../ConnectProvider";
import type { ModelsHubData } from "../hub/ModelsHub";
import type { ProviderReadiness } from "../readiness";
import { ORG_ID, fakeClient, readinessWrapper, server } from "./readiness-fixture";

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
    readinessLoading: false,
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

  const WHY = "Your agents think with a model. Stigmer uses your own Anthropic key, so you pay Anthropic directly.";

  function renderPanel(report: ProviderReadiness, viewer: ModelsHubData["viewer"]) {
    render(
      <ConnectProviderPanel hub={hub([report], { viewer })} harness="stigmer" provider="anthropic" modelName="Claude Sonnet 4.6" />,
      { wrapper: readinessWrapper(fakeClient(server()).client) },
    );
  }

  it("tells the person who adds the key why Stigmer wants their own, on Cloud and on a laptop", () => {
    renderPanel(ANTHROPIC_MISSING, { canManage: true, local: false });
    expect(screen.getByText(`${WHY} Once Acme Research has an Anthropic key, you can send your first task.`)).toBeTruthy();
    cleanup();

    renderPanel({ provider: "anthropic", availability: { state: "missing", scope: "runners" } }, { canManage: false, local: true });
    expect(screen.getByText(`${WHY} Give this machine's runner a key, and you can send your first task.`)).toBeTruthy();
  });

  it("names the model and whose key it waits on for a member and a server's user, never their own key", () => {
    renderPanel(ANTHROPIC_MISSING, { canManage: false, local: false });
    expect(
      screen.getByText("Claude Sonnet 4.6 on Stigmer runs on Anthropic. Once Acme Research has an Anthropic key, you can send your first task."),
    ).toBeTruthy();
    cleanup();

    renderPanel({ provider: "anthropic", availability: { state: "missing", scope: "runners" } }, { canManage: false, local: false });
    expect(
      screen.getByText(
        "Claude Sonnet 4.6 on Stigmer runs on Anthropic. Once this server's runners have an Anthropic key, you can send your first task.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/your own/)).toBeNull();
  });
});

