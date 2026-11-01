import type { Metadata } from "next";
import { Providers } from "@/providers/Providers";
import { AppShell } from "@/domain/_shared/layout/AppShell";
import { AppNavigationProvider } from "@/domain/_shared/navigation/app-navigation";
import { SessionNavigationProvider } from "@/domain/session/session-navigation";
import { consoleFonts } from "./fonts/fonts";
import { POSITIONING } from "../../../../brand/positioning";
import "./globals.css";

const fontVariables = consoleFonts.map((font) => font.variable).join(" ");

// The tab names the app; the description is the one sentence every surface
// reads from brand/positioning.ts.
export const metadata: Metadata = {
  title: POSITIONING.name,
  description: POSITIONING.oneSentence,
  icons: {
    icon: [
      { url: "/favicon-dark.svg", type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-light.svg", type: "image/svg+xml", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.ico", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-dark-16x16.png", sizes: "16x16", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-dark-32x32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-light.ico", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-light-16x16.png", sizes: "16x16", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-light-32x32.png", sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: light)" },
    ],
    apple: [
      { url: "/apple-touch-icon-dark.png", sizes: "180x180", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: "/apple-touch-icon-light.png", sizes: "180x180", type: "image/png", media: "(prefers-color-scheme: light)" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The font variables go on <html>: the theme's font stacks
  // (`--stgm-font-sans`, `--stgm-font-mono`) are declared on :root and resolve
  // there, so a variable defined on <body> comes too late and every page falls
  // back to the computer's own font (stigmer#1564).
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <AppNavigationProvider>
            <SessionNavigationProvider>
              <AppShell>
                {children}
              </AppShell>
            </SessionNavigationProvider>
          </AppNavigationProvider>
        </Providers>
      </body>
    </html>
  );
}
