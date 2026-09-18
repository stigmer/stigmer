A Subscription is an organization's binding to a Plan on Stigmer Cloud. An
organization has at most one active subscription, and an organization with
none is on the Free plan. What the organization may do is derived from its
plan on every read through `getEntitlements`, never stored on the
subscription.

Subscriptions are system-created: the payment system opens and moves them,
and an organization's billing administrators change or cancel the plan through
the command RPCs. You never author one as a manifest; the shape below is what
`getForOrganization` returns.

```yaml
apiVersion: billing.stigmer.ai/v1
kind: Subscription
metadata:
  name: acme
  org: acme
spec:
  plan_id: pln_01j5q3k7m8r2s4tnz2hfp0q0a1
status:
  state: active
  current_period_start: "2026-09-01T00:00:00Z"
  current_period_end: "2026-10-01T00:00:00Z"
```
