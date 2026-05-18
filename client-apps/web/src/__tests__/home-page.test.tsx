import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HomePage from "../app/page";

describe("HomePage", () => {
  it("renders without crashing (placeholder route)", () => {
    const { container } = render(<HomePage />);
    expect(container.innerHTML).toBe("");
  });
});
