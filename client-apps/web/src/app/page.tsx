import { SessionLauncher } from "@/components/session/SessionLauncher";
import { parseDraftParam } from "@/utils/draft-session";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams(
    typeof params.draft === "string" ? { draft: params.draft } : {},
  );
  const draftType = parseDraftParam(sp);

  return <SessionLauncher draftType={draftType} />;
}
