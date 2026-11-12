// The shape of one example agent, as a reader of the list sees it: the
// card's words, the first message, the agent to make, the manifest people
// download and the sample files the first run attaches; and of one
// ready-made skill a newcomer can give an agent. The data itself is
// generated into catalogue.gen.ts from the folders beside this package's
// source, so the downloadable files stay the only definition.

/** Where an example sits in a template gallery; the same values the console's create picker groups by. */
export type ExampleCategory = "data-analysis" | "devops" | "content" | "integration" | "general";

/** The agent an example makes: its manifest, read into the fields a create call takes. */
export interface ExampleAgent {
  /** Display name, from the manifest's slug ("Variance Reporter"). */
  readonly name: string;
  /** The manifest's `metadata.name`, the agent's slug in an organization. */
  readonly slug: string;
  readonly description: string;
  readonly instructions: string;
  /** Tools the agent may not use (`disallowed_tools`); the examples need no shell. */
  readonly disallowedTools: readonly string[];
}

/** One sample file a first run attaches, inlined as text. */
export interface ExampleSample {
  /** File name, as the first message names it ("ledger.csv"). */
  readonly name: string;
  /** Media type ("text/csv", "text/markdown"). */
  readonly type: string;
  readonly text: string;
}

/** One example job: what a product's user hands over and what the agent hands back. */
export interface Example {
  /** Stable id, the example's folder name ("variance-report"). */
  readonly id: string;
  /** Whose product it is, in one line ("For an accounting product"). */
  readonly for: string;
  /** The job's name ("Variance report"). */
  readonly name: string;
  /** What the product's user hands over ("A quarter's ledger"). */
  readonly gives: string;
  /** What the agent hands back. */
  readonly gets: string;
  readonly category: ExampleCategory;
  readonly tags: readonly string[];
  /** The first message, naming every sample it sends. */
  readonly message: string;
  /**
   * The message for a run on the person's own file instead of the samples
   * ("Here is one of our ledgers. Write the variance report."): it names no
   * file, since the person attaches their own.
   */
  readonly ownFileMessage: string;
  /** The file the agent's instructions promise to save ("variance-report.md"). */
  readonly output: string;
  readonly agent: ExampleAgent;
  /** The manifest people download, by its file name and text. */
  readonly manifest: { readonly name: string; readonly text: string };
  /** The samples in words, as a sentence names them ("ledger", "invoice and purchase order"). */
  readonly sampleName: string;
  readonly samples: readonly ExampleSample[];
}

/**
 * A ready-made skill a newcomer can give an example's agent: its SKILL.md,
 * inlined, so a console can make the skill in an organization without a
 * download (zipped as the skill's only file).
 */
export interface ExampleSkill {
  /** The skill's slug, its SKILL.md frontmatter `name` ("spreadsheet-export"). */
  readonly id: string;
  /** Its name in words ("Spreadsheet export"). */
  readonly name: string;
  /** Its SKILL.md frontmatter `description`. */
  readonly description: string;
  /** Its SKILL.md's path in this package's folder, as people download it ("skills/spreadsheet-export/SKILL.md"). */
  readonly file: string;
  /** The SKILL.md's text, byte for byte. */
  readonly text: string;
}
