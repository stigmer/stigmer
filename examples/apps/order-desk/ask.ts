/**
 * Asks the order desk agent a customer's question and prints its answer.
 *
 *   npm run ask
 *   npm run ask -- "Has order 1043 shipped?"
 *
 * The conversation names the vault that holds the tool server's key: a
 * conversation your app starts uses the vaults it names and no others, so
 * this is how the agent's `${ORDER_DESK_TOKEN}` header gets its value.
 */
import { sendAndWait } from "@stigmer/client";
import { org, stigmer } from "./client.js";
import { AGENT_SLUG, VAULT_SLUG } from "./spec.js";

const question = process.argv[2] ?? "Where is order 1042, and can I still return it?";

const turn = await sendAndWait(stigmer, {
  org,
  sessionSpec: {
    agentRef: { org, slug: AGENT_SLUG },
    vaults: [{ org, slug: VAULT_SLUG }],
  },
  message: question,
});
if (turn.phase !== "completed") {
  console.error(`The turn ended ${turn.phase}: ${turn.error}`);
  process.exit(1);
}

console.log(`> ${question}\n\n${turn.answer}`);
