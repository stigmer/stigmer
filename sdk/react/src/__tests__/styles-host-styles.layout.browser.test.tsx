// The kit draws the same under the stylesheets real host apps ship with
// (stigmer/stigmer#3491). A host's own CSS is mostly unlayered, and unlayered
// CSS beats every layered rule whatever its selector, so while the kit's
// utilities sat in a cascade layer a stock `create-next-app` page
// (`* { padding: 0 }`) took every padding out of the chat, Tailwind 3's
// preflight (`button { padding: 0 }`, `* { border-width: 0 }`) stripped its
// buttons, and an app made from `create-vite` before 9.0 (`button { … }`)
// dressed every kit button as its own. The app `create-vite` makes today
// centers everything under `#root`, and the kit's text took that alignment.
//
// Each host stylesheet here is the one its tool writes, vendored with its
// version under test/fixtures/host-styles. The real composer toolbar and the
// kit's buttons and form controls are mounted under each, in the `#root`
// element both app templates render into, and every element's box (padding,
// margin, border, radius, background, font size, text alignment) must equal
// the bare page's. The window is 1000px wide, where create-vite 9's root font
// is the browser's 16px, so rem-sized parts compare as they are.

/// <reference types="vite/client" />
import "../../dist/styles.css";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import createNextApp from "../../../../test/fixtures/host-styles/create-next-app.css?raw";
import createVite8 from "../../../../test/fixtures/host-styles/create-vite-8.3.0.css?raw";
import createVite9 from "../../../../test/fixtures/host-styles/create-vite-9.4.0.css?raw";
import tailwind3Preflight from "../../../../test/fixtures/host-styles/tailwindcss-3.4.19-preflight.css?raw";
import tailwind4Preflight from "../../../../test/fixtures/host-styles/tailwindcss-4.2.1-preflight.css?raw";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { ComposerToolbar } from "../composer/ComposerToolbar.js";
import { TextArea, TextInput } from "../internal/form/controls.js";
import { ModelRegistryContext } from "../models/ModelRegistryContext.js";

const CLIENT = { baseUrl: "https://example.test", getAuthCredential: async () => null } as unknown as Stigmer;

/** Each host stylesheet as its page carries it. Tailwind 4 emits its preflight into `@layer base`. */
const HOSTS: Readonly<Record<string, string>> = {
  "stock create-next-app": createNextApp,
  "create-vite 9.4.0 (react-ts)": createVite9,
  "create-vite 8.3.0 (react-ts), an app made before 9.0": createVite8,
  "Tailwind 3.4.19's preflight": tailwind3Preflight,
  "Tailwind 4.2.1's preflight": `@layer theme, base, components, utilities;\n@layer base {\n${tailwind4Preflight}\n}`,
};

/** The properties of an element's own box the kit draws. */
const PROPERTIES = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-left-radius",
  "background-color",
  "font-size",
  "font-weight",
  "text-align",
] as const;

let hostStyle: HTMLStyleElement | null = null;

beforeAll(async () => {
  await page.viewport(1000, 800);
});

afterEach(() => {
  cleanup();
  hostStyle?.remove();
  hostStyle = null;
  document.getElementById("root")?.remove();
});

/** The kit's parts, mounted in the `#root` element both app templates render into. */
function renderKit() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(
    <StigmerContext.Provider value={CLIENT}>
      <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
        <div className="stgm" data-stgm-color-mode="light" style={{ width: 640 }}>
          <div data-testid="kit">
            <ComposerToolbar
              disabled={false}
              isSubmitting={false}
              canSend
              onSend={() => {}}
              showHarnessSelector={false}
              onHarnessChange={() => {}}
              showInteractionModePicker
              interactionMode="agent"
              onInteractionModeChange={() => {}}
              showModelSelector
              modelId="claude-sonnet-4.6"
              onModelChange={() => {}}
              showWorkspace
              workspaceCount={0}
              workspaceContent={null}
              showAttach
              fileCount={0}
              onAttachClick={() => {}}
              configureItems={[{ id: "skills", label: "Skills", icon: null, count: 1 }]}
              configOpen={false}
              onConfigOpenChange={() => {}}
              configActivePanel={null}
              onConfigActivePanelChange={() => {}}
              renderConfigPanel={() => null}
            />
            <Button variant="primary">Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <IconButton label="Close" icon={<span>x</span>} />
            <TextInput aria-label="Name" defaultValue="name" />
            <TextArea aria-label="Notes" defaultValue="notes" />
          </div>
        </div>
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>,
    { container: root },
  );
}

