/**
 * Lightweight line-based diff utility for workflow YAML.
 *
 * Implements the Myers diff algorithm on line arrays to produce a unified diff
 * without external dependencies. This keeps the SDK dependency-clean (DD-012)
 * and avoids an optional peer dependency for a small utility.
 */

/** Type of a diff line. */
export type DiffLineType = "equal" | "added" | "removed";

/** A single line in a unified diff. */
export interface DiffLine {
  readonly type: DiffLineType;
  readonly content: string;
}

/**
 * Compute a unified diff between two strings, split by newlines.
 *
 * Returns an array of {@link DiffLine} objects representing each line's status:
 * - `"equal"` — line is unchanged
 * - `"added"` — line exists only in `after`
 * - `"removed"` — line exists only in `before`
 */
export function computeUnifiedDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const edits = myersDiff(a, b);

  return edits.map(([type, line]) => ({ type, content: line }));
}

/**
 * Myers diff on two string arrays. Returns an array of [type, line] pairs
 * representing the shortest edit script from `a` to `b`.
 */
function myersDiff(
  a: string[],
  b: string[],
): Array<[DiffLineType, string]> {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  const vSize = 2 * max + 1;
  const v = new Int32Array(vSize);
  v.fill(-1);

  const trace: Int32Array[] = [];

  const idx = (k: number) => k + max;

  v[idx(1)] = 0;

  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[idx(k - 1)] < v[idx(k + 1)])) {
        x = v[idx(k + 1)];
      } else {
        x = v[idx(k - 1)] + 1;
      }

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[idx(k)] = x;

      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  return backtrack(trace, a, b, max);
}

function backtrack(
  trace: Int32Array[],
  a: string[],
  b: string[],
  max: number,
): Array<[DiffLineType, string]> {
  const idx = (k: number) => k + max;
  const result: Array<[DiffLineType, string]> = [];

  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && v[idx(k - 1)] < v[idx(k + 1)])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[idx(prevK)];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.push(["equal", a[x]]);
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        result.push(["added", b[y]]);
      } else {
        x--;
        result.push(["removed", a[x]]);
      }
    }
  }

  return result.reverse();
}
