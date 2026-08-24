import type { MetadataRoute } from "next";
import {
  defaultWorkspacePath,
  isHostSurface,
  surfaceProductName,
} from "@/lib/app-surface";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: surfaceProductName,
    short_name: "Le Yard",
    description: isHostSurface
      ? "The private reservation book and guest CRM for Le Yard."
      : "The private operating system for modern restaurant teams.",
    start_url: defaultWorkspacePath,
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f2f0e9",
    theme_color: "#171a17",
    categories: ["business", "food", "productivity"],
    shortcuts: isHostSurface ? [
      {
        name: "Host stand",
        short_name: "Reservations",
        url: "/reservations",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Guest CRM",
        short_name: "Guests",
        url: "/guests",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ] : [
      {
        name: "Host stand",
        short_name: "Reservations",
        url: "/reservations",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Service control",
        short_name: "Service",
        url: "/service",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
