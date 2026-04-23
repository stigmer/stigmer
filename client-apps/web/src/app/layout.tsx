import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Nunito, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "@/providers/Providers";
import { AppShell } from "@/domain/_shared/layout/AppShell";
import { SessionNavigationProvider } from "@/domain/session/session-navigation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  preload: false,
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  preload: false,
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  preload: false,
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Stigmer — Build agents that work for your business",
  description:
    "Open-source AI agent platform that lets you turn domain knowledge and tools into agents your applications can call via API.",
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${nunito.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=localStorage.getItem("stgm-theme-preset");var m={corporate:"stgm-theme-corporate",startup:"stgm-theme-startup",friendly:"stgm-theme-friendly",fintech:"stgm-theme-fintech"};if(p&&m[p])document.documentElement.classList.add(m[p])}catch(e){}`,
          }}
        />
        <Providers>
          <SessionNavigationProvider>
            <AppShell>
              {children}
            </AppShell>
          </SessionNavigationProvider>
        </Providers>
      </body>
    </html>
  );
}
