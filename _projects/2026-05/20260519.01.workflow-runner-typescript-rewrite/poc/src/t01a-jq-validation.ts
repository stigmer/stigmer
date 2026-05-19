/**
 * T01a: jq Expression Validation Spike
 *
 * Validates that TypeScript can evaluate the same jq expressions that the Go
 * workflow-runner evaluates via gojq, using two candidate libraries:
 *
 * 1. node-jq  — subprocess to system jq binary
 * 2. jq-wasm  — WebAssembly-based, in-process (like gojq in Go)
 *
 * Tests both "runtime expression" path (with $context/$data variables) and
 * "transform" path (raw input document, no variables).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "jq-expressions.json"), "utf-8"),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  expression: string;
  input: unknown;
  variables?: Record<string, unknown>;
  expected: unknown;
  source?: string;
}

interface TestResult {
  id: string;
  expression: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  latencyMs: number;
  error?: string;
}

interface LibraryReport {
  library: string;
  version: string;
  runtimeResults: TestResult[];
  transformResults: TestResult[];
  customVariableSupport: boolean;
  customFunctionSupport: boolean;
  avgLatencyMs: number;
  passRate: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// jq-wasm adapter
// ---------------------------------------------------------------------------

async function loadJqWasm(): Promise<{
  run: (expr: string, input: unknown) => Promise<unknown>;
  version: string;
}> {
  const jq = await import("jq-wasm");
  return {
    version: "jq-wasm@1.1.0-jq-1.8.1",
    run: async (expr: string, input: unknown): Promise<unknown> => {
      const result = await jq.json(input, expr);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// node-jq adapter
// ---------------------------------------------------------------------------

async function loadNodeJq(): Promise<{
  run: (expr: string, input: unknown) => Promise<unknown>;
  version: string;
}> {
  const { run: nodeJqRun } = await import("node-jq");
  return {
    version: "node-jq@6.x (subprocess)",
    run: async (expr: string, input: unknown): Promise<unknown> => {
      const inputStr = JSON.stringify(input ?? null);
      const result = await nodeJqRun(expr, inputStr, { input: "string", output: "json" });
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Variable injection: gojq uses named variables ($context, $data, etc.)
// jq CLI supports --argjson for variable binding.
// jq-wasm doesn't support --argjson, so we construct a wrapper expression.
// ---------------------------------------------------------------------------

/**
 * Wraps a jq expression with variable definitions so that $context, $data, etc.
 * are available as named variables. This mirrors what gojq.WithVariables does.
 *
 * Strategy: pipe the input through a jq assignment that defines each variable,
 * then evaluate the original expression.
 *
 * Example: for expression "$context.userId > 5" with $context = {...}:
 *   . as $root | {"userId":7} as $context | $context.userId > 5
 */
function wrapWithVariables(
  expr: string,
  variables: Record<string, unknown>,
  input: unknown,
): { wrappedExpr: string; wrappedInput: unknown } {
  const varNames = Object.keys(variables);
  if (varNames.length === 0) {
    return { wrappedExpr: expr, wrappedInput: input };
  }

  // Build a combined input object that includes the variables
  const combinedInput: Record<string, unknown> = {
    __input__: input,
    __vars__: variables,
  };

  // Build variable definitions: .__vars__["$context"] as $context | ...
  const varDefs = varNames
    .map((name) => {
      const safeName = name.startsWith("$") ? name : `$${name}`;
      return `.__vars__["${name}"] as ${safeName}`;
    })
    .join(" | ");

  // The final expression: get input, define vars, run original expression
  const wrappedExpr = `.__input__ as $__orig__ | ${varDefs} | ($__orig__ | ${expr})`;

  return { wrappedExpr, wrappedInput: combinedInput };
}

/**
 * node-jq variant: uses --argjson flags for cleaner variable injection.
 */
