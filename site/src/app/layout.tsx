import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0f1a",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://stigmer.ai"),
  title: {
    default: "Stigmer — AI-Powered Workflow Automation",
    template: "%s | Stigmer",
  },
  description:
    "Build, run, and scale AI-powered workflows with Stigmer. Define workflows in YAML, execute with powerful CLI, integrate with any AI model. Open source.",
  keywords: [
    "Stigmer",
    "AI workflows",
    "workflow automation",
    "AI agents",
    "CLI",
    "YAML",
    "open source",
    "LLM orchestration",
  ],
  authors: [{ name: "Stigmer Team" }],
  creator: "Stigmer",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: "Stigmer — AI-Powered Workflow Automation",
    description:
      "Build, run, and scale AI-powered workflows with Stigmer. Define workflows in YAML, execute with powerful CLI, integrate with any AI model.",
    siteName: "Stigmer",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Stigmer - AI-Powered Workflow Automation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stigmer — AI-Powered Workflow Automation",
    description:
      "Build, run, and scale AI-powered workflows with Stigmer. Define workflows in YAML, execute with powerful CLI, integrate with any AI model.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
