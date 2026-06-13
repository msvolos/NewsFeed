// scripts/refresh.mjs
// Assembles the Signal Desk briefing using a hybrid approach:
//   - Beats 1-4: RSS feeds (completely free, no API key needed)
//   - Beat 5 (research/consulting): Google Custom Search (free tier: 3,000 queries/month)
//     targets mckinsey.com, bcg.com, gartner.com, deloitte.com etc. directly
//
// Required environment variables:
//   ANTHROPIC_API_KEY  – from console.anthropic.com
//   GOOGLE_API_KEY     – from console.cloud.google.com (Custom Search API)
//   GOOGLE_CSE_ID      – your Programmable Search Engine ID

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "feed.json");

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

const ITEMS_PER_BEAT = 10;

// How many feed items to pass to Claude per beat. Capped to avoid rate limits.
const MAX_ITEMS_PER_PROMPT = 40;

// Delay between Claude calls (ms). 20s keeps us well under the 30k token/min limit.
const BEAT_DELAY_MS = 20_000;

// ---------------------------------------------------------------------------
// BEATS — edit focus/feeds/googleQueries to retune each tab
// ---------------------------------------------------------------------------

const BEATS = [
  {
    id: "top",
    focus:
      "the most important recent developments across enterprise data & analytics, AI innovation, and the analytics / planning / consulting industry as reshaped by AI",
    feeds: [
      "https://www.databricks.com/feed",
      "https://www.snowflake.com/feed/",
      "https://www.technologyreview.com/feed/",
      "https://venturebeat.com/feed/",
      "https://techcrunch.com/feed/",
    ],
    googleQueries: [
      { q: "AI OR analytics OR data",          site: "mckinsey.com" },
      { q: "AI OR analytics OR data",          site: "bcg.com" },
      { q: "AI OR analytics enterprise",       site: "hbr.org" },
    ],
  },
  {
    id: "ai",
    focus:
      "AI innovation relevant to enterprise: new frontier and enterprise models, agentic AI, AI applied to analytics and forecasting, notable research and product launches, and adoption patterns in large organizations",
    feeds: [
      "https://www.technologyreview.com/feed/",
      "https://openai.com/blog/rss.xml",
      "https://www.databricks.com/feed",
      "https://venturebeat.com/category/ai/feed/",
      "https://techcrunch.com/category/artificial-intelligence/feed/",
    ],
    googleQueries: [
      { q: "AI agents OR generative AI OR LLM enterprise", site: "mckinsey.com" },
      { q: "AI enterprise adoption",                       site: "gartner.com" },
    ],
  },
  {
    id: "platforms",
    focus:
      "enterprise data platforms specifically Databricks, Snowflake, and Microsoft Azure / Microsoft Fabric: product launches, AI features, partnerships, acquisitions, earnings, and analyst commentary",
    feeds: [
      "https://www.databricks.com/feed",
      "https://www.snowflake.com/feed/",
      "https://azure.microsoft.com/en-us/blog/feed/",
      "https://techcrunch.com/feed/",
      "https://venturebeat.com/feed/",
    ],
    googleQueries: [
      { q: "Databricks OR Snowflake OR Microsoft Fabric", site: "gartner.com" },
    ],
  },
  {
    id: "planning",
    focus:
      "enterprise planning, performance management (EPM / xP&A) and analytics platforms specifically SAP (SAP Analytics Cloud, SAP Datasphere, Business Data Cloud, BPC), Pigment, and Anaplan: product news, AI-in-planning features, funding, M&A, competitive moves, and broader strategy on enterprise planning and finance transformation",
    feeds: [
      // SAP is capped to 5 items in Claude's selection to prevent it from dominating
      "https://news.sap.com/feed/",
      "https://techcrunch.com/feed/",
      "https://venturebeat.com/feed/",
    ],
    googleQueries: [
      { q: "Anaplan AI planning OR forecasting OR EPM",    site: "techcrunch.com" },
      { q: "Pigment planning software OR FP&A",           site: "techcrunch.com" },
      { q: "enterprise planning OR xP&A OR FP&A AI",      site: "gartner.com" },
      { q: "enterprise planning OR finance transformation OR scenario planning", site: "mckinsey.com" },
      { q: "enterprise planning OR FP&A OR EPM AI",       site: "bcg.com" },
    ],
  },
  {
    id: "research",
    focus:
      "business research and consulting-industry analysis: McKinsey, BCG, Bain, Deloitte and Gartner publications on data, analytics and AI, plus reporting on how AI is reshaping the management-consulting and analytics-services business itself",
    // One query per major source so results aren't diluted by a single provider.
    // ~7 queries/day = ~210/month, well within the 3,000/month free limit.
    googleQueries: [
      { q: "AI OR data OR analytics",          site: "mckinsey.com" },
      { q: "AI OR data OR analytics",          site: "bcg.com" },
      { q: "AI OR data OR analytics insights", site: "deloitte.com" },
      { q: "AI OR data analytics enterprise",  site: "gartner.com" },
      { q: "AI OR analytics enterprise",       site: "hbr.org" },
      { q: "AI OR data OR analytics",          site: "bain.com" },
    ],
    feeds: [
      "https://www.technologyreview.com/feed/",
      "https://venturebeat.com/category/ai/feed/",
    ],
  },
];

