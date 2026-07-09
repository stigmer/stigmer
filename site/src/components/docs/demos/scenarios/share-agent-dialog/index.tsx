"use client";

import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ShareAgentDialog } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { PreviewProvider } from "@scenar/preview/runtime";
import { connectFixture } from "@scenar/preview/connect";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import {
  BillingAccountSchema,
  CreditBalanceSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { UpdateAgentSharingInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { DemoDetailShell } from "../../shared/DemoDetailShell";

const DEMO_ORG = "acme";

function buildDemoAgent() {
  const agent = samples.agent({
    name: "support-agent",
    org: DEMO_ORG,
    description:
      "Handles customer support requests using company knowledge.",
  });
  agent.spec = create(AgentSpecSchema, {
    description: agent.spec!.description,
    instructions: agent.spec!.instructions,
    sharing: {
      enabled: true,
      allowedOrigins: ["https://acme.com"],
    },
  });
  return agent;
}

const previewFixtures = [
  // Echo the submitted sharing config back on the agent — the dialog
  // adopts the server's returned state, so the demo round-trips honestly.
  connectFixture(AgentCommandController, "updateSharing", (input) => {
    const agent = buildDemoAgent();
    agent.spec!.sharing = (input as UpdateAgentSharingInput).sharing;
    return agent;
  }),
  connectFixture(BillingCommandController, "getOrCreateBillingAccount", () =>
    create(BillingAccountSchema, {
      balance: create(CreditBalanceSchema, {
        availableMicros: BigInt(42_180_000),
      }),
    }),
  ),
];

export function ShareAgentDialogDemo() {
  const [open, setOpen] = useState(true);

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <DemoDetailShell>
        <div className="flex justify-center p-4">
          {open ? (
            <ShareAgentDialog
              open
              onOpenChange={setOpen}
              agent={buildDemoAgent()}
              buildShareUrl={(org, slug) =>
                `https://app.stigmer.ai/chat/${org}/${slug}`
              }
              modal={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent-hover"
            >
              Reopen Share dialog
            </button>
          )}
        </div>
      </DemoDetailShell>
    </PreviewProvider>
  );
}
