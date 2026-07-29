import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, DM_Mono } from "next/font/google";
import { SITE_CONFIG } from "@/lib/constants";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  style: "italic",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Dark-only site: one theme color regardless of the OS preference.
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    default: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "AI agents",
    "agent platform",
    "business AI",
    "domain-aware agents",
    "tool orchestration",
    "human-in-the-loop",
    "durable execution",
    "Temporal orchestration",
    "MCP security",
    "gRPC agents",
    "open source agents",
    "Stigmer",
    "agent deployment",
    "multi-language agents",
    "Apache 2.0",
  ],
  authors: [{ name: "Stigmer Team" }],
  creator: SITE_CONFIG.name,
  publisher: SITE_CONFIG.name,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_CONFIG.url,
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    siteName: SITE_CONFIG.name,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    images: ["/og-image.png"],
  },
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
  manifest: "/site.webmanifest",
  other: {
    "github:repository": SITE_CONFIG.githubUrl,
    "license": SITE_CONFIG.copyright.license,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_CONFIG.url}/#organization`,
        "name": SITE_CONFIG.name,
        "url": SITE_CONFIG.url,
        "logo": {
          "@type": "ImageObject",
          "url": `${SITE_CONFIG.url}/og-image.png`,
        },
        "sameAs": [SITE_CONFIG.githubUrl],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_CONFIG.url}/#software`,
        "name": SITE_CONFIG.name,
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Linux, macOS, Windows",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
        },
        "description": SITE_CONFIG.description,
        "url": SITE_CONFIG.url,
        "downloadUrl": SITE_CONFIG.githubUrl,
        "softwareVersion": "latest",
        "license": `https://www.apache.org/licenses/LICENSE-2.0`,
        "author": {
          "@id": `${SITE_CONFIG.url}/#organization`,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_CONFIG.url}/#website`,
        "url": SITE_CONFIG.url,
        "name": SITE_CONFIG.name,
        "description": SITE_CONFIG.description,
        "publisher": {
          "@id": `${SITE_CONFIG.url}/#organization`,
        },
      },
    ],
  };

  return (
    // Dark-only site: the class is a build-time fact. No theme provider
    // mounts anywhere (docs RootProvider passes `theme.enabled: false`), so
    // nothing ever mutates <html> on the client — no hydration suppression
    // needed. Vendor stylesheets key their dark tokens off this class.
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body
        className={`${instrumentSans.variable} ${instrumentSerif.variable} ${dmMono.variable} font-sans min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
