/**
 * Test helpers: read a fixture map, name the finding kinds an outcome
 * carries, and unwrap the arms with a diagnostic when the other arm came
 * back. Kinds are returned SORTED and complete (errors and warnings both),
 * so an adversarial test asserts everything the reader said and a warning
 * that appears beside the error under test is named, never tolerated by
 * omission.
 */

import { expect } from "vitest";

import { inMemoryPluginFiles } from "../files.js";
import type { Finding, PluginFinding, PluginReadOutcome } from "../outcome.js";
import { readPluginPackage } from "../read-plugin-package.js";
import type { PluginFixture } from "../testing.js";
import type { PluginPackage } from "../types.js";

export function read(files: PluginFixture): PluginReadOutcome {
  return readPluginPackage(inMemoryPluginFiles(files));
}

export interface Kinds {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function kindsOf(outcome: PluginReadOutcome): Kinds {
  const sorted = (findings: readonly PluginFinding[]): string[] => findings.map((f) => f.kind).sort();
  return outcome.ok
    ? { errors: [], warnings: sorted(outcome.warnings) }
    : { errors: sorted(outcome.errors), warnings: sorted(outcome.warnings) };
}

/** The plugin, failing with every finding's sentence when the read refused. */
export function accepted(outcome: PluginReadOutcome): PluginPackage {
  if (!outcome.ok) {
    expect.fail(`expected an accepted plugin, got refusals:\n${outcome.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n")}`);
  }
  return outcome.plugin;
}

/** The errors, failing when the read accepted. */
export function refused(outcome: PluginReadOutcome): readonly PluginFinding[] {
  if (outcome.ok) {
    expect.fail(`expected a refusal, got an accepted plugin '${outcome.plugin.name}'`);
  }
  return outcome.errors;
}

/** The one finding of `kind`, failing when it is absent or repeated; over either vocabulary. */
export function findingOf<K extends string>(findings: readonly Finding<K>[], kind: string): Finding<K> {
  const matches = findings.filter((f) => f.kind === kind);
  expect(matches, `exactly one '${kind}' finding`).toHaveLength(1);
  return matches[0] as Finding<K>;
}
