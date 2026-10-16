// ---------------------------------------------------------------------------
// The console's Toaster — the React SDK's themed toaster under the old name
//
// The console's own Sonner wrapper gave way to the SDK's StigmerToaster;
// this module keeps the `Toaster` name its imports use. Pins that the name
// is the SDK's component itself, not a second wrapper that could drift
// from it, and that it renders with the props it is given.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const sdk = vi.hoisted(() => ({
  StigmerToaster: ({ position }: { position?: string }) => (
    <p data-testid="stigmer-toaster">toaster at {position}</p>
  ),
}));
vi.mock("@stigmer/react-sdk", () => ({ StigmerToaster: sdk.StigmerToaster }));

import { Toaster } from "../sonner";

describe("Toaster", () => {
  it("is the SDK's StigmerToaster", () => {
    expect(Toaster).toBe(sdk.StigmerToaster);
  });

  it("renders the SDK's toaster with the props it is given", () => {
    render(<Toaster position="bottom-right" />);
    expect(screen.getByTestId("stigmer-toaster").textContent).toBe("toaster at bottom-right");
  });
});
