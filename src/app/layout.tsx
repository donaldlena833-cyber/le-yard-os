import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter_Tight } from "next/font/google";
import { connection } from "next/server";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { publicEnv } from "@/lib/env";
import {
  isHostSurface,
  isPhoneSurface,
  surfaceProductName,
} from "@/lib/app-surface";
import "./globals.css";
import "./workspace-design.css";

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  icons: {
    icon: [{ url: "/favicon.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/favicon.ico",
  },
  title: {
    default: surfaceProductName,
    template: `%s · ${surfaceProductName}`,
  },
  description: isPhoneSurface
    ? "The shared Le Yard phone for calls, texts, and voicemail."
    : isHostSurface
      ? "The private reservation book and guest CRM for the Le Yard team."
      : "The private operating system for the Le Yard restaurant team.",
  applicationName: surfaceProductName,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: surfaceProductName,
  },
  formatDetection: {
    telephone: false,
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A strict nonce policy requires a fresh server render for each document.
  await connection();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${interTight.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
          Keep the Apple-specific tag explicit. Some framework/browser
          combinations emit only the generic mobile-web-app-capable tag, but
          iOS uses this exact declaration to launch a Home Screen install
          without Safari's URL field and bottom toolbar.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link
          rel="apple-touch-icon"
          sizes="192x192"
          href="/icons/icon-192.png"
        />
      </head>
      <body className={isPhoneSurface ? undefined : "workspace-design"}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
