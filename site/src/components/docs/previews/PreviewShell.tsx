"use client";

import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import {
  DEMO_CONTENT_ZOOM,
  DEMO_DETAIL_CLASSES,
} from "../demos/shared/tokens";

export interface PreviewShellProps {
  readonly client: Stigmer;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Shared layout wrapper for component previews on SDK reference pages.
 *
 * Sets up {@link StigmerProvider} with the given demo client, applies
 * the standard detail-demo styling ({@link DEMO_DETAIL_CLASSES}),
 * and scales the content with {@link DEMO_CONTENT_ZOOM}.
 *
 * Pass `className` to append additional classes to the outer container
 * (e.g. `"rounded-t-none"` when nested under a toggle bar).
 */
export function PreviewShell({ client, children, className }: PreviewShellProps) {
  return (
    <StigmerProvider client={client}>
      <div className={`${DEMO_DETAIL_CLASSES}${className ? ` ${className}` : ""}`}>
        <div className="p-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
          {children}
        </div>
      </div>
    </StigmerProvider>
  );
}
