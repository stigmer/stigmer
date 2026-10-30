/**
 * What a schema chain must say before a step reaches review: the store
 * README's rules 2 and 3 ("Schema migrations"), checked by pattern over the
 * chain as data and its module's source, with no database and no base
 * branch. Each chain's sum test calls `reviewSchemaChain`, so a step that
 * breaks a rule fails the test that already holds its `migrations.sum`.
 *
 * Rule 2, every step is safe while the previous release still runs against
 * the database. A statement that drops, renames, retypes or tightens what
 * exists is refused unless its step carries a `contract`: one line saying
 * why no running server reads or writes what it changes. The reason is
 * never judged; its job is to be written and read in review. A `contract`
 * on a step where nothing is flagged is refused too, so a stale reason
 * never sits there unread. `contract` is outside the step's digest
 * (schema-checksum.ts), so a merged step can gain one.
 *
 * Statements are matched after `--` and block comments are removed and
 * quoted text is reduced to empty quotes, so a column named "drop" or a
 * literal mentioning one never matches. Dollar-quoted bodies stay in, so a
 * DROP inside a DO block is still seen. Where a pattern must choose it errs
 * wide: a needless reason costs one line, a missed one a broken roll.
 *
 * Rule 3, a rewrite never decodes through live generated code. The chain
 * module and every module it reaches by relative import may not value-import
 * `@stigmer/apis` or a `*_pb` path; an `import type` decodes nothing and
 * passes, and a relative import that does not resolve is refused, never
 * skipped. It holds for every chain whether or not a step has a rewrite yet.
 * Package imports other than `@stigmer/apis` are not followed.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The part of a schema step the review reads. */
export interface ReviewedSchemaStep {
  readonly version: number;
  readonly statements: ReadonlyArray<string>;
  readonly contract?: string | undefined;
}

/**
 * The refusals for a chain, empty when it passes. `module` is the chain
 * module's source path: it labels every refusal, and rule 3 starts there.
 */
export function reviewSchemaChain(
  module: string,
  steps: ReadonlyArray<ReviewedSchemaStep>,
): string[] {
  return [
    ...steps.flatMap((step) => reviewStep(module, step)),
    ...reviewImports(module),
  ];
}

const CONTRACT_HINT =
  "give the step a `contract` saying why the previous release no longer reads or writes what it changes (store README, \"Schema migrations\", rule 2)";

function reviewStep(module: string, step: ReviewedSchemaStep): string[] {
  const flagged = step.statements.flatMap((statement, index) =>
    statementRisks(statement).map((risk) => ({ position: index + 1, risk })),
  );
  const label = `${module}: v${step.version}`;
  if (step.contract === undefined) {
    return flagged.map(
      ({ position, risk }) =>
        `${label} statement ${position} ${risk}; ${CONTRACT_HINT}`,
    );
  }
  if (step.contract.trim() === "") {
    return [`${label} has a blank contract; ${CONTRACT_HINT}`];
  }
  if (flagged.length === 0) {
    return [
      `${label} has a contract, but no statement drops, renames, retypes or tightens what exists; remove the stale reason`,
    ];
  }
  return [];
}

/** What a statement does that the previous release's server cannot survive. */
function statementRisks(statement: string): string[] {
  const sql = stripSql(statement);
  const risks: string[] = [];
  if (/\bDROP\b/i.test(sql.replace(/\bDROP\s+NOT\s+NULL\b/gi, ""))) {
    risks.push("drops what exists");
  }
  if (/\bRENAME\b/i.test(sql)) {
    risks.push("renames what exists");
  }
  if (/\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(sql)) {
    risks.push("changes a column's type");
  }
  if (/\bSET\s+NOT\s+NULL\b/i.test(sql)) {
    risks.push("makes an existing column required");
  }
  if (/^\s*ALTER\s+TABLE\b/i.test(sql)) {
    const actions = topLevelParts(sql);
    if (
      actions.some(
        (action) =>
          /\bADD\b/i.test(action) &&
          /\bNOT\s+NULL\b/i.test(action) &&
          !/\bDEFAULT\b/i.test(action),
      )
    ) {
      risks.push("adds a required column with no default");
    }
    if (
      actions.some((action) =>
        /\bADD\s+(?:CONSTRAINT|UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i.test(
          action,
        ),
      )
    ) {
      risks.push("adds a constraint to an existing table");
    }
  }
  return risks;
}

/** A statement with comments gone and quoted text reduced to empty quotes. */
function stripSql(statement: string): string {
  return statement.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"/g,
    (token) =>
      token.startsWith("'") ? "''" : token.startsWith('"') ? '""' : " ",
  );
}

/** An ALTER TABLE's actions: the statement split at commas outside parentheses. */
function topLevelParts(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(sql.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(sql.slice(start));
  return parts;
}

const RULE_3 =
  "a schema step decodes only through descriptors frozen in the step, never live generated code (store README, \"Schema migrations\", rule 3)";

/** Rule 3 over the chain module and every module it reaches by relative import. */
function reviewImports(module: string): string[] {
  const refusals: string[] = [];
  const seen = new Set<string>();
  const pending = [path.resolve(module)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const where =
      file === path.resolve(module)
        ? module
        : `${module}, through ${path.relative(path.dirname(path.resolve(module)), file)}`;
    for (const specifier of valueImports(readFileSync(file, "utf8"))) {
      if (isGenerated(specifier)) {
        refusals.push(`${where}: imports "${specifier}"; ${RULE_3}`);
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = resolveRelative(file, specifier);
        if (target === undefined) {
          refusals.push(
            `${where}: cannot resolve "${specifier}"; every module a chain reaches is read for generated code`,
          );
        } else {
          pending.push(target);
        }
      }
    }
  }
  return refusals;
}

/** The specifiers a module imports for their values, `import type` aside. */
function valueImports(source: string): string[] {
  const code = source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g,
    (token) => (token.startsWith("/") ? " " : token),
  );
  const specifiers: string[] = [];
  for (const match of code.matchAll(
    /\b(?:import|export)\s+(type\s+)?[\w$\s,{}*]*?\bfrom\s*(["'])([^"'\n]+)\2/g,
  )) {
    if (match[1] === undefined) {
      specifiers.push(match[3] ?? "");
    }
  }
  for (const match of code.matchAll(
    /\bimport\s*(?:\(\s*)?(["'`])([^"'`\n]+)\1/g,
  )) {
    specifiers.push(match[2] ?? "");
  }
  return specifiers;
}

function isGenerated(specifier: string): boolean {
  return (
    specifier === "@stigmer/apis" ||
    specifier.startsWith("@stigmer/apis/") ||
    /_pb(?:\.[cm]?js)?$/.test(specifier)
  );
}

/** A relative specifier's source file: `.js` reads the `.ts` beside it. */
function resolveRelative(from: string, specifier: string): string | undefined {
  const target = path.resolve(path.dirname(from), specifier);
  const candidates = [
    target.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts"),
    target,
    `${target}.ts`,
  ];
  return candidates.find(
    (candidate) =>
      statSync(candidate, { throwIfNoEntry: false })?.isFile() === true,
  );
}
