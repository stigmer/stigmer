import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-muted mx-auto flex size-12 items-center justify-center rounded-full">
          <FileQuestion className="text-muted-foreground size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Page not found</h1>
          <p className="text-muted-foreground text-sm">
            The page you&apos;re looking for doesn&apos;t exist or has been
            moved.
          </p>
        </div>

        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
