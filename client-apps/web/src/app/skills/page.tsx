"use client";

import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/resource-list";
import { ResourceSearchCard } from "@stigmer/react/catalog";
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
        layout="grid"
        renderItem={(result) => (
          <Link href={`/skills/${result.id}`} className="block">
            <ResourceSearchCard result={result} />
          </Link>
        )}
      />
    </>
  );
}
