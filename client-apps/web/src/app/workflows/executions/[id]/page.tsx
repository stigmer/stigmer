import { LegacyWorkflowExecutionRedirect } from "@/domain/workflow/LegacyWorkflowRedirects";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

// A server-side redirect() must not be used here: with dynamic params it
// bakes a fixed target into the static export (see useLegacyPathRedirect).
export default function Page() {
  return <LegacyWorkflowExecutionRedirect />;
}
