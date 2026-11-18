/**
 * Pins that the slug field keeps what was typed while its page settles:
 *
 *   - a slug typed in the moment between the field's first paint and
 *     React's passive effects survives (the field used to copy its
 *     `currentSlug` into the draft in a mount effect, which ran after the
 *     typing and put the stored slug back, so Rename stayed disabled: the
 *     rename tests' flake under load, stigmer#3217);
 *   - a new `currentSlug` from the page (a landed rename's refetch) still
 *     resets the draft and ends the settling state.
 *
 * The first case renders outside `act` on purpose: `act` flushes passive
 * effects before returning, which hides the window. A MutationObserver
 * callback runs as a microtask right after React commits the field's DOM
 * and before the scheduler's task that flushes passive effects, so the
 * change event lands exactly where a slow page's typist does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";

import { RenameSlugField } from "../RenameSlugField.js";

type ActFlag = { IS_REACT_ACT_ENVIRONMENT?: boolean };

const noop = () => {};

function field(
  currentSlug: string,
  rename = vi.fn(async (slug: string) => slug),
  onRenamed = vi.fn(),
) {
  return (
    <RenameSlugField
      currentSlug={currentSlug}
      rename={rename}
      isRenaming={false}
      error={null}
      clearError={noop}
      onRenamed={onRenamed}
      hint="The name in links."
    />
  );
}

let root: Root | null = null;
let container: HTMLElement | null = null;
const actFlag = globalThis as ActFlag;
const previousActFlag = actFlag.IS_REACT_ACT_ENVIRONMENT;

afterEach(() => {
  if (root !== null) {
    const mounted = root;
    act(() => mounted.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  actFlag.IS_REACT_ACT_ENVIRONMENT = previousActFlag;
  cleanup();
});

describe("RenameSlugField's draft", () => {
  it("keeps a slug typed between the field's first paint and its effects", async () => {
    actFlag.IS_REACT_ACT_ENVIRONMENT = false;
    container = document.createElement("div");
    document.body.append(container);
    const host = container;

    const typed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const input = host.querySelector("input");
        if (input === null) return;
        observer.disconnect();
        // The DOM is committed; the mount's passive effects have not run.
        fireEvent.change(input, { target: { value: "renamed-slug" } });
        resolve();
      });
      observer.observe(host, { childList: true, subtree: true });
    });

    root = createRoot(host);
    root.render(field("acme-slack"));
    await typed;
    // Let every pending effect and render settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const input = host.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("renamed-slug");
    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Rename"),
    );
    expect(button?.disabled).toBe(false);
  });

  it("resets the draft and stops settling when the page shows a new slug", async () => {
    const rename = vi.fn(async (slug: string) => slug);
    const onRenamed = vi.fn();
    const { rerender } = render(field("acme-slack", rename, onRenamed));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const button = screen.getByRole("button", {
      name: "Rename",
    }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "acme-bot" } });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(rename).toHaveBeenCalledWith("acme-bot");
    expect(onRenamed).toHaveBeenCalledWith("acme-bot");
    // Settling: the page has not shown the new slug yet.
    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);

    rerender(field("acme-bot", rename, onRenamed));
    expect(input.value).toBe("acme-bot");
    expect(input.disabled).toBe(false);

    // A slug the page changes from elsewhere replaces an unsent draft.
    fireEvent.change(input, { target: { value: "half-typed" } });
    rerender(field("from-elsewhere", rename, onRenamed));
    expect(input.value).toBe("from-elsewhere");
  });
});
