// `diff`: compare local YAML against the rendered remote resource state.
//
// The unified-diff engine is a faithful port of the in-repo LCS differ
// (workflow/versions.go computeUnifiedDiff), adapted so the trailing-context
// window honors the `--context` flag. Like the Go original it emits trailing
// context only (no leading context), so hunk boundaries differ slightly from
// go-difflib — an accepted trade-off for a dependency-free, proven algorithm.
// Diff output is human-facing and not a DD-005 byte-parity target.
//
// Only workflows are diffable today (matching Go's fetchRemoteResource, which
// implements workflow and treats every other kind — and any not-found — as a
// brand-new resource).

import type { JsonValue } from "@bufbuild/protobuf";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { renderProtoYaml } from "../output/index.js";

export type DiffResult =
  | { readonly status: "new" }
  | { readonly status: "same" }
  | { readonly status: "changed"; readonly text: string };

/** Diff one document against its remote state, returning what changed. */
export async function diffDocument(
  client: Stigmer,
  kind: ApiResourceKind,
  localRaw: string,
  document: JsonValue,
  baseName: string,
  org: string,
  contextLines: number,
): Promise<DiffResult> {
  let remoteYaml: string;
  try {
    remoteYaml = await fetchRemoteYaml(client, kind, document, org);
  } catch {
    // Not deployed, or a kind we don't diff yet — Go shows both as "new".
    return { status: "new" };
  }

  if (localRaw.trim() === remoteYaml.trim()) return { status: "same" };

  const text = unifiedDiff(remoteYaml, localRaw, `remote/${baseName}`, `local/${baseName}`, contextLines);
  if (!text.includes("@@")) return { status: "same" };
  return { status: "changed", text };
}

async function fetchRemoteYaml(client: Stigmer, kind: ApiResourceKind, document: JsonValue, org: string): Promise<string> {
  if (kind !== ApiResourceKind.workflow) {
    throw new Error("diff is only implemented for workflows");
  }
  const metadata = (document as { metadata?: { slug?: string; name?: string } }).metadata ?? {};
  const slug = metadata.slug ?? metadata.name ?? "";
  if (slug === "") throw new Error("workflow has no slug or name for remote lookup");

  const remote = await client.workflow.getByReference({ org, slug });
  return renderProtoYaml(WorkflowSchema, remote);
}

// --- Unified diff engine (ported from workflow/versions.go) ---

interface DiffHunk {
  readonly startA: number;
  readonly lenA: number;
  readonly startB: number;
  readonly lenB: number;
  readonly lines: readonly string[];
}

/** Produce a unified diff of `a`→`b` with `context` trailing context lines. */
export function unifiedDiff(a: string, b: string, labelA: string, labelB: string, context: number): string {
  const linesA = a.split("\n");
  const linesB = b.split("\n");

  let out = `--- ${labelA}\n+++ ${labelB}\n`;
  for (const hunk of buildHunks(linesA, linesB, context)) {
    out += `@@ -${hunk.startA + 1},${hunk.lenA} +${hunk.startB + 1},${hunk.lenB} @@\n`;
    for (const line of hunk.lines) out += `${line}\n`;
  }
  return out;
}

function buildHunks(linesA: string[], linesB: string[], context: number): DiffHunk[] {
  const lcs = longestCommonSubsequence(linesA, linesB);
  const hunks: DiffHunk[] = [];
  let currentLines: string[] = [];
  let idxA = 0;
  let idxB = 0;
  let idxLcs = 0;
  let hunkStartA = 0;
  let hunkStartB = 0;
  let inHunk = false;

  const flushHunk = (): void => {
    if (inHunk && currentLines.length > 0) {
      hunks.push({
        startA: hunkStartA,
        lenA: countPrefix(currentLines, "-") + countPrefix(currentLines, " "),
        startB: hunkStartB,
        lenB: countPrefix(currentLines, "+") + countPrefix(currentLines, " "),
        lines: currentLines,
      });
      currentLines = [];
      inHunk = false;
    }
  };

  while (idxA < linesA.length || idxB < linesB.length) {
    const isContext =
      idxLcs < lcs.length &&
      idxA < linesA.length &&
      idxB < linesB.length &&
      linesA[idxA] === lcs[idxLcs] &&
      linesB[idxB] === lcs[idxLcs];

    if (isContext) {
      if (inHunk) currentLines.push(` ${linesA[idxA]}`);
      idxA++;
      idxB++;
      idxLcs++;
      if (inHunk && countTrailingContext(currentLines) >= context) flushHunk();
    } else {
      if (!inHunk) {
        inHunk = true;
        hunkStartA = idxA;
        hunkStartB = idxB;
        currentLines = [];
      }
      if (idxA < linesA.length && (idxLcs >= lcs.length || linesA[idxA] !== lcs[idxLcs])) {
        currentLines.push(`-${linesA[idxA]}`);
        idxA++;
      } else if (idxB < linesB.length && (idxLcs >= lcs.length || linesB[idxB] !== lcs[idxLcs])) {
        currentLines.push(`+${linesB[idxB]}`);
        idxB++;
      }
    }
  }

  flushHunk();
  return hunks;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result.reverse();
}

function countPrefix(lines: readonly string[], prefix: string): number {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function countTrailingContext(lines: readonly string[]): number {
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith(" ")) break;
    count++;
  }
  return count;
}
