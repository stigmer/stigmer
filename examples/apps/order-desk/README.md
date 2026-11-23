# Order desk: an agent whose tools live on your server

A shop's app keeps its orders and its refund rules on its own server. This
example serves two of them as tools, makes a Stigmer agent that uses them, and
asks it a customer's question:

```text
> Where is order 1042, and can I still return it?

Order 1042 — a Linen shirt (size M) — has already been delivered on November
12, 2026 via UPS (tracking number 1Z999AA10123456784). Since it is not a
final-sale item, you can return it as long as it is unworn and has its tags
attached — just make sure to do so by December 12, 2026. Once your return
arrives, your refund will be processed within 5–10 business days.
```

The agent has no computer. Everything it does is a call to your server, so it
needs no sandbox: on Stigmer Cloud its turns run on runners shared by every
conversation without a computer, with nothing to start or wake, so it answers
sooner.

| File | What it does |
| --- | --- |
| [`server.ts`](server.ts) | The tool server: `look_up_order` and `refund_policy` over MCP, refusing any call without its key |
| [`orders.ts`](orders.ts) | The shop's data, in memory |
| [`spec.ts`](spec.ts) | The agent: no computer, your server as its only tools, the key named as `${ORDER_DESK_TOKEN}` |
| [`agent.ts`](agent.ts) | Saves the key in a vault and the agent on Stigmer |
| [`ask.ts`](ask.ts) | Starts a conversation that names the vault, and prints the answer |

## Why your server needs a public address

An agent without a computer reaches only the internet, wherever Stigmer runs,
`stigmer up` on your own laptop included. Stigmer refuses
to save such an agent with a server on `localhost` or a private network, and
`spec.ts` refuses it first. On your laptop, a tunnel gives your server a public
`https` address. Anyone who finds that address can call it, so the server
refuses every call without its key.

## Run it

You need Node.js 22, Stigmer running (`stigmer up`, with your Anthropic key in
`ANTHROPIC_API_KEY`), and
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
for the tunnel. Copy this folder out, then in it:

```bash
npm install
export ORDER_DESK_TOKEN=$(openssl rand -hex 24)
npm start
```

In a second terminal, give the server a public address:

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints an address like `https://<words>.trycloudflare.com`. A new address
can take a minute to reach your computer's DNS; until it does, the agent's turn
fails saying the address "does not resolve to a public address", and asking
again a minute later works. In a third terminal, with the same
`ORDER_DESK_TOKEN`:

```bash
export ORDER_DESK_TOKEN=<the same key>
PUBLIC_URL=https://<words>.trycloudflare.com npm run agent
npm run ask
npm run ask -- "Has order 1043 shipped, and can I return it?"
```

The server's terminal shows each tool call as it arrives. A quick tunnel's
address changes each time it starts: run `npm run agent` again with the new one,
and the agent follows.

## On Stigmer Cloud

Set three variables before `npm run agent` and `npm run ask`:

```bash
export STIGMER_SERVER=https://api.stigmer.ai
export STIGMER_API_KEY=<a service account's key>
export STIGMER_ORG=<your Organization's slug>
```

In production, your tool server already has a public address; use it as
`PUBLIC_URL` and drop the tunnel.

[Run an Agent whose tools live on your server](https://stigmer.ai/docs/guides/integrations/tools-on-your-own-server)
walks through each step.
