---
type: llm
---

PASS if the agent read the person's own Stigmer (by the `stigmer` CLI, such as `stigmer get agent invoice-checker` and `stigmer get skill vendor-aliases`, or by the plugin's MCP tools; any route counts) and reports:
- that `invoice-checker` uses one Skill, `vendor-aliases` (attached through `skill_refs`);
- what that Skill tells the Agent, as read from the Skill itself: when matching invoices by vendor, treat a vendor's several spellings as one vendor and name it by the first spelling, with its groups (Northwind Traders, Contoso Supplies, Fabrikam and their other names); its description is the trigger ("Use when matching invoices by vendor").

Welcome but optional: that a Skill's description is always in the Agent's context and its body loads when the job calls for it; that the Agent's instructions also tell it to match vendors by the names the Skill lists; that a reference with no version follows the Skill's latest version.

FAIL if it names Skills the Agent does not have, describes the Skill's content without having read it (guessing from its name), answers only from the docs without looking at their Stigmer, or changes anything (applies, pushes, edits, tags or deletes a resource) when the person asked only to look.