const PREFERRED_SOURCES =
  "Prefer reputable sources: McKinsey, BCG, Bain, Deloitte, Gartner, MIT Sloan, HBR, the Financial Times, Reuters, Bloomberg, official vendor newsrooms (Databricks, Snowflake, Microsoft, SAP, Anaplan), and credible trade press. Skip low-quality SEO or aggregator pages.";

// ---------------------------------------------------------------------------
// RSS parser (no npm deps — handles RSS 2.0 and Atom)
// ---------------------------------------------------------------------------

function parseXml(xml) {
  const items = [];
  const tag = xml.includes("<entry") ? "entry" : "item";
  const re = new RegExp(`<${tag}[\\s>]([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const get = (t) => {
      const cdataRe = new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, "i");
      const plainRe = new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`, "i");
      const hrefRe  = new RegExp(`<${t}[^>]+href="([^"]+)"`, "i");
      return (
        (cdataRe.exec(block) || [])[1]?.trim() ||
        (plainRe.exec(block) || [])[1]?.trim() ||
        (hrefRe.exec(block)  || [])[1]?.trim() ||
        ""
      );
    };
    const title   = get("title");
    const url     = get("link") || get("id");
    const date    = get("pubDate") || get("published") || get("updated") || "";
    const summary = (get("description") || get("summary") || get("content") || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    if (title && url) {
      items.push({
        title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        url, date, summary,
      });
    }
  }
  return items;
}

async function fetchFeed(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseXml(await res.text());
  } catch (err) {
    console.warn(`    RSS ${url} failed: ${err.message}`);
    return [];
  }
}

