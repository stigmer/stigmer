---
type: llm
---

PASS if the answer says an agent SDK or framework is a library inside your app: it gives you the agent loop, and you still build the server around it (storage, sandboxes, approvals, an API, queues, retries and tenant checks, and a redeploy of every app that embeds it when the agent changes), whereas Stigmer is a server behind your app: you define an Agent once, call it from any service and change it in one place. It must tie that to their two needs: each customer's agent gets its own computer (a sandbox that keeps its files between turns) and works on a job for hours, carrying on where it was when the server or runner restarts; and each customer's agents, files and keys stay apart from every other customer's. It must also say it is not either/or: Stigmer can run a Session on Anthropic's Claude Agent SDK as its harness (Claude Agent), on the company's own Anthropic key, as well as on its own default Stigmer harness. Welcome but optional: Stigmer's own harness is built on LangChain's deepagents on LangGraph.js; agents ask before acting on what you mark as needing a yes; Stigmer is open source.

FAIL if it says Stigmer cannot run long jobs, that Stigmer supplies the model, that the Claude Agent SDK cannot be used with Stigmer, or invents capabilities the docs don't name.
