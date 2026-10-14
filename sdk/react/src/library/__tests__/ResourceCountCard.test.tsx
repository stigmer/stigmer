/**
 * ResourceCountCard renders a Library kind's count: the exact count, or
 * the count with "+" when it is a lower bound (a first page with more
 * following), each named the same way to a screen reader; a link when it
 * has an href, a button when it has only an onClick, and a dash while no
 * count has arrived.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResourceCountCard } from "../ResourceCountCard";

describe("ResourceCountCard", () => {
  it("is a link naming the exact count", () => {
    render(<ResourceCountCard icon={null} label="Agents" count={1200} href="/agents" />);
    const link = screen.getByRole("link", { name: `Agents: ${(1200).toLocaleString()}` });
    expect(link.textContent).toContain((1200).toLocaleString());
  });

  it("is a button naming a lower bound, shown with a plus", () => {
    const onClick = vi.fn();
    render(<ResourceCountCard icon={null} label="Schedules" count={100} countIsLowerBound onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Schedules: more than 100" });
    expect(button.textContent).toContain("100+");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows a dash and names only its label before a count arrives", () => {
    render(<ResourceCountCard icon={null} label="Skills" href="/skills" />);
    expect(screen.getByRole("link", { name: "Skills" }).textContent).toContain("—");
  });
});
