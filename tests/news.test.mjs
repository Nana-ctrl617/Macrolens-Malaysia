import assert from "node:assert/strict";
import test from "node:test";
import { buildNewsPayload, canonicalNewsUrl, cleanNewsText, parsePublicationDate, parseRss } from "../app/lib/news.ts";

const NOW = new Date("2026-10-05T07:00:00.000Z");
const CUTOFF = Date.parse("2026-09-28T07:00:00.000Z");
const FEED = { id: "test", label: "Test feed", url: "https://example.com/rss" };
const BERNAMA = { id: "bernama-english", label: "BERNAMA English feed", url: "https://www.bernama.com/en/rssfeed.php" };
const rss = (...items) => `<rss><channel>${items.join("")}</channel></rss>`;
const item = ({ title = "Malaysia economy improves", link = "https://example.com/story", date = "Mon, 05 Oct 2026 06:00:00 GMT", source = "", description = "Malaysia GDP and exports improved." } = {}) =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link>${date === null ? "" : `<pubDate>${date}</pubDate>`}${source}<description><![CDATA[${description}]]></description></item>`;

test("genuine seven-day window drops missing, malformed, old and future dates", () => {
  const parsed = parseRss(rss(
    item({ link: "https://example.com/valid" }),
    item({ link: "https://example.com/boundary", title: "Malaysia inflation at boundary", date: "2026-09-28T07:00:00Z" }),
    item({ link: "https://example.com/missing", date: null }),
    item({ link: "https://example.com/bad", date: "not a publication date" }),
    item({ link: "https://example.com/rollover", date: "2026-09-31T06:00:00Z" }),
    item({ link: "https://example.com/old", date: "2026-09-28T06:59:59Z" }),
    item({ link: "https://example.com/future", date: "2026-10-05T07:00:01Z" }),
  ), FEED, NOW);
  assert.equal(parsed.items.length, 2);
  assert.ok(parsed.items.every((story) => Date.parse(story.publishedAt) >= CUTOFF && Date.parse(story.publishedAt) <= NOW.getTime()));
  assert.equal(parsed.counts.missingDate, 1);
  assert.equal(parsed.counts.invalidDate, 2);
  assert.equal(parsed.counts.outOfWindow, 1);
  assert.equal(parsed.counts.futureDate, 1);
});

test("publication dates reject calendar rollover, ambiguous and non-date inputs", () => {
  for (const date of ["", "123", "2026-02-30T12:00:00Z", "2026-10-05T25:00:00Z", "2026-10-05 12:00", "Tue, 31 Sep 2026 06:00:00 GMT"]) {
    assert.equal(parsePublicationDate(date), null, date);
  }
  assert.equal(parsePublicationDate("Mon, 05 Oct 2026 14:00:00 +0800"), "2026-10-05T06:00:00.000Z");
  assert.equal(parsePublicationDate("2024-02-29T06:00:00Z"), "2024-02-29T06:00:00.000Z");
});

test("Bing redirects canonicalize, reject unsafe targets and deduplicate articles and titles", () => {
  const redirect = "https://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=" + encodeURIComponent("https://www.reuters.com/world/malaysia/story?utm_source=rss#top");
  assert.equal(canonicalNewsUrl(redirect), "https://www.reuters.com/world/malaysia/story");
  for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "https://user:secret@example.com/story", "https://www.bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)", "https://localhost/story"]) {
    assert.equal(canonicalNewsUrl(url), null, url);
  }
  const payload = buildNewsPayload([{ feed: FEED, xml: rss(
    item({ link: redirect, title: "Malaysia economy improves", date: "2026-10-05T04:00:00Z" }),
    item({ link: "https://www.reuters.com/world/malaysia/story?utm_medium=feed", title: "Malaysia exports improve", date: "2026-10-05T06:00:00Z" }),
    item({ link: "https://example.com/syndicated", title: "MALAYSIA exports improve!", date: "2026-10-05T05:00:00Z" }),
    item({ link: "https://example.com/updated", title: "[UPDATED] Malaysia exports improve", date: "2026-10-05T03:00:00Z" }),
  ) }], NOW);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].source, "Reuters");
  assert.equal(payload.counts.duplicates, 3);
});

test("publisher attribution prefers RSS source, creator and Bing metadata over destination domain", () => {
  const parsed = parseRss(rss(
    item({ link: "https://example.com/a", source: "<source url='https://www.bernama.com'>BERNAMA</source>" }),
    item({ link: "https://example.com/b", source: "<dc:creator><![CDATA[The Edge Malaysia]]></dc:creator>" }),
    item({ link: "https://example.com/c", source: "<News:Source>Malay Mail</News:Source>" }),
    item({ link: "https://marketwatch.com/d", source: "<source>News source</source>" }),
    item({ link: "https://specific-publisher.example/e" }),
  ), FEED, NOW);
  assert.deepEqual(parsed.items.map((story) => story.source), ["BERNAMA", "The Edge Malaysia", "Malay Mail", "MarketWatch", "specific-publisher.example"]);
  assert.ok(parsed.items.every((story) => story.source !== "News source"));
});

test("news text decodes nested named/numeric entities and common UTF-8 mojibake", () => {
  assert.equal(cleanNewsText("<![CDATA[Malaysia&amp;#039;s &amp;rsquo;growth&amp;rsquo;&nbsp;costs &#x52;M10 &ndash; &#8212; &#128200;]]>"), "Malaysia's ’growth’ costs RM10 – — 📈");
  assert.equal(cleanNewsText("Malaysiaâ\u0080\u0099s &amp;ldquo;economy&amp;rdquo; &lt;b&gt;grows&lt;/b&gt;"), "Malaysia’s “economy” grows");
  assert.equal(cleanNewsText("CafÃ© â€™ â€“ â€” â€¦ ProgrammeÂ"), "Café ’ – — … Programme");
  const parsed = parseRss(rss(item({ title: "Malaysia&amp;#039;s economy - Reuters", source: "<source>Reuters</source>", description: "Malaysia GDP&nbsp;grows &amp;#8217; &lt;b&gt;exports&lt;/b&gt;" })), FEED, NOW);
  assert.equal(parsed.items[0].title, "Malaysia's economy");
  assert.equal(parsed.items[0].summary, "Malaysia GDP grows ’ exports");
});

test("all BERNAMA top-ups remain date-filtered and final output is newest first, at most 24", () => {
  const recent = Array.from({ length: 30 }, (_, index) => item({ title: `Malaysia SME financing expands ${index}`, link: `https://www.bernama.com/en/news.php?id=${index}`, date: new Date(NOW.getTime() - (index + 1) * 3600000).toISOString(), description: "Malaysia entrepreneurs obtain financing." }));
  const payload = buildNewsPayload([{ feed: BERNAMA, xml: rss(item({ title: "Malaysia SME financing old", date: "2026-01-01T00:00:00Z" }), ...recent) }], NOW);
  assert.equal(payload.items.length, 24);
  assert.equal(payload.sources[0].counts.outOfWindow, 1);
  assert.ok(payload.items.every((story) => Date.parse(story.publishedAt) >= CUTOFF));
  assert.ok(payload.items.every((story, index, all) => index === 0 || Date.parse(all[index - 1].publishedAt) >= Date.parse(story.publishedAt)));
});

