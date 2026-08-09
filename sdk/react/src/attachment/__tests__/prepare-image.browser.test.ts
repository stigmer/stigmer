import { describe, it, expect } from "vitest";
import { prepareImageForVision } from "../prepare-image.js";
import { fitToVisionResolution } from "../vision-fit.js";

/**
 * Real-Chromium half of the prepare-image coverage: decode, resize, and
 * encode against an actual rendering engine (happy-dom has no canvas 2D
 * or createImageBitmap — see prepare-image.test.ts for the guard rails).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("test environment must provide a 2D context");
  return [canvas, ctx];
}

/** Flat fills and text — the compressible content of a UI screenshot. */
function drawUiLike(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#3355aa";
  ctx.fillRect(40, 40, width / 2, 120);
  ctx.fillStyle = "#111111";
  ctx.font = "24px sans-serif";
  for (let y = 220; y < height - 40; y += 48) {
    ctx.fillText("Error: connection refused at line 42 — retry failed", 48, y);
  }
}

/** Per-pixel noise — the least-compressible content a photo can approach. */
function drawNoise(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(Math.random() * 256);
    data[i + 1] = Math.floor(Math.random() * 256);
    data[i + 2] = Math.floor(Math.random() * 256);
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

async function fileFromCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  type: string,
): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
  if (!blob) throw new Error(`canvas could not encode ${type}`);
  return new File([blob], name, { type });
}

async function imageFile(
  width: number,
  height: number,
  name: string,
  type: string,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void = drawUiLike,
): Promise<File> {
  const [canvas, ctx] = makeCanvas(width, height);
  draw(ctx, width, height);
  return fileFromCanvas(canvas, name, type);
}

async function decodedSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prepareImageForVision — real pixel pipeline", () => {
  it("resizes an oversized PNG screenshot to the fitted resolution, staying PNG", async () => {
    const input = await imageFile(3000, 2000, "screenshot.png", "image/png");
    const expected = fitToVisionResolution(3000, 2000);

    const prepared = await prepareImageForVision(input);

    expect(prepared).not.toBe(input);
    expect(prepared.type).toBe("image/png");
    expect(prepared.name).toBe("screenshot.png");
    expect(prepared.size).toBeLessThan(input.size);
    expect(prepared.lastModified).toBe(input.lastModified);
    await expect(decodedSize(prepared)).resolves.toEqual(expected);
  });

  it("passes a within-limits PNG through byte-identical (no generation loss on re-edit)", async () => {
    const input = await imageFile(400, 300, "small.png", "image/png");

    const prepared = await prepareImageForVision(input);

    expect(prepared).toBe(input);
  });

  it("passes a within-limits JPEG through byte-identical", async () => {
    const input = await imageFile(640, 480, "photo.jpg", "image/jpeg");

    const prepared = await prepareImageForVision(input);

    expect(prepared).toBe(input);
  });

  it("keeps JPEG format when resizing a JPEG source", async () => {
    const input = await imageFile(4000, 3000, "camera.jpg", "image/jpeg");
    const expected = fitToVisionResolution(4000, 3000);

    const prepared = await prepareImageForVision(input);

    expect(prepared.type).toBe("image/jpeg");
    expect(prepared.name).toBe("camera.jpg");
    await expect(decodedSize(prepared)).resolves.toEqual(expected);
  });

  it("re-encodes a within-limits WebP to PNG so the Cursor harness can display it", async () => {
    const input = await imageFile(800, 600, "clip.webp", "image/webp");

    const prepared = await prepareImageForVision(input);

    expect(prepared).not.toBe(input);
    expect(prepared.type).toBe("image/png");
    expect(prepared.name).toBe("clip.png");
    // Format normalization only — the dimensions stay untouched.
    await expect(decodedSize(prepared)).resolves.toEqual({ width: 800, height: 600 });
  });

  it("keeps worst-case photographic content under the runner's inline byte cap", async () => {
    // Evidence gate from the T05 plan. Pure noise is the least-compressible
    // content an image can carry; at the fitted resolution a noise PNG
    // encodes to ~3.4 MB — over the runner's per-image inline cap — which
    // is exactly what the PNG-density JPEG fallback exists to catch.
    // The cap constant mirrors MAX_VISION_IMAGE_BYTES in the runner's
    // shared/attachment-vision.ts (a measurement bound in a test, never a
    // production dependency).
    const RUNNER_INLINE_IMAGE_CAP = 3 * 1024 * 1024;

    const input = await imageFile(3000, 2000, "photo.png", "image/png", drawNoise);

    const prepared = await prepareImageForVision(input);

    expect(prepared.size).toBeLessThan(RUNNER_INLINE_IMAGE_CAP);
    // Noise defeats PNG, so the ratio rule must have picked JPEG.
    expect(prepared.type).toBe("image/jpeg");
    expect(prepared.name).toBe("photo.jpg");
  });

  it("prefers PNG for UI-like content even though JPEG is available", async () => {
    const input = await imageFile(3000, 2000, "dialog.png", "image/png", drawUiLike);

    const prepared = await prepareImageForVision(input);

    // Flat fills and text compress better in PNG than JPEG-at-half-size,
    // and PNG keeps UI text crisp — the ratio rule must keep PNG here.
    expect(prepared.type).toBe("image/png");
  });
});
