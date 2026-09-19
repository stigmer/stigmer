/**
 * What a licence file permits, read from its text; pure.
 *
 * The first rule of the inclusion rubric is "we may ship it", and the audit
 * answers it from the licence file a plugin's folder carries, or the
 * repository's root licence when the folder has none. The classes are the
 * few the three vendors' trees actually contain plus the two that matter
 * most for the verdict: a text that reserves all rights, and no text at
 * all. Anything else is `unrecognised` and shown to the maintainer as such;
 * this module never guesses a permission it cannot read, because a wrong
 * `mit` ships someone else's work and a wrong `all-rights-reserved` only
 * costs a plugin a second look.
 *
 * Recognition is by the licence's own opening words, case-insensitive, on
 * the first lines of the file: "MIT License", "Apache License, Version
 * 2.0", "BSD 2-Clause" / "BSD 3-Clause" / "Redistribution and use in
 * source and binary forms", "All rights reserved" with no permissive grant
 * around it. Deeper text (a copyright line before the title, a leading
 * heading) is skipped by scanning the first `HEAD_LINES` lines, not the
 * first line alone.
 */

/** The classes a verdict distinguishes; `redistributable` in `classify.ts` is a function of this. */
export type LicenceClass = "mit" | "apache-2.0" | "bsd" | "all-rights-reserved" | "unrecognised" | "none";

/** How many leading lines carry a licence's identifying words. */
const HEAD_LINES = 12;

/** The file names a licence is kept under, in the order they are looked for. */
export const LICENCE_FILE_NAMES: readonly string[] = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt", "COPYING"];

/** Whether a class lets Stigmer copy the work into its own catalogue with attribution. */
export function isRedistributable(licence: LicenceClass): boolean {
  switch (licence) {
    case "mit":
    case "apache-2.0":
    case "bsd":
      return true;
    case "all-rights-reserved":
    case "unrecognised":
    case "none":
      return false;
    default: {
      const exhaustive: never = licence;
      return exhaustive;
    }
  }
}

/** Classify the text of a licence file. */
export function classifyLicenceText(text: string): LicenceClass {
  const head = text
    .split(/\r?\n/)
    .slice(0, HEAD_LINES)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n")
    .toLowerCase();

  if (/\bmit license\b/.test(head) || /permission is hereby granted, free of charge/.test(head)) return "mit";
  if (/apache license/.test(head) && /version 2\.0/.test(head)) return "apache-2.0";
  if (/\bbsd\b/.test(head) || /redistribution and use in source and binary forms/.test(head)) return "bsd";
  if (/all rights reserved/.test(head)) return "all-rights-reserved";
  return "unrecognised";
}
