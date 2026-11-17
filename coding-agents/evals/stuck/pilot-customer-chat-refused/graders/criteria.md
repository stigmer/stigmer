---
type: llm
---

PASS if the answer says it is not a bug but the plan's agents-at-once limit: each plan sets how many of the Organization's conversations can have an agent awake at the same time, and Free allows 5; an agent is awake while it works and for a short while after its last turn, then sleeps; at the number, a new conversation (or a message that has to wake a sleeping agent) is refused, while a message to a conversation whose agent is awake never is. It must give the ways out: try again once a conversation goes idle or is deleted, or have an admin move to a larger plan in Settings → Billing (Team allows 25, Business 100), or contact support for more than any plan includes. Welcome but optional: running out of Free's monthly agent hours (30) is a different refusal that names the reset date; `stigmer usage hours` shows the hours; on Business the number is shared with child organizations.

FAIL if it blames the model key, the runner or the network; says the Free plan's agent hours ran out; invents a setting, flag or request to raise the number on Free; or says each child organization gets its own pool.
