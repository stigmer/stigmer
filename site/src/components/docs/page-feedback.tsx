import { MessageSquarePlus } from "lucide-react";
import { SITE_CONFIG } from "@/lib/constants";

interface PageFeedbackProps {
  pageTitle: string;
  pageUrl: string;
}

function buildIssueUrl(pageTitle: string, pageUrl: string): string {
  const fullUrl = `${SITE_CONFIG.url}${pageUrl}`;

  const title = `Docs feedback: ${pageTitle}`;

  const body = `**Page**: [${pageTitle}](${fullUrl})

---

<!-- Describe the issue below. What's wrong, missing, or confusing? -->

`;

  const params = new URLSearchParams({
    labels: "documentation",
    title,
    body,
  });

  return `${SITE_CONFIG.githubUrl}/issues/new?${params.toString()}`;
}

export function PageFeedback({ pageTitle, pageUrl }: PageFeedbackProps) {
  return (
    <div className="mt-12 border-t border-fd-border pt-6">
      <a
        href={buildIssueUrl(pageTitle, pageUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <MessageSquarePlus className="size-4" />
        Report an issue with this page
      </a>
    </div>
  );
}
