"use client";

/**
 * The journey's last step, reached from the dashboard's first-steps card and
 * the launcher's next line rather than the settings navigation: the
 * organization named, an invite link, and who has joined. Invite links take
 * this console's own `/invite/<token>`.
 */
import { BringOthersIn } from "@stigmer/react-sdk";
import { MEMBERS_HREF, renderJourneyLink } from "@/domain/journey/journey-links";

export default function BringOthersInPage() {
  return <BringOthersIn membersHref={MEMBERS_HREF} renderLink={renderJourneyLink} />;
}
