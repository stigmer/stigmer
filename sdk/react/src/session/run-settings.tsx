"use client";

// The session view's run settings as a row of the composer's configure menu:
// how the next turn runs (engine, model, target), the Environment the
// conversation got, and the session's auto-approve switch. They lived in
// the inspector's Config facet, which an embed does not carry; in the
// composer they sit beside the model picker, where the turn they shape is
// sent.

import { useMemo } from "react";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { HARNESS_META } from "@stigmer/react-core/internal";
import { RunSettingsIcon } from "../composer/icons.js";
import type { ComposerSetting } from "../composer/SessionComposer.js";
import { environmentsNotApplying } from "../environment/resolve.js";
import { useEnvironmentAvailability } from "../server-info.js";
import { conversationEnvironment } from "./conversation-environment.js";
import { RunConfigSection, type RunConfigSectionProps } from "./facets/SetupTab.js";
import type { useSessionPageFlow } from "./useSessionPageFlow.js";

/** The run-settings row for `flow`; `canArmAutoApprove` false leaves the switch out (module header). */
export function useRunSettings(
  flow: ReturnType<typeof useSessionPageFlow>,
  canArmAutoApprove: boolean,
  curated: boolean,
): ComposerSetting {
  const modelId = flow.model[0] ?? flow.agentRunDefaults?.modelName;
  const { harness, executionTarget, autoApproveAll, setAutoApproveAll } = flow;
  const session = flow.conv.session;
  return useMemo(() => {
    const autoApprove = canArmAutoApprove ? { armed: autoApproveAll, onChange: setAutoApproveAll } : undefined;
    const row = runSettingsRow({ harness, executionTarget, modelId, environment: undefined, autoApprove, curated });
    return {
      item: row.item,
      panel: (
        <ConversationRunSettings
          harness={harness}
          executionTarget={executionTarget}
          modelId={modelId}
          autoApprove={autoApprove}
          curated={curated}
          session={session}
        />
      ),
    };
  }, [harness, executionTarget, modelId, autoApproveAll, setAutoApproveAll, canArmAutoApprove, curated, session]);
}

/**
 * The run settings of a conversation, with the Environment it got. Drawn
 * only when someone opens the row, so the server-info read the Environment
 * line needs is made then, not on every render of the conversation.
 */
function ConversationRunSettings({
  session,
  ...settings
}: Omit<RunConfigSectionProps, "environment"> & { readonly session: Session | null }) {
  // The Environment the conversation got, from its own record; where it has
  // none, why none applies here. Nothing until the conversation is read.
  const availability = useEnvironmentAvailability();
  const recorded = session?.status?.environment;
  const recordedSource = session?.status?.environmentSource;
  const environment =
    recordedSource === undefined
      ? undefined
      : conversationEnvironment(
          { environment: recorded, environmentSource: recordedSource },
          environmentsNotApplying(availability, settings.executionTarget),
        );
  return <RunConfigSection {...settings} environment={environment} />;
}

/** The configure menu's row for these settings, and the panel it opens. */
export function runSettingsRow(settings: RunConfigSectionProps): ComposerSetting {
  const engine = settings.curated ? undefined : (HARNESS_META[settings.harness]?.label ?? settings.harness);
  const target = settings.curated
    ? undefined
    : settings.executionTarget === "local"
      ? "Local"
      : settings.executionTarget === "cloud"
        ? "Cloud"
        : undefined;
  const armed = settings.autoApprove?.armed === true;
  return {
    item: {
      id: "run-settings",
      icon: <RunSettingsIcon />,
      label: "Run settings",
      count: armed ? 1 : 0,
      detail: [engine, target, armed ? "auto-approve on" : undefined].filter(Boolean).join(" · "),
    },
    panel: <RunConfigSection {...settings} />,
  };
}
