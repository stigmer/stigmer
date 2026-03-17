import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Nunito, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "@/components/auth/Providers";
import { AppShell } from "@/components/layout/AppShell";
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
  title: "Stigmer Console",
  description: "Stigmer Web Console",
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
        <Providers>
          <AppShell>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
