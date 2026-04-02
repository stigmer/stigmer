"use client";

import { motion } from "framer-motion";
import { FileText, Plus } from "lucide-react";

const MOCK_SKILLS = [
  {
    name: "Product Catalog",
    description: "Technical specs and pricing for all product lines.",
  },
  {
    name: "Escalation Runbook",
    description: "Step-by-step process for customer issue escalation.",
  },
];

interface SkillsListViewProps {
  /** When true, the "Create Skill" button pulses to draw attention. */
  highlightCreate?: boolean;
}

/**
 * Mock skills list page for the guided-tour demo.
 *
 * Shows a page header, a couple of existing skill cards, and a
 * "Create Skill" button. This is a static illustration — no real
 * data fetching or interaction.
 */
export function SkillsListView({ highlightCreate }: SkillsListViewProps) {
  return (
    <div className="flex h-full flex-col p-4">
      {/* Page header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <div className="relative">
          <div
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground"
          >
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

      {/* Skill cards */}
      <div className="flex flex-col gap-2">
        {MOCK_SKILLS.map((skill) => (
          <div
            key={skill.name}
            className="flex items-start gap-3 rounded-md border border-border bg-background p-3"
          >
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                {skill.name}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {skill.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
