# Sales Website CTA Link Strategy

**Date**: April 24, 2026

## Summary

All CTAs on the Stigmer sales site (Contact Sales, Join Waitlist, Start Free, Sign In) pointed to the same URL (`https://app.stigmer.ai`), which showed a login page regardless of user intent. This work differentiates each CTA by intent: Contact Sales gets a dedicated form page, Join Waitlist gets an inline email capture on the pricing card, and both submit to a new Cloudflare Worker that creates labeled GitHub Issues in a private `stigmer/leads` repo for lightweight lead tracking.

## Problem Statement

A colleague (Raghav) clicked "Contact Sales" on the pricing page and was redirected to a login page with no context about his inquiry. The same thing happened with "Join Waitlist." Every outbound CTA resolved to `https://app.stigmer.ai`, which broke the promise of the button label and lost high-intent leads.

### Pain Points

- "Contact Sales" led to a generic login page instead of a contact form
- "Join Waitlist" led to the same login page instead of capturing the email
- No mechanism to track or follow up on enterprise inquiries or waitlist signups
- No differentiation between four distinct user intents (signup, signin, waitlist, sales)

## Solution

Three-layer approach: differentiate the frontend CTAs by intent, build a Cloudflare Worker to receive form submissions, and use GitHub Issues as an interim CRM until Stigmer's own CRM ships.

## Implementation Details

### Sales site changes (stigmer/stigmer)

- **`site/src/lib/constants.ts`**: Added `contactSalesUrl` (`/contact-sales`), `waitlistUrl` (`/pricing#waitlist`), and `leadsFormUrl` (worker endpoint) to `SITE_CONFIG`.
- **`site/src/components/pages/PricingPage.tsx`**: Refactored into `TierCard` and `WaitlistForm` components. The Pro tier now renders an inline email input + submit button instead of a link. The Enterprise tier links to `/contact-sales`. Both forms POST to the leads worker with a timing-based anti-bot check (`_t` field).
- **`site/src/app/contact-sales/page.tsx`** and **`site/src/components/pages/ContactSalesPage.tsx`**: New `/contact-sales` route with a form (name, email, company, message), honeypot spam field, timing check, and success/error states.

### Cloudflare Worker (stigmer/stigmer-cloud)

- **`backend/services/leads-form-receiver/`**: New Cloudflare Worker mirroring the `auth0-webhooks-receiver` pattern. Routes: `POST /submit/contact-sales` and `POST /submit/waitlist`. Validates input, checks honeypot and submission timing, then creates a labeled GitHub Issue via the GitHub API.
- **Anti-spam**: Origin header validation, server-side honeypot check, timing check (rejects submissions under 2 seconds), and Cloudflare's built-in bot protection. Turnstile verification code is included but dormant — can be activated if spam becomes a problem at higher volume.

### Service-hub registration (stigmer/stigmer-cloud)

- **Service manifest**: `leads-form-receiver` registered as `cloudflare_worker_script` with `pipelineProvider: platform`.
- **VariablesGroup**: GitHub repo owner/name and allowed origin.
- **SecretsGroup**: Fine-grained GitHub PAT scoped to `issues:write` on `stigmer/leads` only.

### GitHub repo (stigmer/leads)

- Private repo with five labels: `contact-sales`, `waitlist/pro`, `status/new`, `status/contacted`, `status/closed`.
- Team tracks leads as GitHub Issues — assign, label, comment, close.

## Benefits

- Enterprise prospects land on a proper contact form instead of a login page
- Waitlist signups are captured without leaving the pricing page
- Every lead is tracked as a GitHub Issue with structured labels
- Zero new tooling — GitHub notifications cover the < 5 leads/week volume
- Clean migration path to Stigmer's CRM when it ships

## Impact

- **Sales site visitors**: Contact Sales and Join Waitlist now deliver on their promise
- **Team**: Leads appear as GitHub Issues with notifications — no leads lost
- **Architecture**: The Cloudflare Worker follows the proven `auth0-webhooks-receiver` pattern and is deployed through the same Planton pipeline

## Related Work

- `auth0-webhooks-receiver` — the Cloudflare Worker pattern this follows
- Stigmer CRM (future) — will replace GitHub Issues as the lead tracking backend

---

**Status**: ✅ Production Ready (pending merge to main for pipeline deployment)
