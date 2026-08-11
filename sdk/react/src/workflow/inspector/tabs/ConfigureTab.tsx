"use client";

import { memo } from "react";
import type { WorkflowGraphNode, WorkflowGraphModel } from "../../workflow-graph-model.js";
import type { TaskKindDescriptor } from "../../types.js";
import { TaskConfigForm } from "../../TaskConfigForm.js";
import { BranchConditionBuilder } from "../../BranchConditionBuilder.js";
import { ApprovalFormBuilder } from "../../ApprovalFormBuilder.js";
import { AgentCallForm } from "../forms/AgentCallForm.js";
import { HttpCallForm } from "../forms/HttpCallForm.js";
import type { InspectorMutations } from "../types.js";

/** Props for {@link ConfigureTab}. */
export interface ConfigureTabProps {
  readonly node: WorkflowGraphNode;
  readonly graph: WorkflowGraphModel;
  readonly descriptor: TaskKindDescriptor | undefined;
  readonly kindString: string;
  readonly otherTaskNames: readonly string[];
  readonly onFieldChange: (fieldPath: string, value: unknown) => void;
  readonly mutations: InspectorMutations;
}

/**
 * Configure tab — the primary configuration surface for a selected task.
 *
 * Dispatches to specialized editors for `switch_case` and `human_input`,
 * or falls through to the generic schema-driven `TaskConfigForm`.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const ConfigureTab = memo(function ConfigureTab({
  node,
  graph,
  descriptor,
  kindString,
  otherTaskNames,
  onFieldChange,
  mutations,
}: ConfigureTabProps) {
  const isSwitchCase = kindString === "switch_case";
  const isHumanInput = kindString === "human_input";
  const isAgentCall = kindString === "agent_call";
  const isHttpCall = kindString === "http_call";

  if (isAgentCall) {
    return <AgentCallForm node={node} onFieldChange={onFieldChange} />;
  }

  if (isHttpCall) {
    return <HttpCallForm node={node} onFieldChange={onFieldChange} />;
  }

  if (isSwitchCase && mutations.onUpdateBranchRouting && mutations.onMigrateBranchHandle && mutations.onRemoveBranchEdges) {
    return (
      <div className="stg:px-3 stg:py-3">
        <BranchConditionBuilder
          nodeId={node.id}
          config={node.config}
          edges={graph.edges}
          allTaskNames={otherTaskNames as string[]}
          onUpdateConfig={onFieldChange}
          onUpdateBranchRouting={(handleId, target) =>
            mutations.onUpdateBranchRouting!(node.id, handleId, target)
          }
          onMigrateBranchHandle={(oldId, newId) =>
            mutations.onMigrateBranchHandle!(node.id, oldId, newId)
          }
          onRemoveBranchEdges={(handleId) =>
            mutations.onRemoveBranchEdges!(node.id, handleId)
          }
        />
      </div>
    );
  }

  if (isHumanInput && mutations.onUpdateBranchRouting && mutations.onMigrateBranchHandle && mutations.onRemoveBranchEdges) {
    return (
      <div className="stg:px-3 stg:py-3">
        <ApprovalFormBuilder
          nodeId={node.id}
          config={node.config}
          edges={graph.edges}
          allTaskNames={otherTaskNames as string[]}
          onUpdateConfig={onFieldChange}
          onUpdateBranchRouting={(handleId, target) =>
            mutations.onUpdateBranchRouting!(node.id, handleId, target)
          }
          onMigrateBranchHandle={(oldId, newId) =>
            mutations.onMigrateBranchHandle!(node.id, oldId, newId)
          }
          onRemoveBranchEdges={(handleId) =>
            mutations.onRemoveBranchEdges!(node.id, handleId)
          }
        />
      </div>
    );
  }

  if (descriptor && descriptor.fields.length > 0) {
    return (
      <TaskConfigForm
        fields={descriptor.fields}
        fieldGroups={descriptor.fieldGroups}
        config={node.config}
        onChange={onFieldChange}
      />
    );
  }

  return (
    <div className="stg:px-3 stg:py-4 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
      No configurable fields for this task kind.
    </div>
  );
});
