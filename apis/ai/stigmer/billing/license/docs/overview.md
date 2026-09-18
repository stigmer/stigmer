A License is a signed grant of entitlements to a self-hosting customer for a
term. Stigmer Cloud issues it; the customer's Stigmer Enterprise deployment
verifies the signed ticket offline and reports its state through
`getLicenseStatus`. The customer is a value inside the license and need not
hold a Stigmer Cloud organization. A license is immutable once issued; a
renewal is a new license.

Licenses are issued by platform operators and belong to the platform, not to
an organization. The spec is what the operator issues; the status carries the
signed ticket the customer installs.

```yaml
apiVersion: billing.stigmer.ai/v1
kind: License
metadata:
  name: Acme Corp 2026
  slug: acme-corp-2026
spec:
  customer:
    id: cus_01j5q3k7m8r2s4tnz2hfp0q0b2
    display_name: Acme Corp
    contact_email: platform@acme.example
  plan_id: pln_01j5q3k7m8r2s4tnz2hfp0q0c3
  entitlements:
    features:
      - sso_enforcement
      - platform_client
      - channels
  term: paid
  expires_at: "2027-09-01T00:00:00Z"
  grace_until: "2027-10-01T00:00:00Z"
```
