import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { DownloadPage } from "@/components/pages/DownloadPage";

export const metadata: Metadata = {
  title: "Download",
  description:
    "Download Stigmer Desktop for macOS, Windows, or Linux. Manage local runners, launch sessions from your browser, and work with your agents from the system tray.",
  openGraph: {
    title: `Download Stigmer Desktop | ${SITE_CONFIG.name}`,
    description:
      "Download Stigmer Desktop — local runner management, system tray, and browser-to-desktop deep links.",
  },
};

export default function Page() {
  return <DownloadPage />;
}
