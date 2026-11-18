---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says an agent SDK is a library inside their app that gives them the agent loop, so they still build the server around it (storage, sandboxes, approvals, an API), whereas Stigmer is that server behind their app.
- Ties that to the hour-long spreadsheet job: each customer's agent gets its own computer (a sandbox that keeps its files between turns) and works on a job for hours.
- Ties it to the leak worry: each customer's agents, files and keys stay apart from every other customer's.
- Says it is not either/or: Stigmer can run a Session on Anthropic's Claude Agent SDK as its Harness (Claude Agent), on the company's own Anthropic key, as well as on its default Stigmer harness.

**FAIL if**

- It says Stigmer cannot run long jobs.
- It says Stigmer supplies the model.
- It says the Claude Agent SDK cannot be used with Stigmer.
- It invents capabilities the docs don't name.
- It says the open-source server alone gives each customer an Organization of its own (it holds one Organization; per-customer Organizations come with the editions that include them).

**Welcome**

- Building it yourself also means the queues, retries and tenant checks around the agent.
- Stigmer's own harness is built on LangChain's deepagents on LangGraph.js.
- Agents ask before acting on what you mark as needing a yes.
- Stigmer is open source.
- Each customer can get an Organization of their own on the editions that include it; on the open-source server each customer's keys live in a vault of their own.
- With Stigmer you define an Agent once, call it from any service and change it in one place, while an embedded SDK means redeploying every app that embeds it when the agent changes.
- A job carries on where it was when the server or runner restarts.
