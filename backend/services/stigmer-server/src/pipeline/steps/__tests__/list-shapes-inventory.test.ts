/**
 * Holds docs/list-shapes.md true to the contract: every list-shaped method
 * of every service the stubs export, in every edition (a composition's own
 * services included, since they are part of the one contract), is a row of
 * the doc, classed `paged` or `exempt` with its reason, and the doc has no
 * row the contract does not.
 *
 * A method is list-shaped when its name begins with `list`, `search` or
 * `find`; when its request carries `page_size` or `page_token` or its
 * response `next_page_token`; or when its response has a top-level repeated
 * message field that holds a stored resource (a message with a `metadata`
 * field) or is named `entries` or `items`. So a method answering many rows
 * cannot slip past as a get by its name alone.
 *
 * A `paged` row's request takes `page_size` and `page_token` and its
 * response returns `entries` and `next_page_token`, with no total
 * (`total_count`, `total_pages`, `total_size`); and no message the
 * contract carries is a `PageInfo`. The page rule itself, 0 reading the
 * default page and a size above the maximum read as the maximum, is
 * pipeline/steps/list-page.ts's `listPageSizeOf`, the one reader of
 * `page_size` (its own tests).
 *
 * So a new list fails here with the row to write, and the row's review is
 * where its paging is decided. The mutation proofs below show the
 * comparison bites.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DescField, DescMessage, DescMethod } from "@bufbuild/protobuf";
import { beforeAll, describe, expect, it } from "vitest";

import { everyService } from "../../../authorization/__tests__/contract-support.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../../..");
const INVENTORY_DOC = path.join(PACKAGE_ROOT, "docs/list-shapes.md");

const LIST_NAME = /^(list|search|find)/;
const TOTAL_FIELDS = new Set(["total_count", "total_pages", "total_size"]);

/** A list-shaped method, named `package.Service.method`. */
interface ListMethod {
  readonly name: string;
  readonly method: DescMethod;
}

function repeatedMessageFields(message: DescMessage): DescField[] {
  return message.fields.filter(
    (field) => field.fieldKind === "list" && field.listKind === "message",
  );
}

function childOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message") {
    return field.message;
  }
  if (
    (field.fieldKind === "list" || field.fieldKind === "map") &&
    field.message !== undefined
  ) {
    return field.message;
  }
  return undefined;
}

/** True when a method answers many rows, by name, by paging field or by response shape. */
function isListShaped(method: DescMethod): boolean {
  if (LIST_NAME.test(method.localName)) {
    return true;
  }
  const field = (message: DescMessage, name: string): boolean =>
    message.fields.some((f) => f.name === name);
  if (
    field(method.input, "page_size") ||
    field(method.input, "page_token") ||
    field(method.output, "next_page_token")
  ) {
    return true;
  }
  return repeatedMessageFields(method.output).some(
    (f) =>
      f.name === "entries" ||
      f.name === "items" ||
      (f.message?.fields.some((m) => m.name === "metadata") ?? false),
  );
}

