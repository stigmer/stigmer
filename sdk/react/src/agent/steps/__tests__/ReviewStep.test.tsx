/**
 * The agent wizard's review step names the organization the agent is created
 * in by its slug, which a person reads, while the manifest it previews (and
 * submits) names the org by its id. The plugins the wizard holds are
 * counted and go into the manifest, and none leaves `plugins` out.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReviewStep, buildAgentInput } from "../ReviewStep";
import { createInitialWizardData } from "../types";
import { ACME_ID, orgWrapper } from "../../../organization/__tests__/org-fixture";

afterEach(cleanup);

const data = { ...createInitialWizardData(), name: "Triage", slug: "triage" };

describe("ReviewStep (agent)", () => {
  it("shows the organization's slug and previews a manifest naming its id", async () => {
    render(<ReviewStep org={ACME_ID} data={data} isCreating={false} error={null} />, {
      wrapper: orgWrapper(),
    });

    const orgValue = await screen.findByText("acme");
    expect(orgValue.previousElementSibling?.textContent).toBe("Organization");
    expect(screen.getByText(/org: org_01jaaaaaaaaaaaaaaaaaaaaaaa/)).toBeTruthy();
  });

  it("shows the reference unchanged for an organization the person is not in", () => {
    render(
      <ReviewStep org="org_01jzzzzzzzzzzzzzzzzzzzzzzz" data={data} isCreating={false} error={null} />,
    );

    const orgValue = screen
      .getAllByText("org_01jzzzzzzzzzzzzzzzzzzzzzzz")
      .find((el) => el.tagName === "DD");
    expect(orgValue?.previousElementSibling?.textContent).toBe("Organization");
  });

  it("counts the plugins and previews them in the manifest", async () => {
    const withPlugins = { ...data, plugins: [{ org: ACME_ID, slug: "linear" }] };
    render(<ReviewStep org={ACME_ID} data={withPlugins} isCreating={false} error={null} />, {
      wrapper: orgWrapper(),
    });

    expect(await screen.findByText("1 added")).toBeTruthy();
    expect(screen.getByText(/slug: linear/)).toBeTruthy();
    expect(buildAgentInput(ACME_ID, withPlugins).plugins).toEqual([{ org: ACME_ID, slug: "linear" }]);
    expect(buildAgentInput(ACME_ID, data).plugins).toBeUndefined();
  });
});
