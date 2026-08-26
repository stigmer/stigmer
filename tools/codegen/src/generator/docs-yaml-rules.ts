// Protovalidate rule evaluation for the docs YAML gate (--rules flag).
// Port of docs_yaml_rules.go — one implementation, three modes (off /
// report / enforce), with the #305 parity boundary preserved: enforce
// evaluates only TOP-LEVEL typed decodes (what the platform itself
// evaluates); nested (discriminated-Struct recursion) findings surface in
// report mode only, flagged latent.
//
// Anchored fragments are NEVER rule-evaluated in any mode: a fragment is a
// deliberately partial instance — `required` would fail it by construction.

import type { DescMessage, Message } from "@bufbuild/protobuf";
import { pathToString } from "@bufbuild/protobuf/reflect";
import type { Validator } from "@bufbuild/protovalidate";
import { createValidator } from "@bufbuild/protovalidate";

export type DocsYamlRuleMode = "off" | "report" | "enforce";

export function parseDocsYamlRuleMode(s: string): DocsYamlRuleMode {
  if (s === "off" || s === "report" || s === "enforce") return s;
  throw new Error(`invalid --rules "${s}": expected off, report, or enforce`);
}

interface DocsYamlRuleViolation {
  path: string;
  line: number;
  blockClass: string;
  at: string;
  messageType: string;
  field: string;
  ruleId: string;
  msg: string;
  latent: boolean;
}

// Buckets a rule id into the #305 measurement families.
function ruleFamily(ruleId: string): string {
  if (ruleId === "required") return "required";
  if (ruleId.endsWith(".in") || ruleId.endsWith(".not_in") || ruleId === "enum.defined_only") {
    return "in-list";
  }
  return "other";
}

/**
 * The rule evaluator; null when --rules=off. Callers hold `DocsYamlRuleEval
 * | null` and use the exported nil-safe helpers, mirroring the Go
 * nil-receiver methods.
 */
export class DocsYamlRuleEval {
  readonly mode: DocsYamlRuleMode;
  private readonly validator: Validator;

  private path = "";
  private line = 0;
  private blockClass = "";

  private readonly violations: DocsYamlRuleViolation[] = [];

  constructor(mode: DocsYamlRuleMode) {
    this.mode = mode;
    this.validator = createValidator();
  }

  beginFence(path: string, line: number): void {
    this.path = path;
    this.line = line;
    this.blockClass = "";
  }

  setBlockClass(cls: string): void {
    this.blockClass = cls;
  }

  evaluate(schema: DescMessage, msg: Message, at: string): string[] {
    return this.run(schema, msg, at, false);
  }

  evaluateNested(schema: DescMessage, msg: Message, at: string): string[] {
    return this.run(schema, msg, at, true);
  }

  private run(schema: DescMessage, msg: Message, at: string, latent: boolean): string[] {
    if (this.blockClass === "") return [];
    if (latent && this.mode === "enforce") return [];

    let result;
    try {
      result = this.validator.validate(schema, msg);
    } catch (err) {
      return [`${at}: protovalidate could not evaluate ${schema.typeName}: ${err instanceof Error ? err.message : String(err)}`];
    }
    if (result.kind === "valid") return [];
    if (result.kind === "error") {
      return [`${at}: protovalidate could not evaluate ${schema.typeName}: ${result.error.message}`];
    }

    const problems: string[] = [];
    for (const v of result.violations) {
      const finding: DocsYamlRuleViolation = {
        path: this.path,
        line: this.line,
        blockClass: this.blockClass,
        at,
        messageType: schema.typeName,
        field: pathToString(v.field),
        ruleId: v.ruleId,
        msg: v.message,
        latent,
      };
      if (this.mode === "report") {
        this.violations.push(finding);
      } else if (this.mode === "enforce") {
        problems.push(problemString(finding));
      }
    }
    return problems;
  }

  printRuleReport(): void {
    if (this.mode !== "report") return;
    if (this.violations.length === 0) {
      process.stdout.write("✓ docs YAML rule report: protovalidate rules produced no violations\n");
      return;
    }

    const families = new Map<string, number>();
    const classes = new Map<string, number>();
    const fences = new Set<string>();
    let latent = 0;
    for (const f of this.violations) {
      families.set(ruleFamily(f.ruleId), (families.get(ruleFamily(f.ruleId)) ?? 0) + 1);
      classes.set(f.blockClass, (classes.get(f.blockClass) ?? 0) + 1);
      fences.add(`${f.path}:${f.line}`);
      if (f.latent) latent++;
    }
    process.stdout.write(
      `docs YAML rule report: ${this.violations.length} violation(s) in ${fences.size} block(s) — ` +
        `required: ${families.get("required") ?? 0}, in-list: ${families.get("in-list") ?? 0}, other: ${families.get("other") ?? 0} · ` +
        `manifests: ${classes.get("manifest") ?? 0}, task lists: ${classes.get("task list") ?? 0} · ` +
        `platform-enforced: ${this.violations.length - latent}, latent (platform-blind): ${latent}\n\n`,
    );

    const sorted = [...this.violations].sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.line - b.line;
    });

    let lastFence = "";
    for (const f of sorted) {
      const fence = `${f.path}:${f.line}`;
      if (fence !== lastFence) {
        process.stdout.write(`  ${fence} [${f.blockClass}]\n`);
        lastFence = fence;
      }
      const marker = f.latent ? " [latent — the platform never evaluates this rule]" : "";
      process.stdout.write(`    ${problemString(f)}${marker}\n`);
    }
    process.stdout.write("\nreport mode never fails the build — see stigmer/stigmer#305 for the enforcement decision\n");
  }
}

function problemString(f: DocsYamlRuleViolation): string {
  const field = f.field === "" ? "(message)" : f.field;
  return `${f.at}: ${field}: ${f.msg} (rule: ${f.ruleId})`;
}

export function newDocsYamlRuleEval(mode: DocsYamlRuleMode): DocsYamlRuleEval | null {
  if (mode === "off") return null;
  return new DocsYamlRuleEval(mode);
}
