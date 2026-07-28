import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Still } from "../still";

// Outside a FrameworkProvider, fumadocs' ImageZoom renders its plain-<img>
// fallback with all props passed through — which is exactly the contract
// these tests pin: what <Still> hands the image layer, not how Next.js
// renders it.

const ALT = "The Agent detail page showing instructions, Skills, and tools.";

function renderStill(id = "agent-detail-tour/agent-detail") {
  return render(<Still id={id} alt={ALT} />);
}

function images(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll("img"));
}

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_SCENAR_EMBED_BASE;
});

describe("Still", () => {
  it("renders one variant per theme, resolved to the hosted stills layout", () => {
    const { container } = renderStill();
    const srcs = images(container).map((img) => img.src);
    expect(srcs).toEqual([
      "https://stigmer.ai/demos/agent-detail-tour/stills/agent-detail.light.png",
      "https://stigmer.ai/demos/agent-detail-tour/stills/agent-detail.dark.png",
    ]);
  });

  it("theme-swaps with CSS classes so the correct variant shows at first paint", () => {
    const { container } = renderStill();
    const [light, dark] = images(container);
    // The light image hides under `.dark`; the dark image shows only there.
    expect(light.className).toContain("dark:hidden");
    expect(dark.className).toContain("hidden");
    expect(dark.className).toContain("dark:block");
  });

  it("declares explicit capture dimensions and lazy loading on both variants", () => {
    const { container } = renderStill();
    for (const img of images(container)) {
      // 1280x800 canonical viewport x DPR 2 — see still.tsx.
      expect(img.getAttribute("width")).toBe("2560");
      expect(img.getAttribute("height")).toBe("1600");
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("applies the alt text to both variants", () => {
    const { container } = renderStill();
    for (const img of images(container)) {
      expect(img.getAttribute("alt")).toBe(ALT);
    }
  });

  it("honors the NEXT_PUBLIC_SCENAR_EMBED_BASE authoring-loop override", () => {
    process.env.NEXT_PUBLIC_SCENAR_EMBED_BASE = "http://localhost:4173";
    const { container } = renderStill();
    expect(images(container)[0].src).toBe(
      "http://localhost:4173/agent-detail-tour/stills/agent-detail.light.png",
    );
  });

  it.each(["agent-detail", "a/b/c", "/shot", "scenario/", ""])(
    'rejects the malformed id "%s" loudly instead of building a broken URL',
    (id) => {
      expect(() => renderStill(id)).toThrowError(/<scenario>\/<shot>/);
    },
  );
});
