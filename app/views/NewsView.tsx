"use client";

import { useState, useEffect, useMemo } from "react";
import { groupRelatedNewsStories } from "@/app/lib/news";
import type { NewsItem, NewsStoryGroup } from "@/app/lib/news";
import { formatMalaysiaTimestamp } from "@/app/lib/dashboard-format";

export type { NewsItem } from "@/app/lib/news";

export type NewsPayload = {
  schemaVersion: number;
  generatedAt: string;
  status: "fresh" | "partial" | "unavailable";
  refreshPolicy: string;
  queryWindow: string;
  window?: { start: string; end: string; days: number };
  counts?: { parsed: number; eligible: number; excluded: number; duplicates: number; returned: number };
  emptyReason?: string;
  sources: Array<{ id: string; label: string; url: string; status: string; message: string }>;
  items: NewsItem[];
  disclaimer: string;
};

export function formatNewsDate(date: string) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(date));
}

function CoverageLinks({ story }: { story: NewsStoryGroup }) {
  return <details className="news-coverage">
    <summary>{story.items.length === 1 ? "Read source ↗" : `Read all ${story.items.length} source reports`}</summary>
    <ul>{story.items.map((item) => <li key={item.link}>
      <a href={item.link} target="_blank" rel="noreferrer">{item.source} · {formatNewsDate(item.publishedAt)} ↗</a>
    </li>)}</ul>
  </details>;
}

export function NewsSection() {
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [topic, setTopic] = useState("All");
  const [source, setSource] = useState("All");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/news?refresh=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("News unavailable");
        return response.json() as Promise<NewsPayload>;
      })
      .then((payload) => active && setNews(payload))
      .catch(() => active && setNews({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: "unavailable",
        refreshPolicy: "News feeds are temporarily unavailable.",
        queryWindow: "Past seven days",
        sources: [],
        items: [],
        disclaimer: "News headlines are unavailable right now. The official statistical dashboard remains available.",
      }));
    return () => { active = false; };
  }, [refresh]);

  const topics = useMemo(() => ["All", ...Array.from(new Set((news?.items ?? []).flatMap((item) => item.topics))).sort()], [news]);
  const sources = useMemo(() => ["All", ...Array.from(new Set((news?.items ?? []).map((item) => item.source))).sort()], [news]);
  const filtered = useMemo(() => (news?.items ?? []).filter((item) => (
    (topic === "All" || item.topics.includes(topic))
    && (source === "All" || item.source === source)
  )), [news, topic, source]);
  const stories = useMemo(() => groupRelatedNewsStories(filtered), [filtered]);
  const featured = stories[0];
  const featuredArticle = featured?.items[0];
  const generated = news ? formatMalaysiaTimestamp(news.generatedAt) : "Loading";
  const storyStatus = stories.length === 1 ? "1 matching story" : `${stories.length} matching stories`;

  return <section className="section news-section page-section" id="news"><div className="shell">
    <div className="section-heading"><div><span className="section-number">03 / News</span><h1>Latest Malaysia economy headlines</h1></div><p>Recent headlines that may help explain what markets and policymakers are discussing. This complements the official data; it does not replace statistical evidence.</p></div>
    <div className="news-meta">
      <span>Last checked · {generated}</span>
      <span role="status" aria-live="polite" aria-atomic="true">{news ? `${storyStatus} across ${filtered.length} verified-date headline${filtered.length === 1 ? "" : "s"}. Source status: ${news.status}.` : "Loading headlines…"}</span>
      <b className={`risk-pill ${news?.status ?? "partial"}`}>{news?.status ?? "loading"}</b>
      <small>{news?.queryWindow ?? "Past seven days"} · fetched from public RSS/search feeds</small>
      {news && <small>{news.items.length} verified-date article{news.items.length === 1 ? "" : "s"} grouped into {groupRelatedNewsStories(news.items).length} stories · newest first</small>}
      <button type="button" className="news-refresh" onClick={() => { setNews(null); setRefresh((value) => value + 1); }}>Refresh headlines</button>
    </div>
    {featured && featuredArticle && <article className="news-featured">
      <div><span>{featuredArticle.topics.join(" · ")}</span><h2>{featuredArticle.title}</h2><p>{featuredArticle.summary || "Open a source article for the full context."}</p><small>{featured.items.length > 1 ? `This story is covered by ${featured.items.length} publishers. Headlines are grouped only when their wording is highly similar.` : "Lead story, selected by its latest verified publication date."}</small></div>
      <aside><strong>{featured.items.length} source report{featured.items.length === 1 ? "" : "s"}</strong><time dateTime={featuredArticle.publishedAt}>{formatNewsDate(featuredArticle.publishedAt)}</time><CoverageLinks story={featured} /></aside>
    </article>}
    <div className="news-toolbar">
      <div className="news-filter-group">
        <span>Topic</span>
        <div role="group" aria-label="Filter news by topic">
          {topics.map((item) => <button key={item} type="button" className={topic === item ? "active" : ""} aria-pressed={topic === item} onClick={() => setTopic(item)}>{item}</button>)}
        </div>
      </div>
      <div className="news-filter-group">
        <span>Source</span>
        <div role="group" aria-label="Filter news by source">
          {sources.map((item) => <button key={item} type="button" className={source === item ? "active" : ""} aria-pressed={source === item} onClick={() => setSource(item)}>{item}</button>)}
        </div>
      </div>
    </div>
    {!news ? <div className="news-empty" role="status">Loading latest economy headlines…</div> : !filtered.length ? <div className="news-empty" role="status"><p>{news.items.length ? "No headlines match these filters. Choose All to see the available stories." : news.emptyReason || "No dated Malaysian economy headlines are available in the past seven days. Older or undated stories are excluded, not presented as latest news."}</p>{news.items.length > 0 && <button type="button" onClick={() => { setTopic("All"); setSource("All"); }}>Clear filters</button>}</div> : <>
      <div className="news-grid">{stories.slice(1, 25).map((story, index) => {
        const item = story.items[0];
        return <article key={story.key} className={`news-card tone-${index % 6}`}>
        <div>{item.topics.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
        <h2><a href={item.link} target="_blank" rel="noreferrer">{item.title}</a></h2>
        <p>{item.summary || "Open a source report for details."}</p>
        <footer><b>{story.items.length} source{story.items.length === 1 ? "" : "s"}</b><time dateTime={item.publishedAt}>{formatNewsDate(item.publishedAt)}</time></footer>
        <CoverageLinks story={story} />
      </article>;
      })}</div>
    </>}
    {news && <><div className="news-sources"><p>{news.refreshPolicy}</p>{news.sources.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer" title={item.message}><span className={`risk-pill ${item.status}`}>{item.status}</span>{item.label}</a>)}</div><p className="deep-disclaimer">{news.disclaimer}</p></>}
  </div></section>;
}


export default function NewsView() { return <NewsSection />; }
