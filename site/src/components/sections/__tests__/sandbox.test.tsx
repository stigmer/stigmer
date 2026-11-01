/**
 * The sandbox, up close: the heading and the line saying where it holds,
 * linked to the driver table; the three questions in the brand's order;
 * the docs' Environment file shown exactly; one checked line per host the
 * file allows and one for the package registries, then every other website
 * refused, with who holds the model key; the sleep steps with no clock time
 * or figure, the rule that holds a sandbox awake, and the link to the
 * measured wake in the hard parts' sandbox row; and every proof each panel
 * names, a test's words or a page.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import {
  SANDBOX_ENVIRONMENT,
  SANDBOX_HEADING,
  SANDBOX_PANEL_ORDER,
  SANDBOX_PANELS,
  SANDBOX_REACH,
  SANDBOX_SCOPE,
  SANDBOX_SLEEP,
  type SandboxPanelId,
} from "../../../../../brand/sandbox";
import { Sandbox } from "../Sandbox";

afterEach(cleanup);

const panel = (id: SandboxPanelId) =>
  within(screen.getByRole("article", { name: SANDBOX_PANELS[id].title }));

describe("Sandbox", () => {
  it("says where it holds under its heading, linking the driver table", () => {
    render(<Sandbox />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      SANDBOX_HEADING.title,
    );
    expect(screen.getByText(SANDBOX_SCOPE.sentence)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: SANDBOX_SCOPE.link.label })
        .getAttribute("href"),
    ).toBe("/docs/guides/self-hosting/runners#environments-on-your-sandboxes");
  });

  it("asks the three questions in order, each numbered", () => {
    render(<Sandbox />);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(SANDBOX_PANEL_ORDER.map((id) => SANDBOX_PANELS[id].title));
    expect(panel("inside").getByText("1 · Inside")).toBeTruthy();
    expect(panel("sleep").getByText("3 · Sleep")).toBeTruthy();
  });

  it("shows the docs' Environment file as it is written", () => {
    render(<Sandbox />);
    const file = panel("inside").getByLabelText(
      `The ${SANDBOX_ENVIRONMENT.slug} Environment`,
    );
    expect(file.textContent).toBe(SANDBOX_ENVIRONMENT.file.trimEnd());
    expect(file.textContent).toContain(
      "allowed_hosts: [api.github.com, our-api.example.com]",
    );
  });

  it("checks each host the file allows and the package registries, then refuses every other website", () => {
    render(<Sandbox />);
    const lines = panel("reach")
      .getByRole("list", { name: "What this Environment reaches" })
      .querySelectorAll("li");
    expect([...lines].map((line) => line.textContent)).toEqual([
      "✓api.github.com",
      "✓our-api.example.com",
      `✓${SANDBOX_REACH.packageManagers}`,
      `✕${SANDBOX_REACH.otherWebsites}: ${SANDBOX_REACH.refused}`,
    ]);
    expect(panel("reach").getByText(SANDBOX_REACH.key[0])).toBeTruthy();
    expect(
      panel("reach").getByText(
        /it never enters the sandbox: model calls leave through Stigmer's model proxy/,
      ),
    ).toBeTruthy();
  });

  it("tells sleep in steps with no clock time or figure, and links the measured wake", () => {
    render(<Sandbox />);
    const steps = [
      ...panel("sleep").getByRole("list").querySelectorAll("li"),
    ].map((step) => step.textContent ?? "");
    expect(steps.map((step) => step.replace(/^\d/, ""))).toEqual([
      ...SANDBOX_SLEEP.steps,
    ]);
    for (const step of SANDBOX_SLEEP.steps) expect(step).not.toMatch(/\d/);
    expect(panel("sleep").getByText(SANDBOX_SLEEP.never)).toBeTruthy();
    expect(
      panel("sleep")
        .getByRole("link", { name: "How long a wake takes" })
        .getAttribute("href"),
    ).toBe("#hard-parts-own-computer");
  });

  it("links every proof each panel names", () => {
    render(<Sandbox />);
    const github = `${SITE_CONFIG.githubUrl}/blob/main/`;
    expect(
      panel("inside")
        .getByRole("link", { name: "agent-identity.test.ts" })
        .getAttribute("href"),
    ).toBe(
      `${github}backend/services/runner/src/shared/__tests__/agent-identity.test.ts`,
    );
    expect(
      panel("inside")
        .getByRole("link", { name: "The sandbox's image" })
        .getAttribute("href"),
    ).toBe(`${github}backend/services/runner/Dockerfile.sandbox`);
    expect(
      panel("reach").getByText(
        /HTTPS to its hosts, the runner's own and the operator's/,
      ),
    ).toBeTruthy();
    expect(
      panel("reach").getByRole("link", { name: "egress.test.ts" }),
    ).toBeTruthy();
    expect(
      panel("reach").getByText(/with the runner's token in place of the key/),
    ).toBeTruthy();
    expect(
      panel("reach").getByRole("link", { name: "server.test.ts" }),
    ).toBeTruthy();
    expect(
      panel("sleep").getByText(
        /suspends an idle running sandbox, leaves a sleeping one and a busy one/,
      ),
    ).toBeTruthy();
    expect(
      panel("sleep")
        .getByRole("link", { name: "Waiting is never an agent hour" })
        .getAttribute("href"),
    ).toBe("/docs/concepts/billing#agent-hours");
  });
});
