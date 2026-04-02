"use client";

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { ResourceListView } from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/demo";

const MOCK_SKILLS = [
  samples.searchResult({
    kind: ApiResourceKind.skill,
    name: "Product Catalog",
    slug: "product-catalog",
    description: "Technical specs and pricing for all product lines.",
  }),
  samples.searchResult({
    kind: ApiResourceKind.skill,
    name: "Escalation Runbook",
    slug: "escalation-runbook",
    description: "Step-by-step process for customer issue escalation.",
  }),
];

interface SkillsListViewProps {
  /** When true, the "Create Skill" button pulses to draw attention. */
  highlightCreate?: boolean;
}

/**
 * Skills list page for the guided-tour demo.
 *
 * Wraps the real `ResourceListView` from `@stigmer/react` with a page
 * header and "Create Skill" button. The list is fed by fixture data
 * via `samples.searchResult()` — no live backend required.
 */
export function SkillsListView({ highlightCreate }: SkillsListViewProps) {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <div className="relative">
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

      <ResourceListView items={MOCK_SKILLS} isLoading={false} />
    </div>
  );
}
