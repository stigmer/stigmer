/**
 * Pins the docs YAML gate's three-class contract over a docs tree written to
 * a temporary directory: a resource manifest, a fragment anchored with
 * validate-as and a block marked no-validate with its reason all pass and are
 * counted; an authoring directory's raw manifests are validated and counted;
 * an unclassified block, an anchor naming no kind, a marker with no reason and
 * a manifest that does not decode each fail the gate with their own message;
 * and report mode prints a protovalidate violation without failing the build.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDocsYamlCheck } from "../docs-yaml-gate.js";

const AGENT = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Agent",
  "metadata:",
  "  name: my-first-agent",
  "spec:",
  "  instructions: Answer clearly.",
].join("\n");

const fence = (meta: string, body: string): string => ["```yaml" + (meta === "" ? "" : ` ${meta}`), body, "```", ""].join("\n");

let root: string;
let printed: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-yaml-gate-"));
  printed = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    printed += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function writeDoc(rel: string, content: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("the docs YAML gate", () => {
  it("passes a manifest, an anchored fragment and a reasoned skip, and counts each class and every authoring manifest", () => {
    writeDoc(
      "docs/guide.mdx",
      [
        "# Guide",
        fence("", AGENT),
        fence('validate-as="Agent.spec"', "instructions: Be brief."),
        fence('no-validate="frontmatter, not resource YAML"', "title: Guide"),
      ].join("\n"),
    );
    writeDoc("examples/agent.yaml", AGENT);
    writeDoc("examples/notes.txt", "not yaml");

    runDocsYamlCheck(path.join(root, "docs"), [path.join(root, "examples")], "off");

    expect(printed).toContain(
      "✓ docs YAML gate: 3 blocks across 1 files — 1 manifests, 1 anchored fragments, 1 skipped with no-validate, 0 unclassified",
    );
    expect(printed).toContain(`✓ authoring surfaces (${path.join(root, "examples")}): 1 files scanned, 1 raw manifests validated`);
  });

  it("fails on an unclassified block, an unknown anchor, a marker with no reason and a manifest that does not decode, naming each", () => {
    writeDoc(
      "docs/broken.md",
      [
        fence("", "title: not a resource"),
        fence('validate-as="Workflow.spec"', "tasks: []"),
        fence("validate-as", "instructions: x"),
        fence("", `${AGENT}\n  nonsense: true`),
      ].join("\n"),
    );

    expect(() => runDocsYamlCheck(path.join(root, "docs"), [], "off")).toThrow("docs YAML validation failed with 4 problem(s)");
    expect(printed).toContain("unclassified yaml block: not a resource manifest (apiVersion/kind)");
    expect(printed).toContain('validate-as "Workflow.spec": unknown resource kind "Workflow"');
    expect(printed).toContain('validate-as marker requires an anchor: use validate-as="<Kind>[.<field>]"');
    expect(printed).toContain("Agent manifest does not validate against");
    expect(printed).toContain('no-validate="reason" marker in the fence info string.');
  });

  it("reports a protovalidate violation in report mode without failing the build", () => {
    writeDoc("docs/guide.md", fence("", AGENT.replace("  name: my-first-agent\n", "")));

    runDocsYamlCheck(path.join(root, "docs"), [], "report");

    expect(printed).toMatch(/docs YAML rule report: \d+ violation\(s\) in 1 block\(s\)/);
    expect(printed).toContain("(rule: ");
    expect(printed).toContain("report mode never fails the build");
    expect(printed).toContain("✓ docs YAML gate: 1 blocks across 1 files — 1 manifests");
  });
});
