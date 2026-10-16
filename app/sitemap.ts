import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://macrolens-malaysia.vercel.app";
const pages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/brief", priority: 0.9, changeFrequency: "daily" },
  { path: "/news", priority: 0.8, changeFrequency: "daily" },
  { path: "/risk", priority: 0.8, changeFrequency: "daily" },
  { path: "/forecast", priority: 0.8, changeFrequency: "weekly" },
  { path: "/drivers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/structure", priority: 0.7, changeFrequency: "yearly" },
  { path: "/external", priority: 0.7, changeFrequency: "monthly" },
  { path: "/bop", priority: 0.6, changeFrequency: "monthly" },
  { path: "/household", priority: 0.7, changeFrequency: "monthly" },
  { path: "/regional", priority: 0.8, changeFrequency: "yearly" },
  { path: "/decisions", priority: 0.6, changeFrequency: "monthly" },
  { path: "/sectors", priority: 0.6, changeFrequency: "monthly" },
  { path: "/bursa", priority: 0.7, changeFrequency: "daily" },
  { path: "/timeline", priority: 0.5, changeFrequency: "yearly" },
  { path: "/structural", priority: 0.6, changeFrequency: "monthly" },
  { path: "/report", priority: 0.6, changeFrequency: "monthly" },
  { path: "/health", priority: 0.6, changeFrequency: "daily" },
  { path: "/methodology", priority: 0.5, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map(({ path, ...details }) => ({ url: `${SITE_ORIGIN}${path}`, ...details }));
}
