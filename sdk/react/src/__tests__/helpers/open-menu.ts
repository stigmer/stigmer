import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Open a Base UI floating-trigger popup (action menu, dropdown) the way a
 * real pointer does, and fail with the exact stage that died.
 *
 * WHY THIS EXISTS (oss#483): Base UI commits a trigger's interactive props
 * (open handlers, `aria-expanded`) one store-notification cycle AFTER the
 * button first appears in the DOM. A test that clicks immediately after
 * render can hit that window — the click lands on a not-yet-wired button
 * and the open is never attempted. Invisible at human speed, the window
 * widens under CI load into intermittent "menu never opened" timeouts
 * (~5% per attempt under CPU starvation; mechanism pinned by probing
 * `aria-expanded` synchronously after the click: `null`, with the menu
 * root's `onOpenChange` never firing). The readiness stage below closes
 * the race by construction; the pointer-fidelity click keeps the test on
 * the open path real users exercise.
 *
 * Failure semantics: each stage throws a named error, so a CI log
 * pinpoints WHICH link broke (trigger never wired / open never happened /
 * items never rendered) instead of an opaque 8s query timeout. There are
 * deliberately NO retries: a helper that re-clicks would mask genuine
 * open-path regressions in the SDK.
 *
 * Caveat: `userEvent` deadlocks under `vi.useFakeTimers()` unless
 * configured with `advanceTimers` — don't call this helper from
 * fake-timer tests (none of the menu suites use them today).
 *
 * Not a `.test` file and inside `__tests__` deliberately: vitest does not
 * collect it, and the build/typedoc excludes keep it out of the published
 * package.
 */
export async function openMenu(trigger: HTMLElement): Promise<void> {
  await openFloatingTrigger(trigger, "menuitem");
}

/**
 * Trigger-generic core: Base UI selects/comboboxes share the same wiring
 * lifecycle and the same latent race (their popup items are `option`
 * instead of `menuitem`). Widen to an exported `openSelect` if that family
 * ever needs it — do not fork the stages.
 */
async function openFloatingTrigger(
  trigger: HTMLElement,
  itemRole: "menuitem" | "option",
): Promise<void> {
  // Stage 1 — trigger wiring. `aria-expanded` arrives in the same props
  // merge as the open handlers, so its presence is the observable signal
  // that the button is actually clickable-as-a-trigger.
  await waitFor(() => {
    if (!trigger.hasAttribute("aria-expanded")) {
      throw new Error(
        `openMenu stage "trigger-wiring": trigger is rendered but Base UI ` +
          `has not attached its interactive props yet (no aria-expanded). ` +
          `Trigger: ${describeTrigger(trigger)}`,
      );
    }
  });

  // Stage 2 — the click, with full pointer + focus fidelity (pointerdown,
  // mousedown, focus, pointerup, mouseup, click) so the primary
  // mousedown-open path is exercised, not the bare-click fallback.
  await userEvent.click(trigger);

  // Stage 3 — the open must register on the trigger itself.
  await waitFor(() => {
    if (trigger.getAttribute("aria-expanded") !== "true") {
      throw new Error(
        `openMenu stage "open": the click was dispatched but the trigger ` +
          `never reported open (aria-expanded=` +
          `${JSON.stringify(trigger.getAttribute("aria-expanded"))}). ` +
          `Trigger: ${describeTrigger(trigger)}`,
      );
    }
  });

  // Stage 4 — items must be queryable. findAllByRole (not waitFor) so a
  // timeout here still produces testing-library's DOM dump.
  await screen.findAllByRole(itemRole);
}

function describeTrigger(trigger: HTMLElement): string {
  const label = trigger.getAttribute("aria-label") ?? trigger.textContent;
  return `<${trigger.tagName.toLowerCase()} aria-label=${JSON.stringify(
    label,
  )} connected=${trigger.isConnected}>`;
}
