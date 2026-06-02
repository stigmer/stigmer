import type { WorkflowGraphNode } from "../workflow-graph-model";
import { taskKindToString } from "../workflow-graph-conversions";

/**
 * Serializes a single graph node to its YAML representation.
 *
 * Produces a standalone YAML block for the task, suitable for
 * display in the inspector's "View YAML" action.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export function taskToYaml(node: WorkflowGraphNode): string {
  const kindStr = taskKindToString(node.kind);
  const lines: string[] = [];

  lines.push(`- name: ${node.taskName}`);
  lines.push(`  kind: ${kindStr}`);

  if (Object.keys(node.config).length > 0) {
    lines.push(`  task_config:`);
    const configYaml = objectToYamlLines(node.config as Record<string, unknown>, 4);
    lines.push(...configYaml);
  }

  if (node.export?.as) {
    lines.push(`  export:`);
    lines.push(`    as: "${node.export.as}"`);
  }

  if (node.flow?.then) {
    lines.push(`  flow:`);
    lines.push(`    then: ${node.flow.then}`);
  }

  return lines.join("\n");
}

function objectToYamlLines(obj: Record<string, unknown>, indent: number): string[] {
  const prefix = " ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      const needsQuotes = value.includes("${") || value.includes(":") || value.includes("#") || value === "";
      lines.push(`${prefix}${key}: ${needsQuotes ? `"${value}"` : value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${prefix}${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const itemLines = objectToYamlLines(item as Record<string, unknown>, indent + 4);
          if (itemLines.length > 0) {
            lines.push(`${prefix}  - ${itemLines[0].trimStart()}`);
            lines.push(...itemLines.slice(1).map((l) => `${prefix}  ${l.slice(indent)}`));
          }
        } else {
          lines.push(`${prefix}  - ${item}`);
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${prefix}${key}:`);
      lines.push(...objectToYamlLines(value as Record<string, unknown>, indent + 2));
    }
  }

  return lines;
}
