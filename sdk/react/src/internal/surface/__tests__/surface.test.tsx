/**
 * Pins the console's card and list: one card look (its corner, its fill,
 * the chosen and placeholder forms, the flush form a list sits in), and a
 * list whose rows carry their name, second line, leading and trailing
 * slots, open with their expanded content, and, when a row goes somewhere
 * or does something, carry the link or button on the name with the row's
 * own buttons beside it, never inside it, so every one is reached by Tab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card, cardClasses } from "../Card";
import { List, ListRow } from "../List";

afterEach(cleanup);

describe("Card", () => {
  it("draws the kit's card: the 10px corner, the border, the card fill and 16px inside", () => {
    render(<Card data-testid="c">Plan</Card>);
    const card = screen.getByTestId("c");
    for (const cls of ["stg:rounded-xl", "stg:border", "stg:border-border", "stg:bg-card", "stg:p-4"]) {
      expect(card.className).toContain(cls);
    }
  });

  it("draws the chosen card with the foreground border, and a card that adds a thing dashed on the page", () => {
    expect(cardClasses({ selected: true })).toContain("stg:border-foreground");
    expect(cardClasses({ selected: true })).not.toContain("stg:border-border ");
    const placeholder = cardClasses({ placeholder: true });
    expect(placeholder).toContain("stg:border-dashed");
    expect(placeholder).toContain("stg:bg-transparent");
    expect(placeholder).not.toContain("stg:bg-card");
  });

  it("gives an interactive card the hover border and the focus ring, and a flush card no padding", () => {
    expect(cardClasses({ interactive: true })).toContain("stg:hover:border-border-prominent");
    expect(cardClasses({ interactive: true })).toContain("stg:focus-visible:ring-2");
    expect(cardClasses({ flush: true })).not.toContain("stg:p-4");
    expect(cardClasses({ flush: true })).toContain("stg:overflow-hidden");
  });
});

describe("List and ListRow", () => {
  it("draws a named list of rows with a name, a second line, and leading and trailing slots", () => {
    render(
      <List aria-label="Vaults">
        <ListRow name="Production" description="8 secrets" leading={<span data-testid="icon" />} trailing={<span>Shared</span>} />
        <ListRow name="Staging" />
      </List>,
    );
    const list = screen.getByRole("list", { name: "Vaults" });
    expect(list.className).toContain("stg:divide-y");
    expect(list.className).toContain("stg:rounded-xl");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("8 secrets")).toBeTruthy();
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByText("Shared")).toBeTruthy();
  });

  it("draws a bare list with no card around it, for a list already inside one", () => {
    render(
      <List aria-label="Keys" bare>
        <ListRow name="ci" />
      </List>,
    );
    expect(screen.getByRole("list", { name: "Keys" }).className).not.toContain("stg:rounded-xl");
  });

  it("puts a row's link on its name through the host's renderer, with the row's own buttons beside it", async () => {
    const renderLink = vi.fn(({ href, className, children }) => (
      <a href={href} className={className} data-host="router">
        {children}
      </a>
    ));
    render(
      <List aria-label="Agents">
        <ListRow name="Triage" href="/library/agents/triage" renderLink={renderLink} trailing={<button type="button">Delete</button>} />
      </List>,
    );
    const link = screen.getByRole("link", { name: "Triage" });
    expect(link.getAttribute("href")).toBe("/library/agents/triage");
    expect(link.getAttribute("data-host")).toBe("router");
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(link.contains(remove)).toBe(false);
    expect(remove.closest("a")).toBeNull();

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(link);
    await user.tab();
    expect(document.activeElement).toBe(remove);
  });

  it("puts a row's act on its name as a button that says whether the row is open, and shows the open row's content", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <List aria-label="Vaults">
        <ListRow name="Production" onClick={onClick} aria-expanded={false} expanded={<p>Secrets</p>} />
      </List>,
    );
    const toggle = screen.getByRole("button", { name: "Production" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Secrets")).toBeNull();
    await userEvent.setup().click(toggle);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <List aria-label="Vaults">
        <ListRow name="Production" onClick={onClick} aria-expanded open expanded={<p>Secrets</p>} />
      </List>,
    );
    expect(screen.getByRole("button", { name: "Production" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Secrets")).toBeTruthy();
    expect(screen.getByRole("listitem").className).toContain("stg:bg-muted-faint");
  });

  it("draws a row that goes nowhere with no link and no button", () => {
    render(
      <List aria-label="Members">
        <ListRow name="Ada" />
      </List>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
