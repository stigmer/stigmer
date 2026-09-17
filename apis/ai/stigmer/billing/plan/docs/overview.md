A Plan is a catalog entry on Stigmer Cloud: the bundle of entitlements (limits
and features) a customer buys, and the terms that buy it. A plan is bought
through one of two instruments, a Subscription for an organization on Stigmer
Cloud or a License for a self-hosting customer. A plan is immutable once
created; to change its terms, create a new plan and retire the old one, which
stays readable so existing subscriptions can show what they bought.

Plans belong to the platform, not to an organization, and are created by
platform operators; the limits and prices of the plans on offer are set on
each plan row, never in this contract. Any signed-in caller may read the
catalog.

```yaml
apiVersion: billing.stigmer.ai/v1
kind: Plan
metadata:
  name: Team
  slug: team
spec:
  instrument: subscription
  entitlements:
    features:
      - channels
      - sharing
  description: "Channels and sharing for a growing team."
```
