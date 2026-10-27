// The accessibility policy the browser suites share: which axe rules run,
// which violations fail, and how a violation reads in a failure.
// Domain: test support (shared assertions).
//
// axe-core runs the WCAG 2.0 A and AA rules. A critical or serious
// violation fails, contrast included; a moderate or minor one is reported
// and passes. The console's page audit (test/e2e) and the kit's gallery
// (test/visual) both judge with it, each through its own driver
// (`@axe-core/playwright`), so the two cannot drift into two policies.
//
// A suite that audits today's screens with violations nobody has fixed yet
// lists them per screen, each rule against the open issue that tracks it
// (`judgeAxe`'s `known`): a listed rule that still fails is reported and
// passes, a listed rule that no longer fails fails as stale, so the list
// only shrinks and the fix's pull request is where its line comes off.
//
// The violation shape is declared here, the few fields read, rather than
// imported from axe-core: this tree imports only `node:*` (README.md, "The
// rule"), and axe's own results satisfy it.

/** The axe rule tags every audit runs. */
export const AXE_TAGS: readonly string[] = ["wcag2a", "wcag2aa"];

/** The impacts that fail an audit. */
export const BLOCKING_IMPACTS: readonly string[] = ["critical", "serious"];

/** One element a violation was found on. */
export interface AxeNode {
  /** The element's selector path, frame by frame. */
  readonly target: readonly unknown[];
  readonly html: string;
}

/** One axe rule that failed, on the elements it failed on. */
export interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly nodes: readonly AxeNode[];
}

/** A rule a screen is known to fail today, and the open issue that tracks it (`stigmer#N`). */
export interface KnownViolation {
  readonly rule: string;
  readonly issue: string;
}

/** What an audit found, judged. */
export interface AxeJudgement {
  /** Blocking violations no listed rule explains: the audit fails on these. */
  readonly failing: readonly AxeViolation[];
  /** Blocking violations a listed rule explains: reported, not failing. */
  readonly known: readonly AxeViolation[];
  /** Listed rules that no longer fail: the audit fails until their lines come off. */
  readonly stale: readonly KnownViolation[];
  /** Moderate and minor violations: reported, never failing. */
  readonly advisory: readonly AxeViolation[];
}

/** Whether a violation fails an audit by its impact. */
export function isBlocking(violation: AxeViolation): boolean {
  return BLOCKING_IMPACTS.includes(violation.impact ?? "");
}

/** Judges an audit's violations against the rules a screen is known to fail. Pure. */
export function judgeAxe(violations: readonly AxeViolation[], known: readonly KnownViolation[] = []): AxeJudgement {
  const listed = new Set(known.map((k) => k.rule));
  const blocking = violations.filter(isBlocking);
  const seen = new Set(blocking.map((v) => v.id));
  return {
    failing: blocking.filter((v) => !listed.has(v.id)),
    known: blocking.filter((v) => listed.has(v.id)),
    stale: known.filter((k) => !seen.has(k.rule)),
    advisory: violations.filter((v) => !isBlocking(v)),
  };
}

/** The violations as a failure message reads them: impact, rule, help, and the first `maxNodes` elements. Pure. */
export function describeViolations(violations: readonly AxeViolation[], maxNodes = 5): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, maxNodes)
        .map((n) => `    · ${n.target.map(String).join(" ")}\n      ${n.html.slice(0, 160)}`)
        .join("\n");
      const more = v.nodes.length > maxNodes ? `\n    … and ${v.nodes.length - maxNodes} more` : "";
      return `  [${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n${nodes}${more}`;
    })
    .join("\n");
}

/** The judgement as one report: what fails, then what is known and advisory. Empty when there is nothing to say. Pure. */
export function describeJudgement(judgement: AxeJudgement): string {
  const parts: string[] = [];
  if (judgement.failing.length > 0) parts.push(`failing:\n${describeViolations(judgement.failing)}`);
  if (judgement.stale.length > 0) {
    parts.push(`no longer failing, so remove the listed rule:\n${judgement.stale.map((k) => `  ${k.rule} (${k.issue})`).join("\n")}`);
  }
  if (judgement.known.length > 0) parts.push(`known, tracked by an open issue:\n${describeViolations(judgement.known, 1)}`);
  if (judgement.advisory.length > 0) parts.push(`advisory (moderate or minor):\n${describeViolations(judgement.advisory, 1)}`);
  return parts.join("\n");
}