/** Every element of the kit's subtree, by its path, with the box it is drawn with. */
function boxes(): Record<string, Record<string, string>> {
  const kit = screen.getByTestId("kit");
  const out: Record<string, Record<string, string>> = {};
  for (const [index, element] of [...kit.querySelectorAll("*")].entries()) {
    const style = getComputedStyle(element);
    const box: Record<string, string> = {};
    for (const property of PROPERTIES) box[property] = style.getPropertyValue(property);
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 20) ?? "";
    out[`${index} ${element.tagName.toLowerCase()} ${name}`] = box;
  }
  return out;
}

describe("the kit under the stylesheets host apps ship with", () => {
  it.each(Object.entries(HOSTS))("draws every part as on a bare page, under %s", async (_host, css) => {
    renderKit();
    await screen.findByRole("button", { name: "Send message" });
    const bare = boxes();
    cleanup();
    document.getElementById("root")?.remove();

    hostStyle = document.createElement("style");
    hostStyle.textContent = css;
    document.head.appendChild(hostStyle);
    renderKit();
    await screen.findByRole("button", { name: "Send message" });
    expect(boxes()).toEqual(bare);
  });
});

/** A host's own utilities, as Tailwind 4 emits them (layered) and as Tailwind 3 does (unlayered). */
const HOST_UTILITIES = ".px-4 { padding-left: 16px; padding-right: 16px; } .bg-blue { background-color: rgb(59, 130, 246); }";
const HOST_TAILWIND: Readonly<Record<string, string>> = {
  "Tailwind 4": `@layer theme, base, components, utilities;\n@layer base {\n${tailwind4Preflight}\n}\n@layer utilities { ${HOST_UTILITIES} }`,
  "Tailwind 3": `${tailwind3Preflight}\n${HOST_UTILITIES}`,
};

describe("the host's own styling inside the provider stays the host's", () => {
  // The kit's rules leave their layer, and an unlayered rule beats every
  // layered one, so these hold that nothing the kit ships touches what the
  // host draws: its own controls under `.stgm` (the documented quickstart
  // wraps the whole app in the provider), and the classes it passes to a
  // kit control through `className`.
  // prefix-classnames-ignore: host-authored markup, unprefixed on purpose.
  function renderHostParts(css: string) {
    hostStyle = document.createElement("style");
    hostStyle.textContent = css;
    document.head.appendChild(hostStyle);
    render(
      <div className="stgm" data-stgm-color-mode="light">
        <button type="button" data-testid="own" className="px-4 bg-blue">
          own
        </button>
        <button type="button" data-testid="plain">
          plain
        </button>
        <Button variant="ghost" className="px-4 bg-blue">
          restyled
        </Button>
      </div>,
    );
  }

  function drawn(element: Element): string {
    const style = getComputedStyle(element);
    return `${style.paddingLeft} ${style.backgroundColor}`;
  }

  it.each(Object.entries(HOST_TAILWIND))("keeps a %s host's own button and its className on a kit button", (_host, css) => {
    renderHostParts(css);
    expect(drawn(screen.getByTestId("own"))).toBe("16px rgb(59, 130, 246)");
    expect(drawn(screen.getByRole("button", { name: "restyled" }))).toBe("16px rgb(59, 130, 246)");
  });

  it("keeps a host's bare `button {}` rule on the host's own buttons (create-vite 8.3.0)", () => {
    renderHostParts(createVite8);
    expect(drawn(screen.getByTestId("plain"))).toBe("19.2px rgb(249, 249, 249)");
  });
});
