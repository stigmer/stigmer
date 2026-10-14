// Pins the Cloud's plan move (harness/plan-move.ts): the setup session, the
// customer read from the billing account, a signed payment_method.attached
// for that customer on the webhook lane, then changePlan to the catalog's
// `team` row, in that order; and a move that cannot finish throws with what
// it saw rather than leave the organization on Free. The clients are stubs
// and the webhook lane is a listener on loopback; no server is booted.
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { FAKE_CARD } from "../fake-stripe";
import { moveToTeamPlan, type PlanMoveClients } from "../plan-move";

const ORG = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "whsec_conformance";

interface Received {
  readonly signature: string;
  readonly body: string;
}

let lane: Server | undefined;

afterEach(async () => {
  lane?.close();
  lane = undefined;
});

/** A webhook lane answering `status`, recording every post. */
async function startLane(status: number): Promise<{ baseUrl: string; received: Received[] }> {
  const received: Received[] = [];
  lane = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ signature: String(req.headers["stripe-signature"] ?? ""), body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = status;
      res.end(status === 200 ? "" : "refused");
    });
  });
  lane.listen(0, "127.0.0.1");
  await once(lane, "listening");
  const address = lane.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, received };
}

/** Clients that record each call in order, with a catalog of the given slugs. */
function stubClients(options: { customer?: string; slugs?: string[] } = {}): { clients: PlanMoveClients; calls: string[]; changed: unknown[] } {
  const calls: string[] = [];
  const changed: unknown[] = [];
  const clients = {
    billingCommand: {
      createPaymentMethodSetupSession: async (input: { org: string }) => {
        calls.push(`setup:${input.org}`);
        return {};
      },
    },
    billingQuery: {
      getBillingAccount: async (input: { org: string }) => {
        calls.push(`account:${input.org}`);
        return { stripeCustomerId: options.customer ?? "cus_conf_1" };
      },
    },
    planQuery: {
      list: async () => {
        calls.push("plans");
        return { entries: (options.slugs ?? ["free-pack", "team"]).map((slug) => ({ metadata: { slug, id: `pln_${slug}` } })) };
      },
    },
    subscriptionCommand: {
      changePlan: async (input: unknown) => {
        calls.push("changePlan");
        changed.push(input);
        return {};
      },
    },
  } as unknown as PlanMoveClients;
  return { clients, calls, changed };
}

describe("moveToTeamPlan", () => {
  it("saves a card for the organization's own customer, signed as Stripe signs, then changes the plan to the catalog's team row", async () => {
    const { baseUrl, received } = await startLane(200);
    const { clients, calls, changed } = stubClients();

    await moveToTeamPlan(clients, { baseUrl, signingSecret: SECRET }, ORG);

    expect(calls).toEqual([`setup:${ORG}`, `account:${ORG}`, "plans", "changePlan"]);
    expect(changed).toEqual([{ org: ORG, planId: "pln_team" }]);
    expect(received).toHaveLength(1);
    const [post] = received;
    const event = JSON.parse(post?.body ?? "{}") as { type: string; data: { object: Record<string, unknown> } };
    expect(event.type).toBe("payment_method.attached");
    expect(event.data.object).toMatchObject({ object: "payment_method", type: "card", customer: "cus_conf_1", card: FAKE_CARD });
    const [stamp, digest] = (post?.signature ?? "").split(",");
    const timestamp = stamp?.slice("t=".length) ?? "";
    expect(digest).toBe(`v1=${createHmac("sha256", SECRET).update(`${timestamp}.${post?.body ?? ""}`).digest("hex")}`);
  });

  it("throws when the setup session made no customer, before posting anything", async () => {
    const { baseUrl, received } = await startLane(200);
    const { clients, calls } = stubClients({ customer: "" });

    await expect(moveToTeamPlan(clients, { baseUrl, signingSecret: SECRET }, ORG)).rejects.toThrow(
      `moveToTeamPlan(${ORG}): the setup session left the billing account with no Stripe customer`,
    );
    expect(received).toEqual([]);
    expect(calls).not.toContain("changePlan");
  });

  it("throws with the lane's answer when the webhook refuses the card", async () => {
    const { baseUrl } = await startLane(400);
    const { clients, calls } = stubClients();

    await expect(moveToTeamPlan(clients, { baseUrl, signingSecret: SECRET }, ORG)).rejects.toThrow(
      `moveToTeamPlan(${ORG}): the webhook lane answered 400 to payment_method.attached: refused`,
    );
    expect(calls).not.toContain("changePlan");
  });

  it("throws when the catalog lists no team plan", async () => {
    const { baseUrl } = await startLane(200);
    const { clients, calls } = stubClients({ slugs: ["free-pack"] });

    await expect(moveToTeamPlan(clients, { baseUrl, signingSecret: SECRET }, ORG)).rejects.toThrow(
      `moveToTeamPlan(${ORG}): the catalog lists no 'team' plan`,
    );
    expect(calls).not.toContain("changePlan");
  });
});
