import ExecutionRoute from "./ExecutionRoute";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return <ExecutionRoute />;
}
