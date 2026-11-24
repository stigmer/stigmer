/**
 * The prompt a person pastes into their coding agent to set Stigmer up in
 * their app, in the words every surface gives it.
 *
 * The docs front page shows it by importing it (`<SetupPrompt />`,
 * site/src/components/visuals/setup-prompt.ts). Three surfaces spell it out,
 * because none of them can import this file: the setup page's fenced block
 * (docs/getting-started/coding-agent.mdx), which each release's door walk
 * reads from the live page by its first words
 * (test/install/lib/coding-agent-door.mjs); the console's first question
 * (sdk/react/src/session/first-question/FirstQuestion.tsx), in a published
 * package; and the plugin's README (coding-agents/plugin/README.md).
 * brand/__tests__/coding-agent-prompt.test.ts holds every copy equal to this
 * one, whitespace collapsed.
 */
export const CODING_AGENT_PROMPT =
  "Set up Stigmer for this project. Install its command line (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run `stigmer coding-agent`, and follow what it prints.";
