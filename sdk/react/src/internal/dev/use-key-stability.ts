import { useRef } from "react";

const DEV = process.env.NODE_ENV !== "production";

/** Minimal shape expected from a keyed thread item. */
interface KeyedItem {
  readonly key: string;
  readonly kind: string;
}

/**
 * Dev-only hook that detects key instability in a list of keyed items.
 *
 * Compares the current render's key set against the previous render's
 * and warns when:
 *
 * - A key disappears and a new key appears at the same list index
 *   (suggests a remount caused by key change, not a logical add/remove).
 * - The total number of key replacements in a single render exceeds a
 *   threshold, indicating widespread instability.
 *
 * In production builds the entire function body is dead-code-eliminated.
 */
export function useKeyStability(items: readonly KeyedItem[]): void {
  const prevRef = useRef<readonly KeyedItem[] | null>(null);

  if (!DEV) return;

  const prev = prevRef.current;
  prevRef.current = items;

  if (!prev || prev.length === 0) return;

  const prevKeys = new Map<string, number>();
  for (let i = 0; i < prev.length; i++) {
    prevKeys.set(prev[i].key, i);
  }

  const curKeys = new Set<string>();
  for (const item of items) {
    curKeys.add(item.key);
  }

  const removed: string[] = [];
  for (const key of prevKeys.keys()) {
    if (!curKeys.has(key)) removed.push(key);
  }

  if (removed.length === 0) return;

  let swapCount = 0;

  for (const removedKey of removed) {
    const idx = prevKeys.get(removedKey)!;
    if (idx < items.length) {
      const replacement = items[idx];
      if (!prevKeys.has(replacement.key)) {
        swapCount++;
        console.warn(
          `[stgm:perf:keys] Key swap at index ${idx}: ` +
            `"${removedKey}" (${prev[idx].kind}) → "${replacement.key}" (${replacement.kind}). ` +
            "This causes React to unmount/remount the row.",
        );
      }
    }
  }

  if (swapCount > 3) {
    console.warn(
      `[stgm:perf:keys] ${swapCount} key swaps detected in a single render. ` +
        "Thread items may be using unstable keys.",
    );
  }
}
