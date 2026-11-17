---
type: llm
---

PASS if the answer explains access as the docs do: the analysts get the Organization's **Member** role, which starts conversations with the Agents shared with the Organization; an Agent's general access is **Organization** by default, which lets them run it and see how it is set up without changing it; an Organization **Viewer** cannot start conversations at all. It must say that the open-source edition grants roles on the Organization only: giving one person Editor on one Agent (the reconciler) is Stigmer Enterprise and Cloud. On open source the choices are making the ops lead an Admin (who manages every Agent, more than asked) or moving to Enterprise or Cloud for a per-Agent Editor grant. Welcome but optional: admins own every Agent whatever its general access; Members may create Agents of their own while the Organization allows it.

FAIL if the answer tells them to grant Editor on the reconciler on the open-source server, invents a per-Agent permission setting or command, says Organization Viewers can run Agents, or says Members can change Agents an admin created.
