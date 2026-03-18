import SessionPage from "./SessionPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return <SessionPage />;
}
