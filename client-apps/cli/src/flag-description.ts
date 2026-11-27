// A flag's text as a person reads it, in `--help` and on the generated
// command pages alike: the option's own description, marked "(required)"
// when the command cannot run without it (Commander's `requiredOption`).
// Help (global-options.ts `helpConfiguration`) and the docs generator
// (scripts/gen-cli-docs.ts) both read it, so the terminal and the page cannot
// disagree about which flags are required.

import type { Option } from "commander";

/** The words that mark a required flag. */
export const REQUIRED_MARK = "(required)";

/**
 * `text` (the option's description unless given) with the required mark
 * appended when the option is mandatory.
 */
export function flagDescription(option: Option, text: string = option.description): string {
  if (!option.mandatory) return text;
  return text === "" ? REQUIRED_MARK : `${text} ${REQUIRED_MARK}`;
}
