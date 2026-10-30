/**
 * The React core reference, written: TypeDoc's JSON in, the reference page and
 * its meta.json out. Returns how many exports the page lists; refuses a
 * missing input (TypeDoc was not run) or an input with no exports.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTypeDocJson } from "./parser";
import { renderMetaJson, renderReferencePage } from "./renderer";

export async function generate(apiJsonPath: string, outputDir: string): Promise<number> {
  try {
    await fs.access(apiJsonPath);
  } catch {
    throw new Error(`${apiJsonPath} does not exist. Run 'cd sdk/react-core && npm run typedoc:json' first.`);
  }
  const reference = await parseTypeDocJson(apiJsonPath);
  if (reference.exports.length === 0) throw new Error("no exports found in the TypeDoc output.");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "reference.mdx"), renderReferencePage(reference), "utf-8");
  await fs.writeFile(path.join(outputDir, "meta.json"), renderMetaJson(), "utf-8");
  return reference.exports.length;
}
