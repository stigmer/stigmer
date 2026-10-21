/**
 * The jobs the site shows Stigmer's agents doing inside other teams'
 * products. Each says whose product it is, what the customer asks for, what
 * the agent hands back, and where it asks first, the shape the vocabulary's
 * positioning section gives an example. The homepage's use-case cards and
 * the use-cases page both read this list; each entry's `id` is its anchor on
 * the page.
 */

export interface DocsLink {
  label: string;
  href: string;
}

export interface UseCase {
  id: string;
  /** Whose product the agent works in. */
  product: string;
  /** What the customer asks for. */
  asks: string;
  /** What the agent hands back. */
  handsBack: string;
  /** Where it stops and waits for a yes. */
  asksFirst: string;
  /** The docs for what the job is built with. */
  builtWith: readonly DocsLink[];
}

const FILES: DocsLink = { label: "Files", href: "/docs/concepts/files" };
const APPROVAL_FLOWS: DocsLink = { label: "Approval flows", href: "/docs/concepts/approval-flows" };
const MCP_SERVERS: DocsLink = {
  label: "MCP servers",
  href: "/docs/guides/integrations/connect-an-mcp-server",
};

export const USE_CASES: readonly UseCase[] = [
  {
    id: "accounting",
    product: "An accounting product",
    asks: "“What moved this quarter?”, with the ledger attached.",
    handsBack: "A variance report as a file, every account over or under budget flagged.",
    asksFirst: "Before it posts an adjusting entry to the books.",
    builtWith: [FILES, APPROVAL_FLOWS, MCP_SERVERS],
  },
  {
    id: "hr",
    product: "An HR product",
    asks: "To get next month's new hires ready, with the list attached.",
    handsBack: "Each hire's onboarding plan as a file, and the access requests drafted.",
    asksFirst: "Before it sends any request to the customer's IT team.",
    builtWith: [FILES, APPROVAL_FLOWS, MCP_SERVERS],
  },
  {
    id: "contracts",
    product: "A contract-management product",
    asks: "To check a supplier's contract against their standard terms.",
    handsBack: "A redline memo as a file.",
    asksFirst: "Before it sends anything to the supplier.",
    builtWith: [FILES, APPROVAL_FLOWS, MCP_SERVERS],
  },
  {
    id: "storefront",
    product: "An e-commerce product",
    asks: "To clean up their catalog, with the export attached.",
    handsBack: "A corrected catalog file, every change listed.",
    asksFirst: "Before it publishes the changes to the live store.",
    builtWith: [FILES, APPROVAL_FLOWS, MCP_SERVERS],
  },
  {
    id: "planton",
    product: "Planton, our DevOps product",
    asks: "To change their cloud setup.",
    handsBack: "The change, shown before it happens.",
    asksFirst: "Before it applies anything.",
    builtWith: [APPROVAL_FLOWS, MCP_SERVERS],
  },
];