test("duplicate primary results cannot suppress eligible recent BERNAMA top-ups", () => {
  const duplicates = Array.from({ length: 13 }, (_, index) => item({ link: `https://example.com/story?utm_source=feed${index}` }));
  const payload = buildNewsPayload([
    { feed: FEED, xml: rss(...duplicates) },
    { feed: BERNAMA, xml: rss(item({ title: "Malaysia SME financing support", link: "https://bernama.com/news.php?id=27", description: "Malaysia entrepreneurs obtain financing." })) },
  ], NOW);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.counts.duplicates, 12);
});

test("empty and unavailable feeds never manufacture articles and report audit/window counts", () => {
  const empty = buildNewsPayload([{ feed: FEED, xml: rss(item({ date: "2026-01-01T00:00:00Z" })) }], NOW);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.status, "fresh");
  assert.match(empty.emptyReason, /seven-day window/i);
  assert.deepEqual(empty.window, { start: "2026-09-28T07:00:00.000Z", end: NOW.toISOString(), days: 7 });
  assert.equal(empty.counts.parsed, 1);
  assert.equal(empty.counts.excluded, 1);
  assert.equal(empty.counts.returned, 0);
  const unavailable = buildNewsPayload([{ feed: FEED, error: "Feed request timed out" }], NOW);
  assert.deepEqual(unavailable.items, []);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.sources[0].status, "unavailable");
  assert.match(unavailable.emptyReason, /unavailable/i);
  assert.equal(unavailable.generatedAt, NOW.toISOString());
});

test("malformed feeds and irrelevant stories have honest, distinct audit results", () => {
  const payload = buildNewsPayload([
    { feed: FEED, xml: "<html>Service temporarily unavailable</html>" },
    { feed: { ...FEED, id: "valid" }, xml: rss(item({ title: "World: overseas football results", description: "Sports scores", link: "https://example.com/sport" }), item({ link: "javascript:alert(1)" })) },
  ], NOW);
  assert.equal(payload.status, "partial");
  assert.deepEqual(payload.items, []);
  assert.equal(payload.sources[0].status, "unavailable");
  assert.equal(payload.sources[1].counts.irrelevant, 1);
  assert.equal(payload.sources[1].counts.invalidUrl, 1);
});
