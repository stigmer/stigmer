/**
 * Cursor targets on controls a real `@stigmer/react` component renders
 * without one. Scenar's cursor, scroll and camera find their element by
 * `data-cursor-target`, and the SDK ships that hook only on the controls an
 * earlier guided tour needed; the plugin page's "Sign in", "Check tools"
 * and "Start a chat" carry none. This wrapper names them from outside, by
 * the accessible name a person reads, instead of a tour reaching into the
 * component or a replica standing in for it.
 *
 * It writes one attribute and nothing else: no event is dispatched, no
 * state is touched, so a beat stays a pure function of its step data. The
 * page under it fills in when its mocked reads resolve, so the tagging
 * re-runs on every change below the wrapper (a `MutationObserver`) and is
 * settled long before any interaction's `atPercent` fires. The first
 * element a name matches wins, in document order, so a target is stable
 * across replays.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** One control to name: its accessible name (an `aria-label`, else its text) and the target to give it. */
export interface CursorTargetSpec {
  readonly name: string;
  readonly target: string;
}

interface CursorTargetsProps {
  readonly targets: readonly CursorTargetSpec[];
  readonly children: ReactNode;
}

/** The accessible name a button is read by: its `aria-label`, else its text. */
function accessibleName(element: Element): string {
  return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
}

function tag(root: HTMLElement, targets: readonly CursorTargetSpec[]): void {
  const buttons = Array.from(root.querySelectorAll("button, a"));
  for (const { name, target } of targets) {
    const match = buttons.find((element) => accessibleName(element) === name);
    if (match && match.getAttribute("data-cursor-target") !== target) {
      match.setAttribute("data-cursor-target", target);
    }
  }
}

/** Wraps a depicted surface and gives the named controls inside it their cursor targets. */
export function CursorTargets({ targets, children }: CursorTargetsProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    tag(root, targets);
    // Attribute writes are not observed (only the subtree's shape), so
    // tagging never re-triggers itself.
    const observer = new MutationObserver(() => tag(root, targets));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [targets]);

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
