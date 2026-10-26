import type { Metadata } from "next";
import "./design-tokens.css";
import "./globals.css";
import "./compact-dashboard.css";
import "./compact-forecast.css";
import "./compact-navigation.css";
import "./chart-accessibility.css";

const SITE_ORIGIN = "https://macrolens-malaysia.vercel.app";

export async function generateMetadata(): Promise<Metadata> {
  const base = new URL(SITE_ORIGIN);
  const title = "MacroLens Malaysia | Economy & Markets Dashboard";
  const description = "Explore Malaysia’s economy through sourced indicators, financial markets, statistical forecasts, regional comparisons and research.";
  return {
    metadataBase: base,
    title,
    description,
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/site.webmanifest",
    openGraph: {
      title,
      description,
      siteName: "MacroLens Malaysia",
      type: "website",
      images: [{ url: "/og.png", width: 1729, height: 910, alt: "MacroLens Malaysia economy and markets dashboard" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
