// A link drawn as a button stays a link: an anchor by default, the host's
// own link component when it passes one, with the button's classes and its
// icon before its words.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LinkButton, type RenderLink } from "../LinkButton";
import { buttonClasses } from "../buttonClasses";

afterEach(cleanup);

describe("LinkButton", () => {
  it("is a link to its href, drawn as the button", () => {
    render(<LinkButton href="/library/agents/new">Create agent</LinkButton>);
    const el = screen.getByRole("link", { name: "Create agent" });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/library/agents/new");
    expect(el.className).toBe(buttonClasses("primary", "sm"));
  });

  it("draws through the host's link component when one is passed", () => {
    const hostLink: RenderLink = ({ href, className, children }) => (
      <a href={href} className={className} data-router="host">
        {children}
      </a>
    );
    render(
      <LinkButton href="/models" variant="outline" size="xs" renderLink={hostLink}>
        Open Models &amp; providers
      </LinkButton>,
    );
    const el = screen.getByRole("link", { name: "Open Models & providers" });
    expect(el.getAttribute("data-router")).toBe("host");
    expect(el.className).toContain("stg:h-7");
    expect(el.className).toContain("stg:border-border");
  });

  it("puts its icon before its words", () => {
    render(
      <LinkButton href="/new" icon={<svg data-testid="icon" aria-hidden="true" />}>
        Create agent
      </LinkButton>,
    );
    expect(screen.getByRole("link").firstElementChild).toBe(screen.getByTestId("icon"));
  });
});