async function runNodeJqWithVars(
  nodeJqRun: (filter: string, input: string, opts: Record<string, unknown>) => Promise<unknown>,
  expr: string,
  input: unknown,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const varNames = Object.keys(variables);
  if (varNames.length === 0) {
    const result = await nodeJqRun(expr, JSON.stringify(input ?? null), {
      input: "string",
      output: "json",
    });
    return result;
  }

  // node-jq doesn't support --argjson directly in the API, so we use the
  // same wrapping strategy as jq-wasm
  const { wrappedExpr, wrappedInput } = wrapWithVariables(expr, variables, input);
  const result = await nodeJqRun(wrappedExpr, JSON.stringify(wrappedInput), {
    input: "string",
    output: "json",
  });
  return result;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keysA = Object.keys(aObj).sort();
  const keysB = Object.keys(bObj).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, i) => k === keysB[i] && deepEqual(aObj[k], bObj[k]));
}

async function runTestCase(
  testCase: TestCase,
  runner: (expr: string, input: unknown) => Promise<unknown>,
  libraryName: string,
): Promise<TestResult> {
  const { id, expression, input, variables, expected } = testCase;

  // Skip the "now" builtin for correctness check (it returns a timestamp)
  const isTimestampTest = expected === "__TIMESTAMP__";

  let wrappedExpr = expression;
  let wrappedInput = input;

  if (variables && Object.keys(variables).length > 0) {
    const wrapped = wrapWithVariables(expression, variables, input);
    wrappedExpr = wrapped.wrappedExpr;
    wrappedInput = wrapped.wrappedInput;
  }

  const start = performance.now();
  try {
    const actual = await runner(wrappedExpr, wrappedInput);
    const latencyMs = performance.now() - start;

    let passed: boolean;
    if (isTimestampTest) {
      passed = typeof actual === "number" && actual > 0;
    } else {
      passed = deepEqual(actual, expected);
    }

    return { id, expression, passed, expected, actual, latencyMs };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      id,
      expression,
      passed: false,
      expected,
      actual: undefined,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function benchmarkLatency(
  runner: (expr: string, input: unknown) => Promise<unknown>,
  iterations: number = 50,
): Promise<{ avgMs: number; minMs: number; maxMs: number; p95Ms: number }> {
  const simpleExpr = ".name";
  const simpleInput = { name: "test", value: 42 };

  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await runner(simpleExpr, simpleInput);
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const avgMs = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  const minMs = latencies[0];
  const maxMs = latencies[latencies.length - 1];
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)];

  return { avgMs, minMs, maxMs, p95Ms };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("T01a: jq Expression Validation Spike");
  console.log("=".repeat(72));
  console.log();

  const runtimeCases: TestCase[] = fixtures.runtimeExpressions.testCases;
  const transformCases: TestCase[] = fixtures.transformExpressions.testCases;
  const reports: LibraryReport[] = [];

  // --- jq-wasm ---
  console.log("--- Testing jq-wasm (WebAssembly, in-process) ---\n");
  try {
    const jqWasm = await loadJqWasm();
    console.log(`  Loaded: ${jqWasm.version}`);

    const runtimeResults: TestResult[] = [];
    for (const tc of runtimeCases) {
      const result = await runTestCase(tc, jqWasm.run, "jq-wasm");
      runtimeResults.push(result);
      const icon = result.passed ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${tc.id}: ${tc.expression}`);
      if (!result.passed) {
        console.log(`         expected: ${JSON.stringify(result.expected)}`);
        console.log(`         actual:   ${JSON.stringify(result.actual)}`);
        if (result.error) console.log(`         error:    ${result.error}`);
      }
    }

    const transformResults: TestResult[] = [];
    console.log("\n  Transform expressions (no variables, raw input):");
    for (const tc of transformCases) {
      const result = await runTestCase(tc, jqWasm.run, "jq-wasm");
      transformResults.push(result);
      const icon = result.passed ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${tc.id}: ${tc.expression}`);
      if (!result.passed) {
        console.log(`         expected: ${JSON.stringify(result.expected)}`);
        console.log(`         actual:   ${JSON.stringify(result.actual)}`);
        if (result.error) console.log(`         error:    ${result.error}`);
      }
    }

    console.log("\n  Benchmarking (50 iterations of simple '.name' expression)...");
    const bench = await benchmarkLatency(jqWasm.run);
    console.log(`  avg: ${bench.avgMs.toFixed(2)}ms, min: ${bench.minMs.toFixed(2)}ms, max: ${bench.maxMs.toFixed(2)}ms, p95: ${bench.p95Ms.toFixed(2)}ms`);

    const allResults = [...runtimeResults, ...transformResults];
    const passCount = allResults.filter((r) => r.passed).length;

    reports.push({
      library: "jq-wasm",
      version: jqWasm.version,
      runtimeResults,
      transformResults,
      customVariableSupport: true,
      customFunctionSupport: false,
      avgLatencyMs: bench.avgMs,
      passRate: passCount / allResults.length,
      notes: [
        "In-process WASM, no subprocess overhead",
        "Variables injected via expression wrapping (not native --argjson)",
        "Custom functions (uuid) NOT supported — must be pre-processed",
        "No external binary dependency",
      ],
    });
  } catch (err) {
    console.log(`  ERROR loading jq-wasm: ${err instanceof Error ? err.message : err}`);
    reports.push({
      library: "jq-wasm",
      version: "FAILED TO LOAD",
      runtimeResults: [],
      transformResults: [],
      customVariableSupport: false,
      customFunctionSupport: false,
      avgLatencyMs: -1,
      passRate: 0,
      notes: [`Failed to load: ${err instanceof Error ? err.message : err}`],
    });
  }

  console.log("\n");

  // --- node-jq ---
  console.log("--- Testing node-jq (subprocess to system jq binary) ---\n");
  try {
    const nodeJq = await loadNodeJq();
    console.log(`  Loaded: ${nodeJq.version}`);

    const runtimeResults: TestResult[] = [];
    for (const tc of runtimeCases) {
      const result = await runTestCase(tc, nodeJq.run, "node-jq");
      runtimeResults.push(result);
      const icon = result.passed ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${tc.id}: ${tc.expression}`);
      if (!result.passed) {
        console.log(`         expected: ${JSON.stringify(result.expected)}`);
        console.log(`         actual:   ${JSON.stringify(result.actual)}`);
        if (result.error) console.log(`         error:    ${result.error}`);
      }
    }

    const transformResults: TestResult[] = [];
    console.log("\n  Transform expressions (no variables, raw input):");
    for (const tc of transformCases) {
      const result = await runTestCase(tc, nodeJq.run, "node-jq");
      transformResults.push(result);
      const icon = result.passed ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${tc.id}: ${tc.expression}`);
      if (!result.passed) {
        console.log(`         expected: ${JSON.stringify(result.expected)}`);
        console.log(`         actual:   ${JSON.stringify(result.actual)}`);
        if (result.error) console.log(`         error:    ${result.error}`);
      }
    }

    console.log("\n  Benchmarking (50 iterations of simple '.name' expression)...");
    const bench = await benchmarkLatency(nodeJq.run);
    console.log(`  avg: ${bench.avgMs.toFixed(2)}ms, min: ${bench.minMs.toFixed(2)}ms, max: ${bench.maxMs.toFixed(2)}ms, p95: ${bench.p95Ms.toFixed(2)}ms`);

    const allResults = [...runtimeResults, ...transformResults];
    const passCount = allResults.filter((r) => r.passed).length;

    reports.push({
      library: "node-jq",
      version: nodeJq.version,
      runtimeResults,
      transformResults,
      customVariableSupport: true,
      customFunctionSupport: false,
      avgLatencyMs: bench.avgMs,
      passRate: passCount / allResults.length,
      notes: [
        "Subprocess to system jq binary — requires 'jq' installed",
        "Variables injected via expression wrapping",
        "Custom functions (uuid) NOT supported — must be pre-processed",
        "Full jq spec compliance (uses real jq binary)",
        "Higher latency due to process spawn per call",
      ],
    });
  } catch (err) {
    console.log(`  ERROR loading node-jq: ${err instanceof Error ? err.message : err}`);
    reports.push({
      library: "node-jq",
      version: "FAILED TO LOAD",
      runtimeResults: [],
      transformResults: [],
      customVariableSupport: false,
      customFunctionSupport: false,
      avgLatencyMs: -1,
      passRate: 0,
      notes: [`Failed to load: ${err instanceof Error ? err.message : err}`],
    });
  }

  // --- Summary ---
  console.log("\n");
  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));

  for (const report of reports) {
    const runtimePass = report.runtimeResults.filter((r) => r.passed).length;
    const runtimeTotal = report.runtimeResults.length;
    const transformPass = report.transformResults.filter((r) => r.passed).length;
    const transformTotal = report.transformResults.length;

    console.log(`\n${report.library} (${report.version}):`);
    console.log(`  Runtime expressions:   ${runtimePass}/${runtimeTotal} passed`);
    console.log(`  Transform expressions: ${transformPass}/${transformTotal} passed`);
    console.log(`  Overall pass rate:     ${(report.passRate * 100).toFixed(1)}%`);
    console.log(`  Avg latency:           ${report.avgLatencyMs >= 0 ? report.avgLatencyMs.toFixed(2) + "ms" : "N/A"}`);
    console.log(`  Custom variables:      ${report.customVariableSupport ? "YES (via wrapping)" : "NO"}`);
    console.log(`  Custom functions:      ${report.customFunctionSupport ? "YES" : "NO (pre-process uuid)"}`);
    console.log(`  Notes:`);
    for (const note of report.notes) {
      console.log(`    - ${note}`);
    }
  }

  // --- Write results file ---
  const resultsPath = join(__dirname, "..", "results", "jq-results.md");
  const { writeFileSync } = await import("node:fs");

  let md = "# T01a: jq Expression Validation Results\n\n";
  md += `**Date**: ${new Date().toISOString()}\n\n`;

  for (const report of reports) {
    const runtimePass = report.runtimeResults.filter((r) => r.passed).length;
    const runtimeTotal = report.runtimeResults.length;
    const transformPass = report.transformResults.filter((r) => r.passed).length;
    const transformTotal = report.transformResults.length;

    md += `## ${report.library} (${report.version})\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Runtime expressions | ${runtimePass}/${runtimeTotal} passed |\n`;
    md += `| Transform expressions | ${transformPass}/${transformTotal} passed |\n`;
    md += `| Overall pass rate | ${(report.passRate * 100).toFixed(1)}% |\n`;
    md += `| Avg latency | ${report.avgLatencyMs >= 0 ? report.avgLatencyMs.toFixed(2) + "ms" : "N/A"} |\n`;
    md += `| Custom variables | ${report.customVariableSupport ? "YES (via wrapping)" : "NO"} |\n`;
    md += `| Custom functions | ${report.customFunctionSupport ? "YES" : "NO"} |\n\n`;

    const failedResults = [...report.runtimeResults, ...report.transformResults].filter(
      (r) => !r.passed,
    );
    if (failedResults.length > 0) {
      md += `### Failed Tests\n\n`;
      for (const r of failedResults) {
        md += `- **${r.id}**: \`${r.expression}\`\n`;
        md += `  - Expected: \`${JSON.stringify(r.expected)}\`\n`;
        md += `  - Actual: \`${JSON.stringify(r.actual)}\`\n`;
        if (r.error) md += `  - Error: ${r.error}\n`;
        md += "\n";
      }
    }

    md += `### Notes\n\n`;
    for (const note of report.notes) {
      md += `- ${note}\n`;
    }
    md += "\n---\n\n";
  }

  md += "## Gate Assessment\n\n";
  const bestReport = reports.reduce((best, r) => (r.passRate > best.passRate ? r : best), reports[0]);
  if (bestReport && bestReport.passRate >= 0.95) {
    md += `**PASS**: ${bestReport.library} achieves ${(bestReport.passRate * 100).toFixed(1)}% pass rate. `;
    md += `jq expression evaluation is viable in TypeScript.\n`;
  } else if (bestReport && bestReport.passRate >= 0.8) {
    md += `**CONDITIONAL**: Best library (${bestReport.library}) achieves ${(bestReport.passRate * 100).toFixed(1)}% pass rate. `;
    md += `Review failed cases for workaround feasibility.\n`;
  } else {
    md += `**FAIL**: No library exceeds 80% pass rate. jq evaluation is a blocker.\n`;
  }

  writeFileSync(resultsPath, md);
  console.log(`\nResults written to: ${resultsPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
