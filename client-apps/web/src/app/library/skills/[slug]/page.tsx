import { SkillDetailPage } from "./SkillDetailPage";

export async function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}

export default function Page() {
  return <SkillDetailPage />;
}
