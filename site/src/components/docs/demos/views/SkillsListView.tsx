"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { ResourceListView } from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/demo";

const EXISTING_SKILLS = [
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.skill,
    name: "Product Catalog",
    slug: "product-catalog",
    description: "Technical specs and pricing for all product lines.",
  }),
  samples.searchResult({
    id: "skl-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.skill,
    name: "Escalation Runbook",
    slug: "escalation-runbook",
    description: "Step-by-step process for customer issue escalation.",
  }),
];

const NEW_SKILL = samples.searchResult({
  id: "skl-00000000-0000-0000-0000-000000000003",
  kind: ApiResourceKind.skill,
  name: "Return Policy",
  slug: "return-policy",
  description: "Acme Corp's customer return and refund policy.",
});

interface SkillsListViewProps {
  /** When true, the "Create Skill" button pulses to draw attention. */
  highlightCreate?: boolean;
  /** When true, the newly created "Return Policy" skill is appended with a highlight flash. */
  showNewSkill?: boolean;
}

/**
 * Skills list page for demo scenarios.
 *
 * Wraps the real `ResourceListView` from `@stigmer/react` with a page
 * header and "Create Skill" button. The list is fed by fixture data
 * via `samples.searchResult()` — no live backend required.
 */
export function SkillsListView({
  highlightCreate,
  showNewSkill,
}: SkillsListViewProps) {
  const items = useMemo(
    () => (showNewSkill ? [...EXISTING_SKILLS, NEW_SKILL] : EXISTING_SKILLS),
    [showNewSkill],
  );

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <div className="relative" data-cursor-target="create-skill">
          <div className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
            <Plus className="h-3 w-3" />
            Create Skill
          </div>

          {highlightCreate && (
            <motion.span
              className="absolute inset-0 rounded-md border border-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              aria-hidden
            />
          )}
        </div>
      </div>

      <div className="relative">
        <ResourceListView items={items} isLoading={false} />
        {showNewSkill && <NewSkillHighlight />}
      </div>
    </div>
  );
}

/**
 * Brief highlight flash on the last item in the list to draw the
 * reader's eye to the newly created skill.
 */
function NewSkillHighlight() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[52px] rounded-md bg-primary/5"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 2, ease: "easeInOut" }}
      aria-hidden
    />
  );
}
