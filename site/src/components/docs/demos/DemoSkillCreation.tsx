"use client";

import { useMemo } from "react";
import { StigmerProvider, MessageThread } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import {
  skillCreationScenario,
  skillCreationExecution,
} from "./scenarios/skill-creation";

/**
 * Embedded skill-creation conversation for "Your first Skill".
 *
 * Renders a realistic MessageThread showing a user asking the AI to
 * create a return-policy Skill. Backed by fixture data — no live
 * backend required.
 */
export function DemoSkillCreation() {
  const client = useMemo(
    () => createDemoClient(skillCreationScenario),
    [],
  );

  return (
    <div className="not-prose mx-auto max-w-2xl">
      <StigmerProvider client={client}>
        <MessageThread executions={[skillCreationExecution]} />
      </StigmerProvider>
    </div>
  );
}
