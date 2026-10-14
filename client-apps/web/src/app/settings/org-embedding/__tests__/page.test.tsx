// ---------------------------------------------------------------------------
// The Settings → Embedding route — renders the React SDK's embedding section
//
// The page is the route's whole job: it hands Settings → Embedding to
// OrgEmbeddingSection (how the organization's product signs people in), so a
// route that drifted to another section would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react", () => ({
  OrgEmbeddingSection: () => <p>embedding section</p>,
}));

import OrgEmbeddingPage from "../page";

describe("Settings → Embedding route", () => {
  it("renders the embedding section", () => {
    render(<OrgEmbeddingPage />);
    expect(screen.getByText("embedding section")).toBeTruthy();
  });
});
