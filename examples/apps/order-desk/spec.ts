/**
 * The order desk agent, as plain data: what agent.ts saves to Stigmer.
 * It has no computer, so it answers sooner and runs on Stigmer's shared
 * runners; its only tools are the ones server.ts serves, at the public
 * address the tunnel gave it; and its server's key is the run value
 * `${ORDER_DESK_TOKEN}`, which each conversation fills from the vault it
 * names (ask.ts), never the key's text.
 */

/** The agent's and the vault's slug. */
export const AGENT_SLUG = "order-desk";
export const VAULT_SLUG = "order-desk";
/** The secret the vault holds and the server's header reads. */
export const KEY_NAME = "ORDER_DESK_TOKEN";
/** The MCP server's name on the agent: its tools reach the model as `mcp__orders__<tool>`. */
export const SERVER_NAME = "orders";

export interface OrderDeskSpec {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly instructions: string;
  readonly computer: "none";
  readonly mcpServer: { readonly name: string; readonly url: string; readonly headers: Readonly<Record<string, string>> };
  readonly tools: readonly string[];
}

const INSTRUCTIONS = `You answer a shop's customers about their orders.
Look the order up with look_up_order before you say anything about it, and read refund_policy before you say whether something can be returned.
Answer in two or three sentences, with the dates and the tracking number the tools give you. Never guess an order's status.`;

/**
 * What a host reaches when it names this machine or a private network, in
 * words; undefined for an address on the internet. Stigmer refuses to save
 * an agent without a computer whose MCP server is at such an address, and
 * its runner refuses a name that resolves to one: the agent's turns run on
 * Stigmer's shared runners, which can't reach your machine and must never
 * reach their own network. This check meets the mistake first, in your
 * terminal.
 */
export function privateReachOf(host: string): string | undefined {
  const name = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return "this machine";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(name);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 0) return "this machine";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "a private network";
    if (a === 169 && b === 254) return "a link-local address";
    if (a === 100 && b >= 64 && b <= 127) return "a carrier's private network";
    return undefined;
  }
  if (name.includes(":")) {
    if (name === "::1" || name === "::") return "this machine";
    if (/^f[cd][0-9a-f]{0,2}:/.test(name)) return "a private network";
    if (/^fe[89ab][0-9a-f]?:/.test(name)) return "a link-local address";
    if (name.startsWith("::ffff:")) return privateReachOf(name.slice("::ffff:".length));
  }
  return undefined;
}

/** The agent, its MCP server at `publicUrl`'s `/mcp`. Throws when Stigmer would refuse the address. */
export function orderDeskSpec(publicUrl: string): OrderDeskSpec {
  let url: URL;
  try {
    url = new URL("/mcp", publicUrl);
  } catch {
    throw new Error(`PUBLIC_URL is not an address: ${publicUrl}`);
  }
  const reach = privateReachOf(url.hostname);
  if (reach !== undefined) {
    throw new Error(
      `An agent without a computer can't reach ${publicUrl}, which is ${reach}: give it the public https address your tunnel printed`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(`PUBLIC_URL must be https, because the server's key travels with every call: ${publicUrl}`);
  }
  return {
    name: "Order desk",
    slug: AGENT_SLUG,
    description: "Answers customers about their orders and returns, with the shop's own tools",
    instructions: INSTRUCTIONS,
    computer: "none",
    mcpServer: {
      name: SERVER_NAME,
      url: url.toString(),
      headers: { Authorization: `Bearer \${${KEY_NAME}}` },
    },
    tools: [`mcp__${SERVER_NAME}`],
  };
}
