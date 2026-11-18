import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("lucide-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lucide-react")>()),
  Search: () => <svg data-testid="search-icon" />,
}));

import NotFound from "../app/not-found";

describe("NotFound page", () => {
  it("says there's nothing at the address and links to the dashboard", () => {
    render(<NotFound />);

    expect(screen.getByText("There's nothing at this address")).toBeTruthy();
    expect(screen.getByText("It may have been mistyped, or the page has moved.")).toBeTruthy();

    const link = screen.getByRole("link", { name: "Go to the dashboard" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
  });
});
