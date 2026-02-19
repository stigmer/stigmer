# Cross-Platform Auth & Integration Patterns — Research Summary

**Date:** 2026-02-19
**Source:** ChatGPT Deep Research
**Verdict:** Strong industry consensus — Token Exchange (RFC 8693) + SDK/Proxy pattern

---

## Key Findings

| # | Finding | Impact on Our Design |
|---|---------|---------------------|
| 1 | Industry standard is **Token Exchange** (RFC 8693) — exchange external JWT for a platform-native token | Stigmer should implement a token exchange endpoint, not accept external JWTs directly on API endpoints |
| 2 | Leading providers ship **SDKs** (Stripe, Twilio, OpenAI, Temporal) as the primary integration surface | Stigmer should ship a Go SDK (proxy library) for integrators |
| 3 | **API key ≠ portable identity** — opaque API keys should be resolved locally, then represented as a short-lived JWT for cross-platform calls | For MVP, support JWT only; API keys are a Platform A concern |
| 4 | Separate **user-context** (on-behalf-of) and **system-level** (M2M) auth flows | Two flows: per-user via token exchange, system ops via service account |
| 5 | Auth0 Custom Token Exchange exists but requires Enterprise plan | Use direct JWKS-based federation instead (free, standard) |
| 6 | OIDC UserInfo endpoint is standard for fetching profile data from access tokens | Stigmer can call UserInfo during token exchange to get email/name/picture |
| 7 | Config-based proxies (Envoy, OAuth2 Proxy) work for standard behavior; **code-based SDKs** work when custom logic is needed | Custom authz requires SDK approach, not pure config |
| 8 | "Ship both SDK + optional pre-built image" is a common dual-shipping approach | Provide SDK for custom cases, Docker image for simple internal deployments |

## Case Studies Reviewed

Stripe Connect, Twilio, Vercel, GitHub Apps, LaunchDarkly, Datadog, New Relic, Temporal Cloud, AWS Marketplace, Snowflake Partner Connect, OpenAI API

## Relevant Standards

- OAuth 2.0 Token Exchange (RFC 8693)
- JWT Bearer Assertion (RFC 7523)
- OpenID Connect Core 1.0 (UserInfo endpoint)
- OpenID Federation 1.0 (Feb 2026 — heavier than needed for two controlled platforms)

---

_Summary generated: 2026-02-19_
_Full report: `04.report.gpt.md`_
