import { type RefObject, useEffect, useRef } from "react";
import { isPerfLoggingEnabled } from "./enabled.js";

/** Log the node count every Nth trigger. */
const LOG_EVERY = 10;

/**
 * Dev-only hook that periodically counts DOM nodes under a container
 * element and logs the result.
 *
 * Measurement runs inside `requestIdleCallback` (with a `setTimeout`
 * fallback for environments that don't support it) so it never blocks
 * rendering or scroll.
 *
 * @param containerRef - Ref to the DOM element whose subtree to count.
 * @param label - Identifier for the console output.
 */
export function useDomNodeCount(
  containerRef: RefObject<HTMLElement | null>,
  label: string,
): void {
  const triggerCountRef = useRef(0);

  useEffect(() => {
    if (!isPerfLoggingEnabled()) return;

    triggerCountRef.current += 1;
    if (triggerCountRef.current % LOG_EVERY !== 0) return;

    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const count = el.querySelectorAll("*").length;
      console.debug(`[stgm:perf:dom] ${label}  nodes=${count}`);
    };

    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(measure);
      return () => cancelIdleCallback(handle);
    }

    const handle = setTimeout(measure, 0);
    return () => clearTimeout(handle);
  });
}
