import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Le Yard OS",
    short_name: "Le Yard",
    description: "The private operating system for modern restaurant teams.",
    start_url: "/today",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f2f0e9",
    theme_color: "#171a17",
    categories: ["business", "productivity"],
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
