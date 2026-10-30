// KIT-10's composer half, in a real layout engine: in a 390-pixel column on a
// desktop-wide window (a docked panel or a popup), the toolbar takes its
// narrow row ("+", Configure, the model, Send), every control stays inside
// it and none overlaps another, with the model's name long enough to need
// the room (stigmer#2709). The toolbar
// sizes to its own width, not the viewport's, so the narrow window a phone
// gives is not what is under test: the wide window with a narrow column is.

import "../../../dist/styles.css";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { ModelRegistryContext } from "../../models/ModelRegistryContext.js";
import { ComposerToolbar } from "../ComposerToolbar.js";

const CLIENT = { baseUrl: "https://example.test", getAuthCredential: async () => null } as unknown as Stigmer;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  cleanup();
});

function renderToolbar(width: number) {
  render(
    <StigmerContext.Provider value={CLIENT}>
      <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>
        <div className="stgm" data-stgm-color-mode="light" style={{ width }}>
          <div data-testid="toolbar">
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
              modelId="claude-sonnet-4.6-with-extended-thinking"
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
          </div>
        </div>
      </ModelRegistryContext.Provider>
    </StigmerContext.Provider>,
  );
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("the composer's toolbar in a narrow column", () => {
  it("KIT-10 keeps every control inside a 390-pixel column, none over another, on a wide window", async () => {
    renderToolbar(358);
    await screen.findByRole("button", { name: "Add files or a folder" });
    const toolbar = screen.getByTestId("toolbar").getBoundingClientRect();
    const controls = [...screen.getByTestId("toolbar").querySelectorAll("button")].filter(
      (button) => button.getBoundingClientRect().width > 0,
    );
    // The narrow row: "+", Configure, the model, Send.
    expect(controls.map((control) => control.getAttribute("aria-label") ?? control.textContent)).toEqual(
      expect.arrayContaining(["Add files or a folder", "Configure agent, tools, and skills", "Send message"]),
    );
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      expect(box.left, control.textContent ?? "").toBeGreaterThanOrEqual(toolbar.left - 0.5);
      expect(box.right, control.textContent ?? "").toBeLessThanOrEqual(toolbar.right + 0.5);
    }
    for (const [i, a] of controls.entries()) {
      for (const b of controls.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        expect(
          overlaps(a.getBoundingClientRect(), b.getBoundingClientRect()),
          `${a.getAttribute("aria-label") ?? a.textContent} overlaps ${b.getAttribute("aria-label") ?? b.textContent}`,
        ).toBe(false);
      }
    }
  });
});
