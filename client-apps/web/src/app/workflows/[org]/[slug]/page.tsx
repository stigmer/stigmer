import { LegacyWorkflowDetailRedirect } from "@/domain/workflow/LegacyWorkflowRedirects";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

// A server-side redirect() must not be used here: with dynamic params it
// bakes a fixed target into the static export (see useLegacyPathRedirect).
export default function Page() {
  return <LegacyWorkflowDetailRedirect />;
}
