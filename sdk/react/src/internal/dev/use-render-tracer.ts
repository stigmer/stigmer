import { useRef } from "react";
import { isPerfLoggingEnabled } from "./enabled.js";

/**
 * Sampling interval: log every Nth render to avoid flooding the
 * console during high-frequency streaming (10-15 ticks/s).
 */
const LOG_EVERY = 10;

/**
 * Dev-only hook that tracks render count and reports which props
 * changed (by shallow referential equality) since the last render.
 *
 * Off by default in every environment (and always in production) — enable via
 * {@link isPerfLoggingEnabled}'s opt-in flags.
 *
 * @param componentName - Stable label for console output.
 * @param props - Key/value map of props to track. Pass only the props
 *   you care about — typically the ones that drive re-renders.
 */
export function useRenderTracer(
  componentName: string,
  props: Record<string, unknown>,
): void {
  const countRef = useRef(0);
  const prevRef = useRef<Record<string, unknown> | null>(null);

  if (!isPerfLoggingEnabled()) return;

  countRef.current += 1;
  const count = countRef.current;
  const prev = prevRef.current;

  if (count % LOG_EVERY === 0 || count === 1) {
    const changed: string[] = [];
    if (prev) {
      for (const key of Object.keys(props)) {
        if (!Object.is(props[key], prev[key])) {
          changed.push(key);
        }
      }
    }

    const parts = [
      `[stgm:perf:render] ${componentName}`,
      `render=#${count}`,
    ];

    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "string") {
        parts.push(`${key}=${value.length > 40 ? value.slice(0, 40) + "…" : value}`);
      } else if (typeof value === "number" || typeof value === "boolean") {
        parts.push(`${key}=${String(value)}`);
      }
    }

    if (prev) {
      parts.push(
        changed.length > 0
          ? `changed=[${changed.join(",")}]`
          : "changed=[]",
      );
    }

    console.debug(parts.join("  "));
  }

  prevRef.current = { ...props };
}
