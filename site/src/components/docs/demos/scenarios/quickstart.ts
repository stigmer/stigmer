/**
 * Reference scenario: a minimal session conversation.
 *
 * Demonstrates how to compose {@link fixtures} and {@link samples} into a
 * working {@link DemoScenario}. This scenario provides enough fixtures to
 * render a basic session view with a message thread.
 */

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DemoScenario } from "@stigmer/react/demo";
import { buildScenario, fixtures, samples } from "@stigmer/react/demo";

const demoSession = samples.session({ subject: "Getting started with Stigmer" });
const demoAgent = samples.agent({ name: "Quickstart Agent" });
const demoInstance = samples.agentInstance({ name: "quickstart-instance" });

const demoExecution = samples.agentExecution({
  phase: ExecutionPhase.EXECUTION_COMPLETED,
  messages: [
    samples.humanMessage("Hello! How do I create my first agent?"),
    samples.aiMessage(
      "Welcome! Creating an agent is straightforward. You define an agent " +
        "resource with a name, instructions, and optionally connect tools " +
        "via MCP servers. Would you like me to walk you through the steps?",
    ),
    samples.humanMessage("Yes, please walk me through it."),
    samples.aiMessage(
      "Here's a quick overview:\n\n" +
        "1. **Define your agent** — Write instructions that describe what " +
        "the agent should do and how it should behave.\n" +
        "2. **Add domain knowledge** — Create skills with your business " +
        "rules, policies, or documentation.\n" +
        "3. **Connect tools** — Register MCP servers so the agent can take " +
        "actions in your systems.\n\n" +
        "Let me know which step you'd like to start with!",
    ),
  ],
});

export const quickstartScenario: DemoScenario = buildScenario(
  fixtures.session.get(() => demoSession),
  fixtures.session.list(() => samples.sessionList([demoSession])),
  fixtures.session.create(() => demoSession),
  fixtures.session.update(() => demoSession),

  fixtures.agentExecution.listBySession(() =>
    samples.agentExecutionList([demoExecution]),
  ),
  fixtures.agentExecution.create(() => demoExecution),
  fixtures.agentExecution.subscribe(() => [demoExecution]),
  fixtures.agentExecution.submitApproval(() => demoExecution),

  fixtures.agent.get(() => demoAgent),
  fixtures.agent.getByReference(() => demoAgent),
  fixtures.agent.getDefault(() => demoAgent),
  fixtures.agent.list(() =>
    samples.searchResponse([
      samples.searchResult({
        kind: ApiResourceKind.agent,
        name: "Quickstart Agent",
        slug: "quickstart-agent",
      }),
    ]),
  ),

  fixtures.agentInstance.get(() => demoInstance),
  fixtures.agentInstance.getByReference(() => demoInstance),
  fixtures.agentInstance.list(() => ({
    entries: [demoInstance],
    totalPages: 1,
  })),
  fixtures.agentInstance.create(() => demoInstance),

  fixtures.environment.list(() => ({
    entries: [samples.environment()],
    totalPages: 1,
  })),
  fixtures.environment.create(() => samples.environment()),
);
