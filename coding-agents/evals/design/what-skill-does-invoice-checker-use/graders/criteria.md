---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Reports that `invoice-checker` uses one Skill, `vendor-aliases`, as found in the person's own Stigmer (any route counts, for example `stigmer get agent invoice-checker` or the plugin's MCP tools).
- Reports what the Skill tells the Agent, as read from the Skill: treat a vendor's several spellings as one vendor named by its first spelling, with its groups (Northwind Traders, Contoso Supplies, Fabrikam).

**FAIL if**

- It names Skills the Agent does not have.
- It describes the Skill's content in terms the Skill doesn't hold, such as guessed from its name.
- It presents an answer drawn only from the docs, with no sign it looked at their Stigmer.
- It reports that it changed anything (applied, pushed, edited, tagged or deleted a resource) when the person asked only to look.

**Welcome**

- The Skill's description is its trigger ("Use when matching invoices by vendor").
- A Skill's description is always in the Agent's context, and its body loads when the job calls for it.
- The Agent's instructions also tell it to match vendors by the names the Skill lists.
- A reference with no version follows the Skill's latest version.
- Each group lists that vendor's other spellings, and the Skill applies when matching invoices by vendor.
- The Skill is attached through the Agent's `skill_refs`.
