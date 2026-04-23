import { SkillDetailPage } from "@/domain/library/skills/SkillDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <SkillDetailPage />;
}
