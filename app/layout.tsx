import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seismograph",
  description:
    "Live earthquake monitoring, sequence analysis and aftershock forecasting. " +
    "Research and hobby use.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href={
            "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&" +
            "family=Space+Grotesk:wght@500;700&display=swap"
          }
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
