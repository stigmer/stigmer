"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ResourceList, SkillSearchCard } from "@/components/resource-list";
import { useSkillList } from "@/hooks/skills/useSkillList";

export default function SkillsPage() {
  const data = useSkillList();

  return (
    <>
      <TopBar
        title="Skills"
        description="Browse and search the skill catalog"
      />
      <ResourceList
        kindLabel="skills"
        data={data}
        renderItem={(result) => <SkillSearchCard result={result} />}
      />
    </>
  );
}
