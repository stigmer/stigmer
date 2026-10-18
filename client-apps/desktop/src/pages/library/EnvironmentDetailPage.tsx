import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentDetailView, useBreadcrumbOverride } from "@stigmer/react-sdk";
import { useCanonicalDetailSlug } from "./canonical-slug";

/**
 * Thin shell around the SDK's `EnvironmentDetailView` (editors, rename,
 * access, export, delete), wired identically to the web page with React
 * Router in place of Next navigation.
 */
export default function EnvironmentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => () => setLabel(null), [setLabel]);

  const [loadedSlug, setLoadedSlug] = useState<string | undefined>(undefined);
  const moveToSlug = useCanonicalDetailSlug("environments", org, slug, loadedSlug);

  const handleResourceLoad = useCallback(
    (loaded: Environment) => {
      setLabel(loaded.metadata?.name || loaded.metadata?.slug || "Environment");
      setLoadedSlug(loaded.metadata?.slug);
    },
    [setLabel],
  );

  if (!org || !slug) return null;

  return (
    <EnvironmentDetailView
      org={org}
      slug={slug}
      onResourceLoad={handleResourceLoad}
      onDeleted={() => navigate("/library/environments")}
      onRenamed={(renamed) => moveToSlug(renamed.metadata?.slug ?? "")}
    />
  );
}
