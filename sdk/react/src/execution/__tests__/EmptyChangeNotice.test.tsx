import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmptyChangeNotice } from "../EmptyChangeNotice";

afterEach(cleanup);

// The notice is the single owner of both empty-state messages so the approval
// gate and the post-execution detail can never drift apart in wording.
describe("EmptyChangeNotice", () => {
  it("renders the truthful 'new empty file' message for a proven-empty create", () => {
    render(<EmptyChangeNotice kind="empty-create" />);
    expect(screen.getByText("New empty file")).toBeTruthy();
  });

  it("renders the non-committal 'no preview' message when content is unavailable", () => {
    render(<EmptyChangeNotice kind="no-preview" />);
    expect(screen.getByText("No preview available for this change")).toBeTruthy();
  });
});
