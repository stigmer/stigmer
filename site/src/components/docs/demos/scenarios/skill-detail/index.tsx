"use client";

import { SkillDetailView } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { PreviewProvider } from "@scenar/preview/runtime";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { DEMO_DETAIL_CLASSES } from "../../shared/tokens";

const DEMO_ORG = "acme";

const SKILL_MD = `---
name: return-policy
description: Acme Corp return and refund policy. Use when customers ask about returns, exchanges, refunds, or warranty claims.
---

# Return Policy

## Standard Returns

Customers may return unused items within 30 days of purchase for a full refund. Items must be in original packaging with all tags attached.

## Exceptions

The following items cannot be returned:
- Personalized or custom-made products
- Perishable goods
- Digital downloads after activation
- Items marked "Final Sale"

## Refund Processing

- **Credit card**: Refund appears within 5–10 business days
- **Store credit**: Issued immediately upon return approval
- **Original payment method**: Always refund to the original method unless the customer requests store credit

## Escalation Rules

- Refunds over $500 require manager approval
- Returns past the 30-day window require a case-by-case review
- Warranty claims follow the manufacturer's policy, not this return policy
`;

const demoSkill = samples.skill({
  name: "return-policy",
  org: DEMO_ORG,
  description:
    "Acme Corp return and refund policy. Use when customers ask about returns, exchanges, refunds, or warranty claims.",
  skillMd: SKILL_MD,
});

const previewFixtures = [
  connectFixture(SkillQueryController, "getByReference", () => demoSkill),
];

export function SkillDetail() {
  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <div className={DEMO_DETAIL_CLASSES}>
        <div className="p-4">
          <SkillDetailView org={DEMO_ORG} slug="return-policy" />
        </div>
      </div>
    </PreviewProvider>
  );
}
