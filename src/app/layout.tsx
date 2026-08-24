import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { publicEnv } from "@/lib/env";
import {
  isHostSurface,
  surfaceProductName,
} from "@/lib/app-surface";
import "./globals.css";

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
  title: {
    default: surfaceProductName,
    template: `%s · ${surfaceProductName}`,
  },
  description: isHostSurface
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
      className={`${geistSans.variable} ${geistMono.variable}`}
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
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