async function collectRssItems(feeds = []) {
  const seen = new Set();
  const all  = [];
  for (const url of feeds) {
    for (const item of await fetchFeed(url)) {
      if (!seen.has(item.url)) { seen.add(item.url); all.push(item); }
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Google Custom Search
// ---------------------------------------------------------------------------

async function googleSearch({ q, site }, apiKey, cseId) {
  const url = new URL(GOOGLE_SEARCH_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx",  cseId);
  url.searchParams.set("q",   q);
  url.searchParams.set("num", "10");
  url.searchParams.set("dateRestrict", "w3"); // past 3 weeks
  if (site) {
    url.searchParams.set("siteSearch", site);
    url.searchParams.set("siteSearchFilter", "i"); // include only this site
  }

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0,300))}`);
    const data = await res.json();
    return (data.items || []).map((item) => ({
      title:   item.title || "",
      url:     item.link  || "",
      date:    item.pagemap?.metatags?.[0]?.["article:published_time"] || "",
      summary: item.snippet || "",
    }));
  } catch (err) {
    console.warn(`    Google search "${q}"${site ? ` [${site}]` : ""} failed: ${err.message}`);
    return [];
  }
}

async function collectGoogleItems(queries = [], apiKey, cseId) {
  const seen = new Set();
  const all  = [];
  for (const q of queries) {
    for (const item of await googleSearch(q, apiKey, cseId)) {
      if (!seen.has(item.url)) { seen.add(item.url); all.push(item); }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return all;
}

// ---------------------------------------------------------------------------
// Claude prompt
// ---------------------------------------------------------------------------

function buildPrompt(focus, items, beatId) {
  // Cap items to avoid hitting token limits
  const capped = items.slice(0, MAX_ITEMS_PER_PROMPT);
  const context = capped
    .map((item, i) =>
      `[${i + 1}] ${item.title}\nURL: ${item.url}\nDate: ${item.date || "unknown"}\n${item.summary}`
    )
    .join("\n\n");

  const planningNote = beatId === "planning"
    ? "\nIMPORTANT: Include articles about Pigment, Anaplan, and broader enterprise planning / FP&A strategy (e.g. scenario planning, finance transformation) — do NOT let SAP articles fill more than 3 of the 10 slots even if there are many SAP items available."
    : "";

  return `You are the editor of a private intelligence briefing for a senior leader in data & analytics and AI consulting.

Below are recent items on the topic: ${focus}.

${PREFERRED_SOURCES}${planningNote}

--- ITEMS ---
${context}
--- END ITEMS ---

Using ONLY the items above (do not invent sources or URLs), select the ${ITEMS_PER_BEAT} most relevant stories. Skip off-topic items. If fewer than ${ITEMS_PER_BEAT} good items exist, return however many there are.

Return a JSON array and NOTHING else — no preamble, no markdown, no code fences. Start your reply with "[". Each item must have these string fields:
- "title": the headline
- "source": publication or organization (infer from URL domain if needed)
- "url": copied exactly from the item above
- "date": publication date as "Mon DD, YYYY" (or "" if unknown)
- "tag": ONE short topic tag, 1-3 words (e.g. "McKinsey", "AI Agents", "SAP")
- "summary": one or two sentences, factual and neutral
- "relevance": ONE sentence on why it matters to a data / analytics / AI planning & consulting leader

Output ONLY the JSON array, starting with [ and ending with ].`;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractItems(raw) {
  if (!raw) return [];
  const t = raw.replace(/```json/gi, "").replace(/```/g, "");
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e > s) {
    try { const arr = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(arr)) return arr; }
    catch { /* fall through */ }
  }
  const items = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { items.push(JSON.parse(t.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Per-beat fetcher
// ---------------------------------------------------------------------------

async function fetchBeat(beat, apiKey, googleApiKey, googleCseId) {
  const rssItems    = await collectRssItems(beat.feeds);
  const googleItems = beat.googleQueries
    ? await collectGoogleItems(beat.googleQueries, googleApiKey, googleCseId)
    : [];

  // Merge — Google results first so consulting sources lead the prompt
  const seen = new Set();
  const allItems = [];
  for (const item of [...googleItems, ...rssItems]) {
    if (item.url && !seen.has(item.url)) { seen.add(item.url); allItems.push(item); }
  }

  console.log(`    ${rssItems.length} RSS + ${googleItems.length} Google = ${allItems.length} total items (sending ${Math.min(allItems.length, MAX_ITEMS_PER_PROMPT)} to Claude)`);

  if (allItems.length === 0) throw new Error("no items retrieved");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: buildPrompt(beat.focus, allItems, beat.id) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return extractItems(text).filter((i) => i && i.title);
}

// ---------------------------------------------------------------------------
// Existing feed loader
// ---------------------------------------------------------------------------

async function loadExisting() {
  try { return JSON.parse(await readFile(OUT, "utf8")); }
  catch { return { generatedAt: null, beats: {} }; }
}

function buildPreviousUrls(feed) {
  const urls = new Set();
  for (const items of Object.values(feed.beats || {})) {
    for (const item of items) { if (item.url) urls.add(item.url); }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey       = process.env.ANTHROPIC_API_KEY;
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const googleCseId  = process.env.GOOGLE_CSE_ID;

  if (!apiKey)       { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  if (!googleApiKey) { console.error("GOOGLE_API_KEY is not set."); process.exit(1); }
  if (!googleCseId)  { console.error("GOOGLE_CSE_ID is not set."); process.exit(1); }

  const feed = await loadExisting();
  feed.beats = feed.beats || {};
  const previousUrls = buildPreviousUrls(feed);

  for (const beat of BEATS) {
    try {
      console.log(`\nBeat: ${beat.id}`);
      const items = await fetchBeat(beat, apiKey, googleApiKey, googleCseId);
      if (items.length) {
        for (const item of items) {
          item.isNew = previousUrls.size > 0 && !!item.url && !previousUrls.has(item.url);
        }
        items.sort((a, b) => {
          const da = a.date ? new Date(a.date) : new Date(0);
          const db = b.date ? new Date(b.date) : new Date(0);
          return db - da;
        });
        feed.beats[beat.id] = items;
        console.log(`  ✓ ${items.length} stories`);
      } else {
        console.warn(`  ! no stories parsed for ${beat.id}; keeping previous`);
      }
    } catch (err) {
      console.warn(`  ! ${beat.id} failed: ${err.message}; keeping previous`);
    }
    console.log(`  (waiting ${BEAT_DELAY_MS/1000}s before next beat…)`);
    await new Promise((r) => setTimeout(r, BEAT_DELAY_MS));
  }

  feed.generatedAt = new Date().toISOString();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
