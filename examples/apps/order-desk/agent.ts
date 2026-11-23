/**
 * Makes the order desk agent on Stigmer, or updates it: run it again with
 * a new tunnel address and the agent follows.
 *
 *   PUBLIC_URL=https://<your tunnel> ORDER_DESK_TOKEN=<the server's key> npm run agent
 *
 * Two calls. The key goes into a vault, `order-desk`, because a key never
 * goes into an agent: the agent's header names it as `${ORDER_DESK_TOKEN}`,
 * and each conversation that names the vault fills it in (ask.ts). Then
 * the agent: no computer, one MCP server at the public address, and that
 * server's tools as its only tools (spec.ts).
 */
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { isNotFound } from "@stigmer/client";
import { org, stigmer } from "./client.js";
import { KEY_NAME, VAULT_SLUG, orderDeskSpec, type OrderDeskSpec } from "./spec.js";

const token = process.env.ORDER_DESK_TOKEN ?? "";
if (token === "") {
  console.error("Set ORDER_DESK_TOKEN to the key you started the server with.");
  process.exit(1);
}
let spec: OrderDeskSpec;
try {
  spec = orderDeskSpec(process.env.PUBLIC_URL ?? "");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const vault = await stigmer.vault.getByReference({ org, slug: VAULT_SLUG }).catch((error: unknown) => {
  if (!isNotFound(error)) throw error;
  return stigmer.vault.create({ name: VAULT_SLUG, org, description: "The order desk tool server's key" });
});
await stigmer.vault.setSecrets({
  vault: { org, vault: { case: "id", value: vault.metadata!.id } },
  secrets: { [KEY_NAME]: { value: token } },
});

const agent = await stigmer.agent.apply({
  name: spec.name,
  slug: spec.slug,
  org,
  description: spec.description,
  instructions: spec.instructions,
  computer: Computer.NONE,
  mcpServers: [{ ...spec.mcpServer, headers: { ...spec.mcpServer.headers } }],
  tools: [...spec.tools],
});

console.log(`Agent ${org}/${agent.metadata!.slug} uses the tools at ${spec.mcpServer.url}, with no computer.`);
console.log(`Its server's key is in vault ${org}/${VAULT_SLUG}. Ask it something: npm run ask`);
