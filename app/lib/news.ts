export type NewsFeed = { id: string; label: string; url: string };
export type RawNewsItem = {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  sourceUrl: string;
  summary: string;
};
export type NewsItem = RawNewsItem & { topics: string[]; relevanceScore: number };
export type NewsExclusions = {
  parsed: number;
  eligible: number;
  missingDate: number;
  invalidDate: number;
  futureDate: number;
  outOfWindow: number;
  invalidUrl: number;
  irrelevant: number;
};
export type NewsFeedResult = { feed: NewsFeed; xml?: string; error?: string };
export type NewsSourceAudit = NewsFeed & {
  status: "fresh" | "unavailable";
  message: string;
  counts: NewsExclusions;
};
export type NewsPayload = {
  schemaVersion: 1;
  generatedAt: string;
  status: "fresh" | "partial" | "unavailable";
  refreshPolicy: string;
  queryWindow: string;
  window: { start: string; end: string; days: 7 };
  counts: { parsed: number; eligible: number; excluded: number; duplicates: number; returned: number };
  sources: NewsSourceAudit[];
  items: NewsItem[];
  emptyReason: string | null;
  disclaimer: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const namedEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢",
  deg: "°", plusmn: "±", times: "×", divide: "÷", micro: "µ", sect: "§", para: "¶",
  ensp: " ", emsp: " ", thinsp: " ", shy: "", zwnj: "", zwj: "", lrm: "", rlm: "",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ",
};
const latinNames = "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
latinNames.forEach((name, index) => { namedEntities[name] = String.fromCharCode(192 + index); });

/** Feeds frequently contain double-escaped HTML rather than just XML entities. */
function decodeEntities(value: string) {
  let decoded = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let pass = 0; pass < 8; pass++) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, name: string) => {
      if (!name.startsWith("#")) return namedEntities[name] ?? entity;
      const numeric = name[1].toLowerCase() === "x";
      const code = Number.parseInt(name.slice(numeric ? 2 : 1), numeric ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

const cp1252: Record<string, number> = {
  "€": 128, "‚": 130, "ƒ": 131, "„": 132, "…": 133, "†": 134, "‡": 135,
  "ˆ": 136, "‰": 137, "Š": 138, "‹": 139, "Œ": 140, "Ž": 142, "‘": 145,
  "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "˜": 152,
  "™": 153, "š": 154, "›": 155, "œ": 156, "ž": 158, "Ÿ": 159,
};
const continuation = "[\\u0080-\\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]";
const mojibake = new RegExp(`(?:[ÃÂ]${continuation}|â${continuation}{2}|ð${continuation}{3})`, "g");

function repairMojibake(value: string) {
  let repaired = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = repaired.replace(mojibake, (sequence) => {
      try {
        const bytes = Uint8Array.from(Array.from(sequence, (character) => cp1252[character] ?? character.charCodeAt(0)));
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return sequence;
      }
    });
    if (next === repaired) break;
    repaired = next;
  }
  return repaired.replace(/Â(?=\s|$)/g, "");
}

export function cleanNewsText(value: string) {
  return repairMojibake(decodeEntities(value))
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"))?.[1] ?? "";
}

const monthIndex: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function validCalendarDate(year: number, month: number, day: number) {
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1
    && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Only explicit ISO dates or standard timestamped RSS dates count as publication dates. */
export function parsePublicationDate(value: string): string | null {
  const date = cleanNewsText(value);
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/i);
  const rfc = date.match(/^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:[+-]\d{4}|GMT|UTC|[ECMP][DS]T)$/i);
  if (!iso && !rfc) return null;
  const year = Number(iso?.[1] ?? rfc?.[3]);
  const month = iso ? Number(iso[2]) : monthIndex[rfc![2].toLowerCase()];
  const day = Number(iso?.[3] ?? rfc?.[1]);
  const hour = Number(iso?.[4] ?? rfc?.[4] ?? 0);
  const minute = Number(iso?.[5] ?? rfc?.[5] ?? 0);
  const second = Number(iso?.[6] ?? rfc?.[6] ?? 0);
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function publicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return false;
  if (host.includes(":")) return false; // Public articles should use publisher hostnames, not IPv6 literals.
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  return !ipv4 || !(ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] >= 224
    || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168));
}

