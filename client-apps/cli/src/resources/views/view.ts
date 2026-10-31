// The one renderer every designed `get` view draws through, and the shapes a
// view hands it.
//
// A view is a function of the resource's protojson: it names a title (the
// resource's name, then where it lives, dimmed) and returns sections, the
// first usually untitled (the summary block of aligned fields), the rest
// titled. The renderer, not the view, decides what shows: a field with no
// value, and a section with nothing in it, are left out, so a view lists
// what a kind can carry and the person sees what this resource does carry.
// On a terminal, text wraps at its width with each continuation under the
// text it continues; piped (no width), nothing is wrapped or cut. Monochrome
// by the CLI's law: the title and section headings bold, the location and
// closing notes dim, through the caller's styler.
//
// Precedent: `gh pr view` (a title line, fields, then titled sections).

import type { Stigmer } from "@stigmer/client";
import stringWidth from "string-width";
import type { Styler } from "../../output/index.js";
import { type JsonObject, obj, str } from "../render.js";

/** A summary line: its label and its value; no value, no line. */
export type Field = readonly [label: string, value: string | undefined];

/**
 * One block of a view. Untitled, it is the summary under the title line.
 * Its parts print in this order: aligned fields, aligned rows (columns two
 * spaces apart), text lines, then a dim closing note.
 */
export interface Section {
  readonly title?: string;
  readonly fields?: readonly Field[];
  readonly rows?: readonly (readonly string[])[];
  readonly lines?: readonly string[];
  readonly more?: string;
}

/** The title line: the resource's name, then where it lives (dimmed; "" for none). */
export interface Title {
  readonly name: string;
  readonly ref: string;
}

/**
 * What a view reads beside its resource. `hideOrg` and `orgLabel` are the
 * generic view's (a server holding one organization never names it; where
 * it is named, by its slug); `now` dates a span still running; `runs` is the
 * session's run list, newest first, the one thing a view reads beyond the
 * resource; `width` is the terminal's (undefined piped).
 */
export interface ViewContext {
  readonly hideOrg: boolean;
  readonly orgLabel?: string;
  readonly width?: number;
  readonly style: Styler;
  readonly now: number;
  readonly runs?: readonly JsonObject[];
}

/** What a view's loader adds to its context. */
export type Related = Pick<ViewContext, "runs">;

/** A kind's designed view. */
export interface KindView {
  readonly title?: (json: JsonObject, ctx: ViewContext) => Title;
  readonly sections: (json: JsonObject, ctx: ViewContext) => readonly Section[];
  readonly related?: (client: Stigmer, json: JsonObject) => Promise<Related>;
}

// Below this many columns a wrapped line would read worse than the terminal's
// own wrap, so text keeps at least this much room.
const MIN_ROOM = 20;

// The indent of everything under the title and the headings.
const INDENT = "  ";

/** Draw `view` over `json`: blank line, title, then each section with content. */
export function renderView(view: KindView, json: JsonObject, ctx: ViewContext): string {
  const title = (view.title ?? defaultTitle)(json, ctx);
  const out: string[] = ["", titleLine(title, ctx.style)];
  for (const section of view.sections(json, ctx)) {
    const body = sectionBody(section, ctx);
    if (body.length === 0) continue;
    out.push("");
    if (section.title !== undefined) out.push(ctx.style.bold(section.title));
    out.push(...body);
  }
  return `${out.join("\n")}\n`;
}

/**
 * A resource's name (else its slug, else its id), then where it lives:
 * `org/slug`, the organization by its label, or the slug alone on a server
 * that holds one organization.
 */
export function defaultTitle(json: JsonObject, ctx: ViewContext): Title {
  const metadata = obj(json, "metadata");
  const slug = str(metadata, "slug");
  const name = str(metadata, "name") || slug || str(metadata, "id");
  return { name, ref: located(metadata, slug, ctx) };
}

/**
 * `org/<tail>` for a resource of `metadata`'s organization; `tail` alone
 * where the organization is not named (hidden, or none on the resource).
 */
export function located(metadata: JsonObject, tail: string, ctx: ViewContext): string {
  const own = str(metadata, "org");
  const org = ctx.hideOrg || own === "" ? "" : (ctx.orgLabel ?? own);
  return [org, tail].filter((part) => part !== "").join("/");
}

function titleLine(title: Title, style: Styler): string {
  const name = style.bold(title.name);
  return title.ref === "" ? name : `${name}  ${style.dim(title.ref)}`;
}

function sectionBody(section: Section, ctx: ViewContext): string[] {
  const body = [...fieldLines(section.fields ?? [], ctx.width), ...rowLines(section.rows ?? [], ctx.width)];
  for (const line of section.lines ?? []) body.push(...textLine(line, ctx.width));
  if (section.more !== undefined && body.length > 0) body.push(`${INDENT}${ctx.style.dim(section.more)}`);
  return body;
}

function fieldLines(fields: readonly Field[], width: number | undefined): string[] {
  const shown = fields.filter((field): field is readonly [string, string] => (field[1] ?? "") !== "");
  const labelWidth = Math.max(0, ...shown.map(([label]) => stringWidth(label)));
  return shown.flatMap(([label, value]) => {
    const prefix = `${INDENT}${label}:${" ".repeat(labelWidth - stringWidth(label) + 2)}`;
    return hang(prefix, value.split("\n"), width);
  });
}

function rowLines(rows: readonly (readonly string[])[], width: number | undefined): string[] {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(0, ...rows.map((row) => stringWidth(row[column] ?? ""))),
  );
  return rows.flatMap((row) => {
    const last = row.length - 1;
    const prefix = INDENT + row.slice(0, last).map((cell, column) => `${cell}${" ".repeat(widths[column] - stringWidth(cell) + 2)}`).join("");
    return hang(prefix, [row[last] ?? ""], width);
  });
}

// A text line keeps its own leading whitespace (an indented block) and list
// marker ("- ", "* " or "1. ", after any indent), and its continuations line
// up under its text.
function textLine(line: string, width: number | undefined): string[] {
  const lead = /^\s*(?:[-*]|\d+\.)\s+/.exec(line)?.[0] ?? line.slice(0, line.length - line.trimStart().length);
  return hang(`${INDENT}${lead}`, [line.slice(lead.length)], width);
}

// The first piece after `prefix`, every other under it.
function hang(prefix: string, texts: readonly string[], width: number | undefined): string[] {
  const indent = stringWidth(prefix);
  const pieces = texts.flatMap((text) => wrapText(text, width === undefined ? undefined : Math.max(MIN_ROOM, width - indent)));
  const under = " ".repeat(indent);
  return pieces.map((piece, index) => `${index === 0 ? prefix : under}${piece}`.trimEnd());
}

/**
 * `text` broken at spaces into pieces no wider than `room` columns; one
 * word wider than the room keeps a piece of its own, whole, since cutting
 * an address or an id would break what a person copies. With no room
 * (piped), the text as it is.
 */
export function wrapText(text: string, room: number | undefined): string[] {
  if (room === undefined) return [text];
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current === "" || stringWidth(candidate) <= room) {
      current = candidate;
    } else {
      pieces.push(current);
      current = word;
    }
  }
  pieces.push(current);
  return pieces;
}
