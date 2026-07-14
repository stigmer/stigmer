"use client";

import { useState } from "react";
import { create, clone } from "@bufbuild/protobuf";
import { ShareAgentDialog } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { PreviewProvider } from "@scenar/preview/runtime";
import { connectFixture } from "@scenar/preview/connect";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import {
  AgentShareSchema,
  type AgentShare,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import {
  BillingAccountSchema,
  CreditBalanceSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { DemoDetailShell } from "../../shared/DemoDetailShell";

const DEMO_ORG = "acme";
const DEMO_SLUG = "support-agent";

function buildDemoAgent() {
  return samples.agent({
    name: DEMO_SLUG,
    org: DEMO_ORG,
    description:
      "Handles customer support requests using company knowledge.",
  });
}

// Sharing lives in its own AgentShare resource (decision 011): the dialog
// edits exactly the share it is given and applies changes to it.
function buildDemoShare(): AgentShare {
  return create(AgentShareSchema, {
    metadata: {
      id: "ash_demo",
      org: DEMO_ORG,
      slug: DEMO_SLUG,
      name: DEMO_SLUG,
    },
    spec: {
      agentRef: { org: DEMO_ORG, slug: DEMO_SLUG },
      enabled: true,
      allowedOrigins: ["https://acme.com"],
    },
  });
}

// The demo share is module state so the apply fixture round-trips honestly:
// the dialog adopts the server's returned share, and a reopen re-reads it.
let demoShare = buildDemoShare();

const previewFixtures = [
  // Echo the applied configuration back — apply is the dialog's single
  // commit path.
  connectFixture(AgentShareCommandController, "apply", (input) => {
    const applied = clone(AgentShareSchema, input as AgentShare);
    applied.metadata!.id = "ash_demo";
    demoShare = applied;
    return applied;
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
              share={demoShare}
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
