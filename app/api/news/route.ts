import { NextResponse } from "next/server";

type RawNewsItem = {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  sourceUrl: string;
  summary: string;
};

const feeds = [
  {
    id: "bernama-english",
    label: "BERNAMA English feed",
    url: "https://www.bernama.com/en/rssfeed.php",
  },
  {
    id: "malaysia-economy",
    label: "Malaysia economy",
    url: "https://news.google.com/rss/search?q=Malaysia%20economy%20when:7d&hl=en-MY&gl=MY&ceid=MY:en",
  },
  {
    id: "malaysia-markets",
    label: "Malaysia inflation, BNM, ringgit and markets",
    url: "https://news.google.com/rss/search?q=Malaysia%20inflation%20OR%20BNM%20OR%20ringgit%20OR%20Bursa%20when:7d&hl=en-MY&gl=MY&ceid=MY:en",
  },
  {
    id: "malaysia-trade-growth",
    label: "Malaysia trade and growth",
    url: "https://news.google.com/rss/search?q=Malaysia%20exports%20OR%20GDP%20OR%20trade%20when:7d&hl=en-MY&gl=MY&ceid=MY:en",
  },
];

const topicRules = [
  ["Inflation", /inflation|cpi|price|prices|cost of living/i],
  ["Policy rate", /\bBNM\b|bank negara|OPR|policy rate|interest rate/i],
  ["Ringgit", /ringgit|usd\/myr|currency|forex/i],
  ["Bursa", /bursa|klci|equities|stock market|shares/i],
  ["Growth", /\bGDP\b|growth|economy|economic/i],
  ["Trade", /export|exports|import|imports|trade|external/i],
  ["Jobs", /jobs|employment|unemployment|labour|labor|wages/i],
] as const;

const economyRelated = /economy|economic|business|ringgit|usd\/myr|currency|forex|bursa|klci|inflation|cpi|\bBNM\b|bank negara|OPR|policy rate|interest rate|exports?|imports?|trade|\bGDP\b|growth|investment|market|oil|palm|tax|budget|jobs|employment|unemployment|labour|labor|wages|prices?/i;
const localDevelopmentTerms = /entrepreneurs?|SMEs?|small and medium|agrobank|halal ecosystem|bumiputera economic|economic participation|development agenc|finance|financing|bank|income|welfare|permanent status/i;
const malaysiaSpecific = /malaysia|malaysian|ringgit|usd\/myr|bursa|klci|\bBNM\b|bank negara|OPR|putrajaya|kuala lumpur|mof|dosm/i;
const nonMalaysiaDesk = /^(world|sports|crime|courts|asean|politics)\s*:/i;
const excludedBernamaDesk = /^(world|sports|crime|courts|asean)\s*:/i;

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtml(value: string) {
  return decodeXml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function sourceFrom(block: string, title: string) {
  const sourceMatch = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
  if (sourceMatch) return { name: stripHtml(sourceMatch[2]), url: decodeXml(sourceMatch[1]) };
  const parts = title.split(" - ");
  return { name: parts.length > 1 ? parts.at(-1)!.trim() : "News source", url: "" };
}

function cleanTitle(title: string, source: string) {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title.replace(/^(General|Business)\s*:\s*/i, "").trim();
}

function topicsFor(item: Pick<RawNewsItem, "title" | "summary">) {
  const text = `${item.title} ${item.summary}`;
  const topics = topicRules.filter(([, rule]) => rule.test(text)).map(([label]) => label);
  return topics.length ? topics : ["Malaysia economy"];
}

function relevanceScore(item: RawNewsItem) {
  const text = `${item.title} ${item.summary}`;
  const topicScore = topicsFor(item).length * 2;
  const malaysiaScore = /malaysia|malaysian|ringgit|bursa|bank negara|bnm/i.test(text) ? 6 : 0;
  const officialScore = /bernama|bank negara|department of statistics|dosm|ministry of finance|mof/i.test(item.source) ? 3 : 0;
  return topicScore + malaysiaScore + officialScore;
}

function isEconomyRelated(item: RawNewsItem) {
  const text = `${item.title} ${item.summary} ${item.source}`;
  if (!economyRelated.test(text)) return false;
  if (nonMalaysiaDesk.test(item.title) && !malaysiaSpecific.test(text)) return false;
  return malaysiaSpecific.test(text) || /bernama/i.test(item.source);
}

function parseRss(xml: string, fallbackSource = "News source"): RawNewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    const rawTitle = stripHtml(tag(block, "title"));
    const detectedSource = sourceFrom(block, rawTitle);
    const source = detectedSource.name === "News source" ? { name: fallbackSource, url: "" } : detectedSource;
    const link = tag(block, "link");
    return {
      title: cleanTitle(rawTitle, source.name),
      link,
      publishedAt: new Date(tag(block, "pubDate") || Date.now()).toISOString(),
      source: source.name,
      sourceUrl: source.url,
      summary: stripHtml(tag(block, "description")).slice(0, 260),
    };
  }).filter((item) => item.title && item.link && !Number.isNaN(Date.parse(item.publishedAt)));
}

