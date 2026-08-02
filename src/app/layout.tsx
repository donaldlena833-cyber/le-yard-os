import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { publicEnv } from "@/lib/env";
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
    default: "Le Yard OS",
    template: "%s · Le Yard OS",
  },
  description: "The private operating system for the Le Yard restaurant team.",
  applicationName: "Le Yard OS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Le Yard OS",
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
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
