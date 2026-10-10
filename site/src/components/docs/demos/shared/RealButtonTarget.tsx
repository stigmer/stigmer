"use client";

/**
 * Points a demo's cursor at, and optionally presses, a button a real
 * `@stigmer/react` component renders: the plugin page's "Check tools" and
 * "Sign in" carry no `data-cursor-target` of their own, and the state they
 * lead to (a server's tools, a sign-in in flight) lives in the component's
 * hooks, so no prop can paint it.
 *
 * The wrapper watches its subtree (the page fills in once its fixtures
 * answer), tags the first button whose accessible name matches with the
 * cursor target, and, when `press` is set, clicks it once: the real hook
 * then calls the real RPC, which the scenario's fixtures answer. A scenario
 * remounts the wrapper (a `key` per beat) to press again, so scrubbing back
 * and forth replays the same click and lands on the same state.
 */

import { useEffect, useRef, type ReactNode } from "react";

interface RealButtonTargetProps {
  /** The button's accessible name: its `aria-label`, else its text. */
  readonly label: string;
  /** The `data-cursor-target` value the button gets. */
  readonly target: string;
  /** Click the button once, as soon as it renders. */
  readonly press?: boolean;
  readonly children: ReactNode;
}

/** The accessible name a reader of the page would use for a button. */
function nameOf(button: HTMLButtonElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

export function RealButtonTarget({ label, target, press = false, children }: RealButtonTargetProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    let pressed = false;
    const tag = (): void => {
      const button = Array.from(root.querySelectorAll("button")).find((b) => nameOf(b) === label);
      if (button === undefined) return;
      if (button.getAttribute("data-cursor-target") !== target) button.setAttribute("data-cursor-target", target);
      if (press && !pressed && !button.disabled) {
        pressed = true;
        button.click();
      }
    };
    tag();
    const observer = new MutationObserver(tag);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [label, target, press]);

  return <div ref={rootRef}>{children}</div>;
}
