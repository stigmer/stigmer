import SessionDetailPage from "./SessionDetailPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return <SessionDetailPage />;
}
