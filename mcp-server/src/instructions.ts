// What an agent connected to the full roster is told before it calls a tool:
// the server's MCP instructions. A client puts them into the agent's system
// prompt whether or not any skill loads (Claude Code shows them under "MCP
// Server Instructions"), so they are the one guidance an agent with these
// tools and nothing else is sure to read.
//
// AGENT_RULES is the one rules text for acting on Stigmer for a person. The
// coding-agent plugin's front-door skill carries it verbatim, and its test
// holds the two equal, so the rules live once. Every client sends the whole
// instructions text in every session's prompt, so it is kept short; a test
// bounds it.
//
// Only the full roster carries them. The narrow rosters (channels,
// conversation, memory) are attached to agents running inside Stigmer, whose
// job these rules don't describe.

/** The rules for acting on Stigmer for a person, as Markdown bullets. */
export const AGENT_RULES = [
  "- Reads run freely: search, get, list, and reading the docs.",
  "- Deleting, overwriting, cancelling a run, a key, someone's access, or spending money the person didn't ask to spend: propose it first.",
  "  Name exactly what would go or change (each agent, skill or run by name, and that an agent or skill goes with every version of it), say when it can't be undone, and act only after the person says yes in this conversation.",
  '  "Delete everything" is a request to list what would go, not a yes.',
  "- Put `-f`/`--force` on a `stigmer` command only when the person approved that exact command.",
  "- A run's approval is the person's to give: answer `allow` or `allow_all` only when they said so, for that call.",
  "- A key never passes through you or this chat. The person enters it where the CLI or the console asks for it.",
  "- When a guard stops a call, say what was about to happen and why it stopped, then ask; never work around it.",
].join("\n");

/** The full roster's MCP instructions: what these tools are for, how to answer from the docs, and the rules. */
export const SERVER_INSTRUCTIONS = [
  "Stigmer runs AI agents for the users of a developer's own product. These tools read and manage the person's Stigmer agents, skills and runs, and read Stigmer's docs.",
  "",
  "To answer a question about Stigmer: search_docs, then read_doc the page whole, answer from what it says today, and cite its Source URL. When the docs don't answer, say so and point to https://github.com/stigmer/stigmer/issues.",
  "A question comparing Stigmer with an agent SDK or framework: read concepts/harnesses too. Why something fails or hangs: give the cause the page or the run names before the fix.",
  "",
  "Runs: list_runs finds an agent's runs, newest first; get_run reads one (its error says why it failed); get_run_outputs reads what it saved; get_run_scores how it was graded.",
  "",
  "Acting on Stigmer for a person:",
  "",
  AGENT_RULES,
].join("\n");
