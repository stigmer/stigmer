"use client";

// The last resort, when the console itself can't draw: Next.js replaces the
// root layout with this page, so it brings its own document and the global
// styles, and stands on the same frame as signing in so even this page looks
// like Stigmer. The failure's reference goes into Copy details, never on the
// screen. It renders outside every provider, so the help line draws nothing.

import "./globals.css";
import { ErrorMessage } from "@stigmer/react-sdk";
import { StandaloneScreen } from "@stigmer/react-sdk/console";
import { StigmerLogo } from "@/auth/StigmerLogo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <StandaloneScreen mark={<StigmerLogo size={40} />}>
          <ErrorMessage
            error={error}
            title="The console stopped working."
            comfort="Your agents and conversations are safe on the server; trying again usually brings it back."
            retry={reset}
            reference={error.digest}
          />
        </StandaloneScreen>
      </body>
    </html>
  );
}
