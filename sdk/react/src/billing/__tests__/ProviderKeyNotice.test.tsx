// The provider-key refusal: read off the refusal's reason, never its copy,
// with what it names; rendered with
// the server's copy and a link to Models & providers, the host's or the
// default.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StigmerError } from "@stigmer/client";
import { ProviderKeyNotice, providerKeyRequired } from "../ProviderKeyNotice";
import { refusal } from "./fixtures";

afterEach(cleanup);

const COPY =
  "This organization has no Anthropic key for model 'claude-sonnet-4-6', so the run was not started. An admin can add one in Models & providers.";
const REFUSAL = refusal(COPY, "PROVIDER_KEY_REQUIRED", { org: "acme", provider: "anthropic", model: "claude-sonnet-4-6" });

describe("providerKeyRequired", () => {
  it("reads the org, provider and model from the refusal's reason", () => {
    expect(providerKeyRequired(REFUSAL)).toEqual({ org: "acme", provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(providerKeyRequired(refusal("x", "PROVIDER_KEY_REQUIRED", {}))).toEqual({ org: "", provider: "", model: "" });
  });

  it("is null for any other error, whatever its copy", () => {
    expect(providerKeyRequired(new StigmerError("failed-precondition", COPY, 9))).toBeNull();
    expect(providerKeyRequired(refusal(COPY, "PLAN_UPGRADE_REQUIRED", { feature: "teams" }))).toBeNull();
    expect(providerKeyRequired(null)).toBeNull();
  });
});

describe("ProviderKeyNotice", () => {
  it("shows the server's copy and links to Models & providers", () => {
    render(<ProviderKeyNotice error={REFUSAL} />);
    expect(screen.getByRole("alert").textContent).toContain(COPY);
    expect(screen.getByRole("link", { name: "Open Models & providers" }).getAttribute("href")).toBe("/models");
  });

  it("links to the host's own route when given one", () => {
    render(<ProviderKeyNotice error={REFUSAL} modelsHubHref="#/models" />);
    expect(screen.getByRole("link", { name: "Open Models & providers" }).getAttribute("href")).toBe("#/models");
  });
});
