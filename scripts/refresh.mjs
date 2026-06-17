// scripts/refresh.mjs
// Assembles the Signal Desk briefing:
//   - RSS feeds for vendor/tech beats
//   - Claude web_search for consulting sources (McKinsey, BCG, Gartner etc.)
//     which block RSS readers and require active web search to reach
//
// Required environment variables:
//   ANTHROPIC_API_KEY  – from console.anthropic.com

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "feed.json");

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const ITEMS_PER_BEAT = 10;
const MAX_ITEMS_PER_PROMPT = 40;

// Delay between Claude calls (ms) to stay under rate limits.
const BEAT_DELAY_MS = 20_000;

// ---------------------------------------------------------------------------
// BEATS
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
    // Web search queries supplement RSS with consulting perspective
    webSearchQueries: [
      "site:mckinsey.com AI OR analytics OR data 2025 OR 2026",
      "site:bcg.com AI OR analytics OR data 2025 OR 2026",
    ],
  },
  {
    id: "ai",
    focus:
      "AI innovation relevant to enterprise: new frontier and enterprise models, agentic AI, AI applied to analytics and forecasting, notable research and product launches, and adoption patterns in large organizations",
    feeds: [
      "https://www.technologyreview.com/feed/",
      "https://openai.com/news/rss.xml",
      "https://www.databricks.com/feed",
      "https://venturebeat.com/category/ai/feed/",
      "https://techcrunch.com/category/artificial-intelligence/feed/",
    ],
    webSearchQueries: [
      // Frontier labs publish via JS pages, not RSS — reach them via search.
      "Anthropic Claude OR OpenAI OR Google Gemini frontier model OR agentic AI launch 2025 OR 2026",
      "enterprise AI adoption OR agentic AI deployment large organizations 2025 OR 2026",
      "site:mckinsey.com generative AI OR agentic AI enterprise 2025 OR 2026",
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
    // Vendor RSS only carries self-promotion; web search adds the earnings,
    // M&A, partnership and analyst coverage this beat's focus calls for.
    webSearchQueries: [
      "Databricks product OR funding OR acquisition OR earnings OR analyst news 2025 OR 2026",
      "Snowflake product OR earnings OR Cortex AI OR partnership news 2025 OR 2026",
      "Microsoft Fabric OR Azure data platform launch OR analyst commentary 2025 OR 2026",
    ],
  },
  {
    id: "planning",
    focus:
      "enterprise planning, performance management (EPM / xP&A) and analytics platforms specifically SAP (SAP Analytics Cloud, SAP Datasphere, Business Data Cloud, BPC), Pigment, and Anaplan: product news, AI-in-planning features, funding, M&A, competitive moves, and broader strategy on enterprise planning and finance transformation",
    feeds: [
      "https://news.sap.com/feed/",
      "https://techcrunch.com/feed/",
      "https://venturebeat.com/feed/",
    ],
    // Pigment and Anaplan get both an open-web query (third-party coverage)
    // and a site:-scoped query against their own newsrooms (first-party posts),
    // since neither publishes a usable public RSS feed. Plus a general EPM/
    // planning query and the consulting sources.
    webSearchQueries: [
      "Pigment planning software product OR funding OR AI news 2025 OR 2026",
      "site:pigment.com newsroom OR blog OR announcement 2025 OR 2026",
      "Anaplan EPM OR connected planning product OR AI OR customer news 2025 OR 2026",
      "site:anaplan.com blog OR news OR press release 2025 OR 2026",
      "enterprise planning OR EPM OR xP&A OR FP&A software news 2025 OR 2026",
      "site:mckinsey.com enterprise planning OR finance transformation OR scenario planning 2025 OR 2026",
      "site:bcg.com enterprise planning OR FP&A OR finance transformation 2025 OR 2026",
    ],
  },
  {
    id: "research",
    focus:
      "business research and consulting-industry analysis: McKinsey, BCG, Bain, Deloitte and Gartner publications on data, analytics and AI, plus reporting on how AI is reshaping the management-consulting and analytics-services business itself",
    feeds: [
      "https://www.technologyreview.com/feed/",
      "https://venturebeat.com/category/ai/feed/",
    ],
    // One search per firm so results aren't diluted
    webSearchQueries: [
      "site:mckinsey.com AI OR data OR analytics 2025 OR 2026",
      "site:bcg.com AI OR data OR analytics 2025 OR 2026",
      "site:bain.com AI OR data OR analytics 2025 OR 2026",
      "site:deloitte.com AI OR data OR analytics insights 2025 OR 2026",
      "site:gartner.com AI OR data analytics enterprise 2025 OR 2026",
      "site:hbr.org AI OR analytics enterprise 2025 OR 2026",
      // The second half of this beat's focus: AI disrupting consulting itself.
      "management consulting AI disruption OR layoffs OR pricing model OR Accenture OR McKinsey AI services 2025 OR 2026",
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
// Claude web_search — used to reach consulting sources that block RSS
// ---------------------------------------------------------------------------

async function webSearch(queries, apiKey) {
  if (!queries || queries.length === 0) return [];

  const queryList = queries.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const prompt = `Search the web using each of the following queries and return all relevant articles you find. For each article found, provide the title, URL, publication date, and a brief summary.

Queries:
${queryList}

Return a JSON array. Each item must have:
- "title": article headline
- "url": direct link
- "date": publication date as "Mon DD, YYYY" (or "" if unknown)
- "summary": one sentence description

Return ONLY the JSON array starting with [. Find as many real articles as possible — aim for at least 2-3 results per query.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        // Default max_uses is 5; give Claude one search per query plus headroom
        // so beats with many queries (e.g. research, planning) don't get truncated.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: queries.length + 3 }],
        messages: [{ role: "user", content: prompt }],
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

    const items = extractItems(text).filter((i) => i && i.title && i.url);
    console.log(`    Web search returned ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`    Web search failed: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Claude curation prompt
// ---------------------------------------------------------------------------

function buildPrompt(focus, items, beatId) {
  const capped = items.slice(0, MAX_ITEMS_PER_PROMPT);
  const context = capped
    .map((item, i) =>
      `[${i + 1}] ${item.title}\nURL: ${item.url}\nDate: ${item.date || "unknown"}\n${item.summary || ""}`
    )
    .join("\n\n");

  const planningNote = beatId === "planning"
    ? "\nIMPORTANT: Include articles about Pigment, Anaplan, and broader enterprise planning / FP&A strategy (e.g. scenario planning, finance transformation). Do NOT let SAP fill more than 3 of the 10 slots."
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

async function fetchBeat(beat, apiKey) {
  const rssItems = await collectRssItems(beat.feeds);
  const webItems = beat.webSearchQueries
    ? await webSearch(beat.webSearchQueries, apiKey)
    : [];

  // Merge — web search results first so consulting sources lead the prompt
  const seen = new Set();
  const allItems = [];
  for (const item of [...webItems, ...rssItems]) {
    if (item.url && !seen.has(item.url)) { seen.add(item.url); allItems.push(item); }
  }

  console.log(`    ${rssItems.length} RSS + ${webItems.length} web = ${allItems.length} total (sending ${Math.min(allItems.length, MAX_ITEMS_PER_PROMPT)} to Claude)`);

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
// Feed loader
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }

  const feed = await loadExisting();
  feed.beats = feed.beats || {};
  const previousUrls = buildPreviousUrls(feed);

  for (const beat of BEATS) {
    try {
      console.log(`\nBeat: ${beat.id}`);
      const items = await fetchBeat(beat, apiKey);
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
    console.log(`  (waiting ${BEAT_DELAY_MS / 1000}s before next beat…)`);
    await new Promise((r) => setTimeout(r, BEAT_DELAY_MS));
  }

  feed.generatedAt = new Date().toISOString();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
