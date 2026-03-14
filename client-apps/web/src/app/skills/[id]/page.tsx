import SkillDetailPage from "./SkillDetailPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return <SkillDetailPage />;
}
