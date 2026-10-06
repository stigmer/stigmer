// The run zone's answer when a `/runs/<id>` address resolves to no run: an
// unknown id, a run the caller cannot see, or a run without a session. It
// names what is missing ("Run not found") rather than showing the generic
// 404, because the route itself exists. Same shape as the app's not-found
// page and the desktop console's run page.
import Link from "next/link";
import { FileQuestion } from "lucide-react";

export function RunNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-muted mx-auto flex size-12 items-center justify-center rounded-full">
          <FileQuestion className="text-muted-foreground size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Run not found</h1>
          <p className="text-muted-foreground text-sm">
            The run you&apos;re looking for doesn&apos;t exist or you don&apos;t
            have access to it.
          </p>
        </div>

        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
