---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says this is what Stigmer is for: the open-source backend for the agents in their product, running behind their app the way a database does, on the company's own model key.
- Says Stigmer is not a coding agent: Claude Code, Cursor and Codex are for writing their own code, while Stigmer runs the agents they ship to customers, so the feature isn't built on Claude Code.
- Says each customer's agent can stop and ask before acting on anything marked as needing a yes, and carries on once a person in that company's HR approves or declines.

**FAIL if**

- It calls Stigmer a coding agent or a developer tool.
- It recommends building the customer-facing feature on Claude Code.
- It says Stigmer cannot pause for a person's yes.
- It invents features or SDKs the docs don't name.
- It says the open-source server gives each client company an Organization of its own (it holds one Organization; per-customer Organizations come with the editions that include them).

**Welcome**

- Each customer's agent has its own computer, a sandbox that keeps its files between turns.
- It works on a job for as long as it takes.
- The offer letter comes back as a File of the Session.
- Each client company can get an Organization of its own on the editions that include it; on the open-source server each customer's keys live in a vault of their own.
- The plugins they built for those coding tools work in Stigmer unchanged.
- The Python SDK for a Django backend.
- Each client company's agents, files and keys stay apart from every other's.
- The app calls Stigmer and Stigmer runs the agent.
