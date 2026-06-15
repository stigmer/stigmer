// Structured command output. Instead of ad-hoc console writes, mutating
// commands build a CommandResult (status + message + sections + hints), then a
// renderer formats it for human, JSON, or quiet output. Mirrors the Go CLI's
// pkg/clioutput.
//
// Stream discipline: JSON data goes to stdout (so pipes capture only the
// payload); human and quiet status lines go to stderr.

import type { OutputFormat } from "./format.js";
import { shouldColorize, styler } from "./style.js";

export type ResultStatus = "success" | "warning" | "error";

export interface KeyValue {
  readonly key: string;
  readonly value: string;
}

/** A group of related fields/items under an optional title. */
export class Section {
  readonly title: string;
  readonly fields: KeyValue[] = [];
  readonly items: string[] = [];

  constructor(title: string) {
    this.title = title;
  }

  field(key: string, value: string): this {
    this.fields.push({ key, value });
    return this;
  }

  item(text: string): this {
    this.items.push(text);
    return this;
  }
}

/** The structured outcome of a command. Build via the static factories. */
export class CommandResult {
  readonly status: ResultStatus;
  readonly message: string;
  readonly sections: Section[] = [];
  readonly hints: string[] = [];

  private constructor(status: ResultStatus, message: string) {
    this.status = status;
    this.message = message;
  }

  static success(message: string): CommandResult {
    return new CommandResult("success", message);
  }

  static warning(message: string): CommandResult {
    return new CommandResult("warning", message);
  }

  static error(message: string): CommandResult {
    return new CommandResult("error", message);
  }

  addSection(title = ""): Section {
    const section = new Section(title);
    this.sections.push(section);
    return section;
  }

  hint(text: string): this {
    this.hints.push(text);
    return this;
  }
}

const ICONS: Record<ResultStatus, string> = {
  success: "✓",
  warning: "⚠",
  error: "✗",
};

interface JsonResult {
  status: string;
  message: string;
  sections?: JsonSection[];
  hints?: string[];
}

interface JsonSection {
  title?: string;
  fields?: KeyValue[];
  items?: string[];
}

/** JSON form of a CommandResult (omits empty sections/hints), newline-terminated. */
export function resultToJson(result: CommandResult): string {
  const out: JsonResult = { status: result.status, message: result.message };

  if (result.sections.length > 0) {
    out.sections = result.sections.map((section) => {
      const jsonSection: JsonSection = {};
      if (section.title !== "") jsonSection.title = section.title;
      if (section.fields.length > 0) {
        jsonSection.fields = section.fields.map((field) => ({ key: field.key, value: field.value }));
      }
      if (section.items.length > 0) jsonSection.items = [...section.items];
      return jsonSection;
    });
  }

  if (result.hints.length > 0) out.hints = [...result.hints];

  return JSON.stringify(out, null, 2) + "\n";
}

/** Colored, structured human form, newline-terminated. */
export function resultToHuman(result: CommandResult, colorize: boolean): string {
  const style = styler(colorize);
  const lines: string[] = [statusLine(result, colorize)];

  for (const section of result.sections) {
    lines.push("");
    if (section.title !== "") lines.push(style.bold(`${section.title}:`));

    if (section.fields.length > 0) {
      const widestKey = Math.max(...section.fields.map((field) => field.key.length));
      for (const field of section.fields) {
        const padding = " ".repeat(widestKey - field.key.length + 4);
        lines.push(`  ${style.dim(field.key)}${padding}${field.value}`);
      }
    }

    for (const item of section.items) lines.push(`  - ${item}`);
  }

  if (result.hints.length > 0) {
    lines.push("");
    for (const hint of result.hints) lines.push(`  ${style.dim(hint)}`);
  }

  return lines.join("\n") + "\n";
}

/** Status line only — for scripting where pass/fail is all that matters. */
export function resultToQuiet(result: CommandResult, colorize: boolean): string {
  return statusLine(result, colorize) + "\n";
}

function statusLine(result: CommandResult, colorize: boolean): string {
  const style = styler(colorize);
  const text = `${ICONS[result.status]} ${result.message}`;
  switch (result.status) {
    case "success":
      return style.green(text);
    case "warning":
      return style.yellow(text);
    case "error":
      return style.red(text);
  }
}

/** A pair of writable streams; defaults to the process std streams. */
export interface ResultStreams {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown; isTTY?: boolean };
}

const DEFAULT_STREAMS: ResultStreams = { stdout: process.stdout, stderr: process.stderr };

/** Render a CommandResult to the appropriate stream for the resolved format. */
export function renderResult(
  result: CommandResult,
  format: OutputFormat,
  streams: ResultStreams = DEFAULT_STREAMS,
): void {
  if (format === "json") {
    streams.stdout.write(resultToJson(result));
    return;
  }
  if (format === "quiet") {
    streams.stderr.write(resultToQuiet(result, shouldColorize(streams.stderr)));
    return;
  }
  streams.stderr.write(resultToHuman(result, shouldColorize(streams.stderr)));
}
