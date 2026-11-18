---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the analysts get the Organization's **Member** role, which lets them start conversations with Agents shared with the Organization (the default general access), such as `invoice-checker` and `reconciler`, without changing them.
- Says the open-source edition grants roles on the Organization only, so giving Priya **Editor** on the reconciler alone is a Stigmer Enterprise and Stigmer Cloud feature.
- Says that on open source the choices are making Priya an Admin (who then manages every Agent, more than asked) or moving to Enterprise or Cloud for a per-Agent Editor grant.

**FAIL if**

- It tells them to grant Editor on the reconciler on the open-source server.
- It invents a per-Agent permission setting or command.
- It says Organization Viewers can run Agents.
- It says Members can change Agents an admin created.

**Welcome**

- An Organization **Viewer** sees what is shared with the Organization but cannot start conversations, so it is the wrong role for the analysts.
- Admins own every Agent whatever its general access.
- Members may create Agents of their own while the Organization's **Members can create agents** policy is on (an admin turns it off under **Settings > Organization preferences**).
- Members can also see how the Agents shared with the Organization are set up.
