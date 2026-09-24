import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Team",
    short_name: "Team",
    description: "Tasks, chat, and meetings for a small team.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f6",
    theme_color: "#f4f4f6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
