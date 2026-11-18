"use client";

import { PageNotFound } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export default function NotFound() {
  return <PageNotFound homeHref="/" renderLink={renderJourneyLink} />;
}
