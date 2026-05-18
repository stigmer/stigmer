import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("lucide-react", () => ({
  FileQuestion: () => <svg data-testid="file-question-icon" />,
}));

import NotFound from "../app/not-found";

describe("NotFound page", () => {
  it("renders 404 message and dashboard link", () => {
    render(<NotFound />);

    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByText(/doesn't exist/)).toBeTruthy();

    const link = screen.getByRole("link", { name: "Go to Dashboard" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
  });
});
