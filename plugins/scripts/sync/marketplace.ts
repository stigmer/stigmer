/**
 * `plugins/marketplace.json`, rendered from what the tree holds; pure over
 * the file's own head and the names to list.
 *
 * The file is the catalogue's contract with every client (name, owner,
 * `plugins[]`, `defaults[]`); its `plugins` list is the one part a sync
 * writes, because it is derived: every vendored row plus every authored
 * folder, in the order `marketplaceOrder` decides. The head (`name`,
 * `description`, `owner`, `defaults`) is a person's and is copied through
 * untouched. One entry per line, so a diff that adds a plugin is one line
 * and a reviewer reads the list as a list.
 */

import { marketplaceOrder } from "./plan.js";

export interface MarketplaceHead {
  readonly name: string;
  readonly description: string;
  readonly owner: { readonly name: string; readonly url: string };
  readonly defaults: readonly string[];
}

/** The head of the marketplace file as it stands; refuses a file whose head is not the official shape. */
export function readMarketplaceHead(text: string, path: string): MarketplaceHead {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)["name"] !== "string" ||
    typeof (value as Record<string, unknown>)["description"] !== "string" ||
    typeof (value as Record<string, unknown>)["owner"] !== "object" ||
    !Array.isArray((value as Record<string, unknown>)["defaults"])
  ) {
    throw new Error(`${path} does not carry the official marketplace head (name, description, owner, defaults)`);
  }
  const head = value as { name: string; description: string; owner: { name: string; url: string }; defaults: unknown[] };
  if (!head.defaults.every((entry): entry is string => typeof entry === "string")) throw new Error(`${path}: 'defaults' must be a list of names`);
  return { name: head.name, description: head.description, owner: { name: head.owner.name, url: head.owner.url }, defaults: head.defaults };
}

/** The marketplace file's text with `names` as its plugin list, in the ruled order. */
export function renderMarketplace(head: MarketplaceHead, names: ReadonlySet<string>): string {
  const entries = marketplaceOrder(names, head.defaults).map((name) => `    { "name": ${JSON.stringify(name)}, "source": ${JSON.stringify(`./${name}`)} }`);
  return [
    "{",
    `  "name": ${JSON.stringify(head.name)},`,
    `  "description": ${JSON.stringify(head.description)},`,
    `  "owner": ${JSON.stringify(head.owner)},`,
    `  "plugins": [`,
    entries.join(",\n"),
    "  ],",
    `  "defaults": ${JSON.stringify(head.defaults)}`,
    "}",
    "",
  ].join("\n");
}
