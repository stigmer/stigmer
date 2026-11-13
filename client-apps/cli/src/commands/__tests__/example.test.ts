// `stigmer example list|get` (commands/example.ts) over the real catalogue
// (`@stigmer/examples`): the list names every example's job and agent and
// the skills; `get` writes an example's manifest and samples (or a skill's
// SKILL.md) into the folder, says the apply and run commands with the
// example's own message and samples, and never overwrites a file without
// `--force`.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLES, SKILLS, exampleById, skillById } from "@stigmer/examples";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../errors/index.js";
import { exampleListResult, writeExample, writeSkill } from "../example.js";

const invoice = exampleById("invoice-match");
const spreadsheet = skillById("spreadsheet-export");

describe("exampleListResult", () => {
  it("names each example's job, what goes in and out, and its agent, then the skills", () => {
    const result = exampleListResult(EXAMPLES, SKILLS);
    expect(result.message).toBe(`${EXAMPLES.length} example agents`);
    const invoiceSection = result.sections.find((s) => s.title === "invoice-match — Invoice match");
    expect(invoiceSection?.fields).toContainEqual({ key: "Agent", value: "invoice-matcher" });
    expect(invoiceSection?.fields).toContainEqual({ key: "For", value: "a procurement tool" });
    expect(result.sections.at(-1)?.fields).toContainEqual({ key: "spreadsheet-export", value: "Spreadsheet export" });
    expect(result.hints[0]).toBe("Write one into this repository:  stigmer example get <id>");
  });
});

describe("writeExample", () => {
  it("writes the manifest and samples, and says how to apply and run it on them", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "stigmer-example-")), "stigmer", "invoice-match");
    const result = writeExample(invoice!, dir, false);
    expect(readFileSync(join(dir, "invoice-matcher.yaml"), "utf8")).toBe(invoice!.manifest.text);
    for (const sample of invoice!.samples) expect(readFileSync(join(dir, sample.name), "utf8")).toBe(sample.text);
    expect(result.hints[0]).toMatch(/^Make the agent:  stigmer apply -f .*invoice-matcher\.yaml$/);
    expect(result.hints[1]).toContain(`stigmer run invoice-matcher -m ${JSON.stringify(invoice!.message)}`);
    expect(result.hints[1]).toContain("invoice-4471.csv");
    expect(result.hints[1]).toContain("--download stigmer-output/");
  });

  it("refuses to overwrite a file already there, and overwrites with force", () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-example-"));
    writeFileSync(join(dir, "invoice-matcher.yaml"), "edited by the person\n");
    expect(() => writeExample(invoice!, dir, false)).toThrow(CliExitError);
    expect(readFileSync(join(dir, "invoice-matcher.yaml"), "utf8")).toBe("edited by the person\n");
    writeExample(invoice!, dir, true);
    expect(readFileSync(join(dir, "invoice-matcher.yaml"), "utf8")).toBe(invoice!.manifest.text);
  });
});

describe("writeSkill", () => {
  it("writes SKILL.md and says how to push it", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "stigmer-skill-")), "spreadsheet-export");
    const result = writeSkill(spreadsheet!, dir, false);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(spreadsheet!.text);
    expect(result.hints[0]).toMatch(/^Push it to your organization:  stigmer push skill /);
  });
});
