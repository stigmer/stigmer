import { describe, it, expect } from "vitest";
import { prepareImageForVision } from "../prepare-image.js";

/**
 * happy-dom half of the prepare-image coverage: the guard rails that make
 * the function safe to call from any environment. The actual pixel work
 * (decode, resize, encode) runs in real Chromium — see
 * prepare-image.browser.test.ts.
 */
describe("prepareImageForVision — environment guard rails", () => {
  it("returns a non-image file untouched (same instance)", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "brief.pdf", {
      type: "application/pdf",
    });

    await expect(prepareImageForVision(pdf)).resolves.toBe(pdf);
  });

  it("returns an image untouched when the canvas pipeline is unavailable", async () => {
    // happy-dom has no createImageBitmap — the exact situation of an old
    // browser or a privacy extension that blocks canvas. The paste must
    // still work end to end with the original bytes; it merely degrades
    // at the runner with the standard disclosure.
    expect(typeof createImageBitmap).toBe("undefined");

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });

    await expect(prepareImageForVision(png)).resolves.toBe(png);
  });
});
