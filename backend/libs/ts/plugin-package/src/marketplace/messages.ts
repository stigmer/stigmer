/**
 * The one sentence for every marketplace finding kind, and the collector
 * bound to them.
 *
 * The same rule as the plugin vocabulary: copy lives here and nowhere else,
 * the CLI prints these sentences verbatim, and the `Record` types are
 * exhaustive so a kind without a sentence does not compile. The four
 * locations are named in the not-found sentence because that is the one an
 * author meets first when a file sits in the wrong place (Claude Code's own
 * issue tracker shows how often).
 */

import { at, FindingCollector, q, type Sentence } from "../messages.js";
import type { MarketplaceDialect, MarketplaceErrorKind, MarketplaceWarningKind } from "./outcome.js";

/** The four marketplace file locations, in the precedence the reader applies. */
export const MARKETPLACE_LOCATIONS: Readonly<Record<MarketplaceDialect, string>> = {
  stigmer: "marketplace.json",
  claude: ".claude-plugin/marketplace.json",
  cursor: ".cursor-plugin/marketplace.json",
  codex: ".agents/plugins/marketplace.json",
};

const locationList = Object.values(MARKETPLACE_LOCATIONS)
  .map((location) => q(location))
  .join(", ");

const ERROR_MESSAGES: Readonly<Record<MarketplaceErrorKind, Sentence>> = {
  "marketplace-not-found": () => `no marketplace file found: expected one of ${locationList}`,
  "marketplace-too-large": (c) => `${q(c.path)} is ${c.subject ?? ""} bytes, above the ${c.detail ?? ""} byte cap for a marketplace file`,
  "marketplace-unreadable": (c) => `${q(c.path)} is not a readable marketplace file: ${c.detail ?? "parse error"}`,
  "marketplace-field-type": (c) => `${q(c.path)} field ${q(c.subject)} must be ${c.detail ?? "of another type"}`,
  "marketplace-name-missing": (c) => `${q(c.path)} has no 'name'; a marketplace needs one so its plugins can be addressed as '<marketplace>/<plugin>'`,
  "marketplace-name-invalid": (c) =>
    `${q(c.path)} name ${q(c.subject)} is invalid: 1 to 64 characters of a-z, 0-9, '-' and '.', starting and ending alphanumeric, no '--' or '..'`,
  "marketplace-plugins-missing": (c) => `${q(c.path)} has no 'plugins' list`,
  "entry-shape": (c) => `${q(c.path)} plugins[${c.subject ?? ""}] must be an object with 'name' and 'source'`,
  "entry-name-missing": (c) => `${q(c.path)} plugins[${c.subject ?? ""}] has no 'name'`,
  "entry-name-invalid": (c) =>
    `${q(c.path)} plugin ${q(c.subject)} has an invalid name: 1 to 64 characters of a-z, 0-9, '-' and '.', starting and ending alphanumeric, no '--' or '..'`,
  "entry-name-duplicate": (c) => `${q(c.path)} lists plugin ${q(c.subject)} more than once; 'install ${c.subject ?? ""}' would be ambiguous`,
  "entry-source-missing": (c) => `${q(c.path)} plugin ${q(c.subject)} has no 'source'`,
  "entry-source-escapes-root": (c) =>
    `${q(c.path)} plugin ${q(c.subject)} has source ${q(c.detail)} outside the marketplace root; a source is a directory inside the marketplace`,
};

const WARNING_MESSAGES: Readonly<Record<MarketplaceWarningKind, Sentence>> = {
  "entry-source-unsupported": (c) =>
    `plugin ${q(c.subject)}${at(c.path)} has source ${q(c.detail)}, a form Stigmer does not fetch (only a directory inside the marketplace); not offered`,
  "entry-directory-missing": (c) =>
    `plugin ${q(c.subject)}${at(c.path)} names directory ${q(c.detail)}, which the marketplace does not contain; not offered`,
  "entry-not-a-plugin": (c) =>
    `plugin ${q(c.subject)}${at(c.path)} names directory ${q(c.detail)}, which holds no plugin manifest; not offered`,
};

/** The marketplace reader's collector, bound to the marketplace vocabulary. */
export class MarketplaceFindings extends FindingCollector<MarketplaceErrorKind, MarketplaceWarningKind> {
  constructor() {
    super(ERROR_MESSAGES, WARNING_MESSAGES);
  }
}
