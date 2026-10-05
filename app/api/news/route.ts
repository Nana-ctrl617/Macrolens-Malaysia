import { NextResponse } from "next/server";
import { buildNewsPayload, type NewsFeed, type NewsFeedResult } from "@/app/lib/news";

const feeds: NewsFeed[] = [
  { id: "bernama-english", label: "BERNAMA English feed", url: "https://www.bernama.com/en/rssfeed.php" },
  { id: "malaysia-economy", label: "Malaysia economy", url: "https://news.google.com/rss/search?q=Malaysia%20economy%20when:7d&hl=en-MY&gl=MY&ceid=MY:en" },
  { id: "malaysia-markets", label: "Malaysia inflation, BNM, ringgit and markets", url: "https://news.google.com/rss/search?q=Malaysia%20inflation%20OR%20BNM%20OR%20ringgit%20OR%20Bursa%20when:7d&hl=en-MY&gl=MY&ceid=MY:en" },
  { id: "malaysia-trade-growth", label: "Malaysia trade and growth", url: "https://news.google.com/rss/search?q=Malaysia%20exports%20OR%20GDP%20OR%20trade%20when:7d&hl=en-MY&gl=MY&ceid=MY:en" },
  { id: "bing-malaysia-economy", label: "Bing Malaysia economy", url: "https://www.bing.com/news/search?q=Malaysia%20economy%20ringgit%20exports%20GDP&format=rss" },
  { id: "bing-malaysia-markets", label: "Bing Malaysia markets", url: "https://www.bing.com/news/search?q=Malaysia%20inflation%20BNM%20ringgit%20Bursa&format=rss" },
];

async function fetchFeed(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`This source returned HTTP ${response.status}; no headlines were supplied.`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function feedError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "This source did not respond within eight seconds.";
  if (error instanceof Error && error.message.startsWith("This source returned HTTP")) return error.message;
  return "This source could not be reached. No cached headlines were supplied.";
}

export async function GET() {
  const fixture = process.env.NEWS_RSS_FIXTURE;
  // Tests may freeze the clock only when they also provide an explicit feed fixture.
  const now = new Date(fixture && process.env.NEWS_NOW ? process.env.NEWS_NOW : Date.now());
  const selectedFeeds: NewsFeed[] = fixture
    ? [{ id: "fixture", label: "Fixture", url: "fixture://news" }]
    : feeds;
  const results: NewsFeedResult[] = await Promise.all(selectedFeeds.map(async (feed) => {
    try {
      return { feed, xml: fixture ?? await fetchFeed(feed.url) };
    } catch (error) {
      return { feed, error: feedError(error) };
    }
  }));
  return NextResponse.json(buildNewsPayload(results, now));
}
