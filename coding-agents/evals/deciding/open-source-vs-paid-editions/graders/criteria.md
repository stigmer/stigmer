---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says Stigmer open source is free under Apache 2.0, run by you, and complete for one Organization, not a trial.
- Says Stigmer Enterprise, the same server with a license key on your own infrastructure (an annual license), is what adds more than one Organization and per-resource sharing.
- Says Stigmer Cloud, the managed service, is what adds the Slack and WhatsApp channels and the platform operated for you.

**FAIL if**

- It says the open-source edition is a trial, or caps Agents, runs or users in ways the docs don't name.
- It puts Slack or WhatsApp channels in open source.
- It mixes up the Enterprise Cloud plan (run by Stigmer) with the Stigmer Enterprise edition (self-hosted).
- It says a paid edition includes model usage or a Stigmer-hosted model.
- It invents prices, plans or features the docs don't name.
- It says the open-source server holds more than one Organization or has per-resource sharing.

**Welcome**

- In every edition Agents run on your own model provider key, and Stigmer runs no model of its own.
- Open source runs on a laptop, one server or Kubernetes.
- Enterprise also adds Teams and invitations, identity federation and the access history.
- Cloud also adds hosted sign-in, and plans and billing.
- The Cloud plans: Free, Team at $99, Business at $499, Enterprise Cloud quoted, with agent hours included.
- Enterprise's code is public in the repository's `ee/` directory.
- Moving between editions is a configuration change, not a rewrite.
- Open source carries the full platform contract: Agents, Skills, Sessions and MCP servers through the same API, CLI and SDKs.