async function fetchFeed(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const generatedAt = new Date().toISOString();
  const fixture = process.env.NEWS_RSS_FIXTURE;
  const results = await Promise.allSettled(
    (fixture ? [{ id: "fixture", label: "Fixture", url: "fixture://news" }] : feeds)
      .map(async (feed) => ({ feed, xml: fixture ?? await fetchFeed(feed.url) })),
  );

  const items = new Map<string, RawNewsItem & { topics: string[]; relevanceScore: number }>();
  const feedFallbackItems = new Map<string, RawNewsItem & { topics: string[]; relevanceScore: number }>();
  const sourceStatus = results.map((result, index) => {
    const feed = (fixture ? [{ id: "fixture", label: "Fixture", url: "fixture://news" }] : feeds)[index];
    if (result.status === "rejected") {
      return { id: feed.id, label: feed.label, url: feed.url, status: "stale", message: String(result.reason?.message ?? result.reason) };
    }
    const parsedItems = parseRss(result.value.xml, feed.id === "bernama-english" ? "BERNAMA" : "News source");
    for (const item of parsedItems.filter(isEconomyRelated)) {
      const topics = topicsFor(item);
      items.set(item.link, { ...item, topics, relevanceScore: relevanceScore(item) });
    }
    if (feed.id === "bernama-english") {
      for (const item of parsedItems.filter((candidate) => {
        const text = `${candidate.title} ${candidate.summary}`;
        return !excludedBernamaDesk.test(candidate.title) && (economyRelated.test(text) || localDevelopmentTerms.test(text) || malaysiaSpecific.test(text));
      }).slice(0, 24)) {
        const topics = topicsFor(item);
        feedFallbackItems.set(item.link, { ...item, topics, relevanceScore: Math.max(1, relevanceScore(item) - 2) });
      }
    }
    return { id: feed.id, label: feed.label, url: feed.url, status: "fresh", message: "RSS feed parsed" };
  });

  let ordered = [...items.values()]
    .sort((a, b) => b.relevanceScore - a.relevanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 24);
  if (feedFallbackItems.size && ordered.length < 12) {
    const seen = new Set(ordered.map((item) => item.link));
    const topUp = [...feedFallbackItems.values()]
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .filter((item) => !seen.has(item.link))
      .slice(0, 24 - ordered.length);
    ordered = [...ordered, ...topUp];
  }
  if (!ordered.length) {
    ordered = [{
      title: "Live economy headline feeds are temporarily unavailable",
      link: "https://www.bnm.gov.my/publications/mhs",
      publishedAt: generatedAt,
      source: "MacroLens fallback",
      sourceUrl: "https://www.bnm.gov.my/publications/mhs",
      summary: "Use the official BNM Monthly Highlights and Statistics and data.gov.my releases while external news feeds recover.",
      topics: ["Malaysia economy"],
      relevanceScore: 0,
    }];
  }

  return NextResponse.json({
    schemaVersion: 1,
    generatedAt,
    status: sourceStatus.every((source) => source.status !== "fresh") ? "unavailable" : sourceStatus.some((source) => source.status !== "fresh") ? "partial" : "fresh",
    refreshPolicy: "Fetched at request time from public RSS/search feeds. Items may change between visits and are not part of the official statistical payload.",
    queryWindow: "Past seven days",
    sources: sourceStatus,
    items: ordered,
    disclaimer: "News headlines provide context only. MacroLens does not verify every article claim and does not treat headlines as statistical evidence or financial advice.",
  });
}