/** Decode Bing's destination, reject executable/credential URLs, then remove tracking only. */
export function canonicalNewsUrl(value: string, depth = 0): string | null {
  if (depth > 4) return null;
  try {
    const raw = decodeEntities(value).trim();
    if (/[\u0000-\u0020\u007f]/.test(raw)) return null;
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !publicHostname(url.hostname)) return null;
    if (/(^|\.)bing\.com$/i.test(url.hostname) && /\/news\/apiclick\.aspx$/i.test(url.pathname)) {
      const destination = url.searchParams.get("url");
      return destination ? canonicalNewsUrl(destination, depth + 1) : null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

const publisherNames: Record<string, string> = {
  "bernama.com": "BERNAMA", "reuters.com": "Reuters", "thestar.com.my": "The Star",
  "malaymail.com": "Malay Mail", "theedgemalaysia.com": "The Edge Malaysia",
  "freemalaysiatoday.com": "Free Malaysia Today", "marketwatch.com": "MarketWatch",
  "bloomberg.com": "Bloomberg", "msn.com": "MSN", "finance.yahoo.com": "Yahoo Finance",
  "money.usnews.com": "U.S. News", "themalaysianreserve.com": "The Malaysian Reserve",
};
function sourceFrom(block: string, link: string) {
  const sourceBlock = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i);
  const sourceAttribute = sourceBlock?.[1].match(/\burl\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  const names = [sourceBlock?.[2] ?? "", tag(block, "dc:creator"), tag(block, "creator"), tag(block, "News:Source"), tag(block, "author")];
  const name = names.map(cleanNewsText).find((candidate) => candidate && !/^(news source|unknown|n\/a|bing|google news)$/i.test(candidate));
  const articleUrl = new URL(link);
  const hostname = articleUrl.hostname.replace(/^www\./i, "");
  const fallbackName = publisherNames[hostname] ?? Object.entries(publisherNames).find(([host]) => hostname.endsWith(`.${host}`))?.[1] ?? hostname;
  return { name: name ?? fallbackName, url: canonicalNewsUrl(sourceAttribute) ?? articleUrl.origin };
}

function cleanTitle(value: string, publisher: string) {
  const escaped = publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanNewsText(value).replace(new RegExp(`\\s+[-–—]\\s+${escaped}$`, "i"), "")
    .replace(/^(General|Business)\s*:\s*/i, "").trim();
}

const topicRules = [
  ["Inflation", /inflation|cpi|price|prices|cost of living/i],
  ["Policy rate", /\bBNM\b|bank negara|OPR|policy rate|interest rate/i],
  ["Ringgit", /ringgit|usd\/myr|currency|forex/i],
  ["Bursa", /bursa|klci|equities|stock market|shares/i],
  ["Growth", /\bGDP\b|growth|economy|economic/i],
  ["Trade", /exports?|imports?|trade|external/i],
  ["Jobs", /jobs|employment|unemployment|labour|labor|wages/i],
] as const;
const economyRelated = /economy|economic|business|ringgit|usd\/myr|currency|forex|bursa|klci|inflation|cpi|\bBNM\b|bank negara|OPR|policy rate|interest rate|exports?|imports?|trade|\bGDP\b|growth|investment|market|oil|palm|tax|budget|jobs|employment|unemployment|labour|labor|wages|prices?/i;
const localDevelopment = /entrepreneurs?|SMEs?|small and medium|agrobank|halal ecosystem|bumiputera economic|economic participation|development agenc|finance|financing|bank|income|welfare|permanent status/i;
const malaysiaSpecific = /malaysia|malaysian|ringgit|usd\/myr|bursa|klci|\bBNM\b|bank negara|OPR|putrajaya|kuala lumpur|mof|dosm/i;
const excludedDesk = /^(world|sports|crime|courts|asean|politics)\s*:/i;

export function topicsFor(item: RawNewsItem) {
  const text = `${item.title} ${item.summary}`;
  const topics = topicRules.filter(([, rule]) => rule.test(text)).map(([label]) => label);
  return topics.length ? topics : ["Malaysia economy"];
}
function isMainStory(item: RawNewsItem) {
  const text = `${item.title} ${item.summary}`;
  return !excludedDesk.test(item.title) && economyRelated.test(text) && malaysiaSpecific.test(text);
}
function isTopUp(item: RawNewsItem, feed: NewsFeed) {
  const text = `${item.title} ${item.summary}`;
  return feed.id === "bernama-english" && !excludedDesk.test(item.title) && malaysiaSpecific.test(text) && localDevelopment.test(text);
}
function score(item: RawNewsItem) {
  return topicsFor(item).length * 2 + (/malaysia|malaysian|ringgit|bursa|bank negara|bnm/i.test(`${item.title} ${item.summary}`) ? 6 : 0)
    + (/bernama|bank negara|department of statistics|dosm|ministry of finance|mof/i.test(item.source) ? 3 : 0);
}
function emptyCounts(): NewsExclusions {
  return { parsed: 0, eligible: 0, missingDate: 0, invalidDate: 0, futureDate: 0, outOfWindow: 0, invalidUrl: 0, irrelevant: 0 };
}

export function parseRss(xml: string, feed: NewsFeed, now: Date): { items: RawNewsItem[]; counts: NewsExclusions } {
  if (!Number.isFinite(now.getTime())) throw new RangeError("News clock must be a valid date");
  const counts = emptyCounts();
  const items: RawNewsItem[] = [];
  const cutoff = now.getTime() - WEEK_MS;
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    counts.parsed++;
    const block = match[1];
    const dateValue = tag(block, "pubDate") || tag(block, "dc:date") || tag(block, "published");
    if (!cleanNewsText(dateValue)) { counts.missingDate++; continue; }
    const publishedAt = parsePublicationDate(dateValue);
    if (!publishedAt) { counts.invalidDate++; continue; }
    const timestamp = Date.parse(publishedAt);
    if (timestamp > now.getTime()) { counts.futureDate++; continue; }
    if (timestamp < cutoff) { counts.outOfWindow++; continue; }
    const link = canonicalNewsUrl(tag(block, "link"));
    if (!link) { counts.invalidUrl++; continue; }
    const publisher = sourceFrom(block, link);
    const item = {
      title: cleanTitle(tag(block, "title"), publisher.name), link, publishedAt,
      source: publisher.name, sourceUrl: publisher.url,
      summary: cleanNewsText(tag(block, "description") || tag(block, "content:encoded")).slice(0, 260),
    };
    if (!item.title || (!isMainStory(item) && !isTopUp(item, feed))) { counts.irrelevant++; continue; }
    counts.eligible++;
    items.push(item);
  }
  return { items, counts };
}

function deduplicate(items: NewsItem[]) {
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const unique: NewsItem[] = [];
  let duplicates = 0;
  for (const item of items) {
    const titleKey = item.title.normalize("NFKC").toLowerCase().replace(/^\s*\[(?:updated|update|breaking)\]\s*/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seenLinks.has(item.link) || seenTitles.has(titleKey)) { duplicates++; continue; }
    seenLinks.add(item.link);
    seenTitles.add(titleKey);
    unique.push(item);
  }
  return { unique, duplicates };
}

export function buildNewsPayload(results: NewsFeedResult[], now: Date): NewsPayload {
  if (!Number.isFinite(now.getTime())) throw new RangeError("News clock must be a valid date");
  const primary: NewsItem[] = [];
  const topUps: NewsItem[] = [];
  const sources = results.map(({ feed, xml, error }): NewsSourceAudit => {
    if (error || !xml || !/<(?:rss|rdf:RDF)\b/i.test(xml)) {
      return { ...feed, status: "unavailable", message: error ?? "This source did not return a usable RSS feed.", counts: emptyCounts() };
    }
    const parsed = parseRss(xml, feed, now);
    for (const raw of parsed.items) {
      const item = { ...raw, topics: topicsFor(raw), relevanceScore: score(raw) };
      (isMainStory(raw) ? primary : topUps).push(item);
    }
    return { ...feed, status: "fresh", message: `${parsed.counts.eligible} eligible headlines in the seven-day publication window.`, counts: parsed.counts };
  });
  const candidates = [...primary, ...(deduplicate(primary).unique.length < 12 ? topUps : [])]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.relevanceScore - a.relevanceScore);
  const { unique, duplicates } = deduplicate(candidates);
  const items = unique.slice(0, 24);
  const parsed = sources.reduce((sum, source) => sum + source.counts.parsed, 0);
  const eligible = sources.reduce((sum, source) => sum + source.counts.eligible, 0);
  const available = sources.filter((source) => source.status === "fresh").length;
  const status = !available ? "unavailable" : available < sources.length ? "partial" : "fresh";
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), status,
    refreshPolicy: "Fetched at request time from public RSS/search feeds. Publication dates are checked against the stated window; failed feeds do not supply cached or invented articles.",
    queryWindow: "Past seven days",
    window: { start: new Date(now.getTime() - WEEK_MS).toISOString(), end: now.toISOString(), days: 7 },
    counts: { parsed, eligible, excluded: parsed - eligible, duplicates, returned: items.length },
    sources, items,
    emptyReason: items.length ? null : status === "unavailable"
      ? "Headline sources are unavailable right now. No fallback articles have been invented."
      : "No eligible Malaysia economy headlines were published within the seven-day window.",
    disclaimer: "News headlines provide context only. MacroLens does not verify every article claim and does not treat headlines as statistical evidence or financial advice.",
  };
}
