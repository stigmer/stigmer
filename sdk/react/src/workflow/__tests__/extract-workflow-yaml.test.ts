import { describe, it, expect } from "vitest";
import { extractWorkflowYaml } from "../extract-workflow-yaml";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

function makeExecution(messages: Array<{ type: number; content: string }>) {
  return { status: { messages } } as any;
}

describe("extractWorkflowYaml", () => {
  it("extracts YAML from single code block", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content:
          "Here is the workflow:\n```yaml\nname: test\nversion: 1.0\n```\nEnjoy!",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe("name: test\nversion: 1.0");
    expect(result!.explanation).toContain("Here is the workflow:");
    expect(result!.explanation).toContain("Enjoy!");
  });

  it("takes last block when multiple YAML blocks present", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content:
          "First:\n```yaml\nfirst: block\n```\nSecond:\n```yaml\nsecond: block\n```\nDone.",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe("second: block");
  });

  it("accepts ```yml variant", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content: "Here:\n```yml\nname: test\n```",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe("name: test");
  });

  it("returns null when no YAML block in AI message", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content: "Just some prose without any code blocks.",
      },
    ]);
    expect(extractWorkflowYaml(exec)).toBeNull();
  });

  it("returns null when only human messages", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_HUMAN,
        content: "```yaml\nname: test\n```",
      },
    ]);
    expect(extractWorkflowYaml(exec)).toBeNull();
  });

  it("returns null for null execution", () => {
    expect(extractWorkflowYaml(null)).toBeNull();
  });

  it("returns null for empty messages array", () => {
    const exec = makeExecution([]);
    expect(extractWorkflowYaml(exec)).toBeNull();
  });

  it("returns null when AI message has empty content", () => {
    const exec = makeExecution([
      { type: MessageType.MESSAGE_AI, content: "" },
    ]);
    expect(extractWorkflowYaml(exec)).toBeNull();
  });

  it("skips AI messages without YAML scanning in reverse", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content: "```yaml\nname: early\n```",
      },
      {
        type: MessageType.MESSAGE_AI,
        content: "This AI message has no YAML blocks at all.",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe("name: early");
  });

  it("finds YAML from last AI message", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content: "Just prose here, no fenced blocks.",
      },
      {
        type: MessageType.MESSAGE_AI,
        content: "```yaml\nname: latest\nversion: 2.0\n```",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe("name: latest\nversion: 2.0");
  });

  it("extracts explanation from surrounding prose", () => {
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content:
          "I created a workflow for you.\nHere it is:\n```yaml\nname: test\n```\nLet me know if you need changes.",
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.explanation).toContain("I created a workflow for you.");
    expect(result!.explanation).toContain("Let me know if you need changes.");
    expect(result!.explanation).not.toContain("```");

    const lines = result!.explanation.split("\n");
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("handles special regex characters in YAML content", () => {
    const yamlContent =
      'env:\n  pattern: ".*"\n  value: ${VAR}\n  keys: [key1, key2]\n  path: file.txt';
    const exec = makeExecution([
      {
        type: MessageType.MESSAGE_AI,
        content: `Here:\n\`\`\`yaml\n${yamlContent}\n\`\`\`\nDone.`,
      },
    ]);
    const result = extractWorkflowYaml(exec);
    expect(result).not.toBeNull();
    expect(result!.yaml).toBe(yamlContent);
    expect(result!.explanation).toContain("Done.");
  });
});
