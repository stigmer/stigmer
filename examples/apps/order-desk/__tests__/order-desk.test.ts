/**
 * The order desk, held to what the README promises: its tool server answers
 * both tools to a caller with the key and refuses one without it, and the
 * agent it makes has no computer, reaches its server at a public https
 * address, and names the key as a run value, never its text.
 *
 * Run by the repository's root suite (`npm run test:root` chains
 * `npm test -w @stigmer/example-order-desk`), with no Stigmer running: the
 * agent's spec is plain data (spec.ts), so nothing here needs a server or a
 * built SDK.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ORDERS, REFUND_POLICY } from "../orders.js";
import { orderDeskServer } from "../server.js";
import { KEY_NAME, SERVER_NAME, orderDeskSpec } from "../spec.js";

const TOKEN = "test-token-0123456789";

describe("the tool server", () => {
  const server = orderDeskServer(TOKEN, () => {});
  let url: URL;

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(token: string | undefined): Promise<Client> {
    const client = new Client({ name: "order-desk-test", version: "1.0.0" });
    const headers: Record<string, string> = token === undefined ? {} : { Authorization: `Bearer ${token}` };
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  }

  test("answers both tools to a caller with the key", async () => {
    const client = await connect(TOKEN);
    try {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["look_up_order", "refund_policy"]);
      for (const tool of listed.tools) {
        assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is read-only`);
      }

      const order = await client.callTool({ name: "look_up_order", arguments: { order_id: "1042" } });
      assert.notEqual(order.isError, true);
      assert.deepEqual(JSON.parse(textOf(order)), ORDERS["1042"]);

      const unknown = await client.callTool({ name: "look_up_order", arguments: { order_id: "9999" } });
      assert.equal(unknown.isError, true);
      assert.equal(textOf(unknown), "No order 9999. Order numbers are four digits, like 1042.");

      const policy = await client.callTool({ name: "refund_policy", arguments: {} });
      assert.equal(textOf(policy), REFUND_POLICY);
    } finally {
      await client.close();
    }
  });

  test("refuses a caller without the key, or with another", async () => {
    for (const token of [undefined, "wrong-token"]) {
      await assert.rejects(connect(token), (error: { code?: number }) => error.code === 401, `token ${String(token)} is refused`);
    }
  });
});

describe("the agent's spec", () => {
  const PUBLIC = "https://orders-1042.trycloudflare.com";

  test("has no computer and uses only its own server's tools", () => {
    const spec = orderDeskSpec(PUBLIC);
    assert.equal(spec.computer, "none");
    assert.deepEqual(spec.tools, [`mcp__${SERVER_NAME}`]);
    assert.equal(spec.mcpServer.name, SERVER_NAME);
    assert.equal(spec.mcpServer.url, `${PUBLIC}/mcp`);
  });

  test("names the server's key as a run value, never its text", () => {
    const spec = orderDeskSpec(PUBLIC);
    assert.deepEqual(spec.mcpServer.headers, { Authorization: `Bearer \${${KEY_NAME}}` });
    assert.ok(!JSON.stringify(spec).includes(TOKEN));
  });

  test("refuses an address an agent without a computer can't reach, before Stigmer does", () => {
    for (const address of [
      "http://localhost:8787",
      "https://localhost:8787",
      "https://app.localhost",
      "https://127.0.0.1:8787",
      "https://10.0.0.7",
      "https://172.20.1.1",
      "https://192.168.1.20",
      "https://169.254.169.254",
      "https://[::1]:8787",
      "https://[fd00::1]",
    ]) {
      assert.throws(() => orderDeskSpec(address), /can't reach .*: give it the public https address your tunnel printed/, address);
    }
  });

  test("refuses an address that is not https, since the key travels in a header", () => {
    assert.throws(() => orderDeskSpec("http://orders.example.com"), /must be https, because the server's key travels with every call/);
    assert.throws(() => orderDeskSpec("not a url"), /PUBLIC_URL is not an address: not a url/);
  });
});

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as ReadonlyArray<{ type: string; text?: string }>;
  return content.map((block) => block.text ?? "").join("");
}