function listMethods(
  services: Awaited<ReturnType<typeof everyService>>,
): ListMethod[] {
  const out: ListMethod[] = [];
  for (const service of services) {
    for (const method of service.methods) {
      if (isListShaped(method)) {
        out.push({ name: `${service.typeName}.${method.localName}`, method });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The doc's rows: method name to its class (`paged`, or `exempt` with the reason after a colon). */
function rowsOf(doc: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of doc.split("\n")) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.set(cells[0]!.replaceAll("`", ""), cells[1]!);
  }
  return rows;
}

/** What is wrong with a paged method's request and response, as sentences. */
function pagedShapeProblems(list: ListMethod): string[] {
  const problems: string[] = [];
  const has = (message: DescMessage, name: string): boolean =>
    message.fields.some((f) => f.name === name);
  for (const name of ["page_size", "page_token"]) {
    if (!has(list.method.input, name)) {
      problems.push(`${list.name}'s request has no ${name}`);
    }
  }
  const entries = list.method.output.fields.find((f) => f.name === "entries");
  if (entries === undefined || entries.fieldKind !== "list") {
    problems.push(`${list.name}'s response has no repeated entries`);
  }
  if (!has(list.method.output, "next_page_token")) {
    problems.push(`${list.name}'s response has no next_page_token`);
  }
  for (const field of list.method.output.fields) {
    if (TOTAL_FIELDS.has(field.name)) {
      problems.push(`${list.name}'s response carries ${field.name}`);
    }
  }
  return problems;
}

/** Every row disagreement between the doc and the contract, as sentences. */
function inventoryProblems(
  lists: ReadonlyArray<ListMethod>,
  rows: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  const names = new Set(lists.map((list) => list.name));
  for (const list of lists) {
    const row = rows.get(list.name);
    if (row === undefined) {
      problems.push(
        `${list.name} is list-shaped and has no row: write \`paged\` or \`exempt: <why>\``,
      );
    } else if (row === "paged") {
      problems.push(...pagedShapeProblems(list));
    } else if (!/^exempt: \S/.test(row)) {
      problems.push(
        `${list.name}'s row reads '${row}', not \`paged\` or \`exempt: <why>\``,
      );
    }
  }
  for (const name of rows.keys()) {
    if (!names.has(name)) {
      problems.push(
        `${name} has a row but is no list-shaped method of the contract`,
      );
    }
  }
  return problems;
}

/** Every message a method of the contract carries whose type is a PageInfo, as `Message.field`. */
function pageInfoFields(
  services: Awaited<ReturnType<typeof everyService>>,
): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (message: DescMessage): void => {
    if (seen.has(message.typeName)) {
      return;
    }
    seen.add(message.typeName);
    for (const field of message.fields) {
      const child = childOf(field);
      if (child === undefined) {
        continue;
      }
      if (/PageInfo$/.test(child.name)) {
        found.push(`${message.typeName}.${field.name}`);
      }
      visit(child);
    }
  };
  for (const service of services) {
    for (const method of service.methods) {
      visit(method.input);
      visit(method.output);
    }
  }
  return found;
}

describe("the list-shape inventory (docs/list-shapes.md) is true to the contract", () => {
  let services: Awaited<ReturnType<typeof everyService>>;
  let lists: ListMethod[];
  let rows: Map<string, string>;

  beforeAll(async () => {
    services = await everyService();
    lists = listMethods(services);
    rows = rowsOf(readFileSync(INVENTORY_DOC, "utf8"));
  });

  it("every list-shaped method has its row, every paged one takes the one shape, and no row is stale", () => {
    expect(inventoryProblems(lists, rows)).toEqual([]);
  });

  it("no message the contract carries is a PageInfo", () => {
    expect(pageInfoFields(services)).toEqual([]);
  });

  it("evaluator getByAgent answers one evaluator, so it is a get and not a list", () => {
    const method = services
      .find(
        (service) =>
          service.typeName ===
          "ai.stigmer.agentic.evaluator.v1.EvaluatorQueryController",
      )
      ?.methods.find((m) => m.localName === "getByAgent");
    expect(method).toBeDefined();
    expect(isListShaped(method!)).toBe(false);
  });

  it("the comparison bites: a missing row, a stale row, a bad class and a paged exemption each disagree", () => {
    const mutated = new Map(rows);
    const [first, second] = lists.filter(
      (list) => rows.get(list.name) === "paged",
    );
    const exempt = lists.find((list) =>
      rows.get(list.name)?.startsWith("exempt: "),
    );
    mutated.delete(first!.name);
    mutated.set("ai.stigmer.nothing.v1.NoController.list", "paged");
    mutated.set(second!.name, "paged by offset");
    mutated.set(exempt!.name, "paged");
    expect(inventoryProblems(lists, mutated)).toEqual(
      expect.arrayContaining([
        `${first!.name} is list-shaped and has no row: write \`paged\` or \`exempt: <why>\``,
        "ai.stigmer.nothing.v1.NoController.list has a row but is no list-shaped method of the contract",
        `${second!.name}'s row reads 'paged by offset', not \`paged\` or \`exempt: <why>\``,
      ]),
    );
    expect(
      inventoryProblems(lists, mutated).some((problem) =>
        problem.startsWith(`${exempt!.name}'s`),
      ),
    ).toBe(true);
  });

  it("the shape rule bites: a response with a total and without its token, and a request without its size, each disagree", () => {
    const paged = lists.find(
      (list) =>
        list.name === "ai.stigmer.agentic.run.v1.RunQueryController.list",
    )!;
    const output = {
      ...paged.method.output,
      fields: [
        ...paged.method.output.fields.filter(
          (f) => f.name !== "next_page_token",
        ),
        { ...paged.method.output.fields[0]!, name: "total_count" },
      ],
    } as DescMessage;
    const input = {
      ...paged.method.input,
      fields: paged.method.input.fields.filter((f) => f.name !== "page_size"),
    } as DescMessage;
    expect(
      pagedShapeProblems({
        name: paged.name,
        method: { ...paged.method, input, output } as DescMethod,
      }),
    ).toEqual([
      `${paged.name}'s request has no page_size`,
      `${paged.name}'s response has no next_page_token`,
      `${paged.name}'s response carries total_count`,
    ]);
  });

  it("the detection bites: a get answering many stored resources is list-shaped", () => {
    const resources = lists.find(
      (list) =>
        list.name ===
        "ai.stigmer.agentic.schedule.v1.ScheduleQueryController.listByAgent",
    )!;
    const disguised = {
      ...resources.method,
      localName: "getByAgent",
      input: { ...resources.method.input, fields: [] },
      output: {
        ...resources.method.output,
        fields: resources.method.output.fields
          .filter((f) => f.name === "entries")
          .map((f) => ({ ...f, name: "schedules" })),
      },
    } as unknown as DescMethod;
    expect(isListShaped(disguised)).toBe(true);
  });
});
