import type { Metadata, Viewport } from "next";
import { Pwa } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team",
  description: "Tasks, chat, and meetings for a small team.",
  applicationName: "Team",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Team" },
};

export const viewport: Viewport = {
  themeColor: "#f4f4f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <Pwa />
        {children}
      </body>
    </html>
  );
}
