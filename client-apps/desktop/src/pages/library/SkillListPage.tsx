import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import {
  useSkillList,
  useActiveOrgSlug,
  ResourceListView,
} from "@stigmer/react";
import type { ResourceListScope } from "@stigmer/react";

export default function SkillListPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();

  const [scope, setScope] = useState<ResourceListScope>("org");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { skills, isLoading, error, totalCount, totalPages, refetch } =
    useSkillList(org || null, { scope, query, page });

  const handleScopeChange = (s: ResourceListScope) => {
    setScope(s);
    setPage(1);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <ResourceListView
        layout="grid"
        items={skills}
        isLoading={isLoading}
        error={error}
        totalCount={totalCount}
        totalPages={totalPages}
        currentPage={page}
        onSearchChange={setQuery}
        searchPlaceholder="Search skills…"
        scope={scope}
        onScopeChange={handleScopeChange}
        onPageChange={setPage}
        onItemClick={(item) =>
          navigate(`/library/skills/${item.org}/${item.slug}`)
        }
        emptyIcon={<Sparkles className="size-10 text-muted-foreground" />}
        emptyTitle="No skills found"
        onRetry={refetch}
        aria-label="Skill list"
      />
    </div>
  );
}
