// scripts/refresh.mjs
// Assembles the Signal Desk briefing by calling the Claude API with web search,
// then writes the curated stories to data/feed.json.
//
// Runs in GitHub Actions (or locally). Requires Node 18+ (global fetch) and
// the ANTHROPIC_API_KEY environment variable. No npm dependencies.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "feed.json");

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";
const ITEMS_PER_BEAT = 10;

// ---- Your beats. Edit the `focus` text to retune what each tab pulls. -------
const BEATS = [
  {
    id: "top",
    focus:
      "the most important recent developments across enterprise data & analytics, AI innovation, and the analytics / planning / consulting industry as reshaped by AI",
  },
  {
    id: "ai",
    focus:
      "AI innovation relevant to enterprise: new frontier and enterprise models, agentic AI, AI applied to analytics and forecasting, notable research and product launches, and adoption patterns in large organizations",
  },
  {
    id: "platforms",
    focus:
      "enterprise data platforms specifically Databricks, Snowflake, and Microsoft Azure / Microsoft Fabric: product launches, AI features, partnerships, acquisitions, earnings, and analyst commentary",
  },
  {
    id: "planning",
    focus:
      "enterprise planning, performance management (EPM / xP&A) and analytics platforms specifically SAP (SAP Analytics Cloud, SAP Datasphere, Business Data Cloud, BPC), Pigment, and Anaplan: product news, AI-in-planning features, funding, M&A, and competitive moves",
  },
  {
    id: "research",
    focus:
      "business research and consulting-industry analysis: McKinsey, BCG, Bain, Deloitte and Gartner publications on data, analytics and AI, plus reporting on how AI is reshaping the management-consulting and analytics-services business itself",
  },
];

const PREFERRED_SOURCES =
  "Prefer reputable sources: The Washington Post, McKinsey, BCG, Bain, Deloitte, Gartner, MIT Sloan, HBR, the Financial Times, Reuters, Bloomberg, The Information, official vendor newsrooms (Databricks, Snowflake, Microsoft, SAP, Pigment, Anaplan), and credible trade press. Avoid low-quality SEO / aggregator pages.";

function buildPrompt(focus) {
  return `You are the editor of a private intelligence briefing for a senior leader in data & analytics and AI consulting.

Search the web for the most relevant items from roughly the last 3 weeks on ${focus}.

${PREFERRED_SOURCES}

Return a JSON array of ${ITEMS_PER_BEAT} items and NOTHING else — no preamble, no markdown, no code fences. Start your reply with "[". Each item is an object with these string fields:
- "title": the headline
- "source": the publication or organization
- "url": a direct link to the item
- "date": publication date as "Mon DD, YYYY" (or "" if unknown)
- "tag": ONE short topic tag, 1-3 words (e.g. "Databricks", "AI Agents", "McKinsey")
- "summary": one or two sentences, factual and neutral
- "relevance": ONE sentence on why it matters to a data / analytics / AI planning & consulting leader

Output ONLY the JSON array, starting with [ and ending with ].`;
}

// Salvage every complete {...} object even if the response is truncated.
function extractItems(raw) {
  if (!raw) return [];
  const t = raw.replace(/```json/gi, "").replace(/```/g, "");
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e > s) {
    try {
      const arr = JSON.parse(t.slice(s, e + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      /* fall through */
    }
  }
  const items = [];
  let depth = 0,
    start = -1,
    inStr = false,
    esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          items.push(JSON.parse(t.slice(start, i + 1)));
        } catch {
          /* skip */
        }
        start = -1;
      }
    }
  }
  return items;
}

async function fetchBeat(focus, apiKey) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: buildPrompt(focus) }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return extractItems(text).filter((i) => i && i.title);
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return { generatedAt: null, beats: {} };
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const feed = await loadExisting();
  feed.beats = feed.beats || {};

  for (const beat of BEATS) {
    try {
      console.log(`Fetching beat: ${beat.id}…`);
      const items = await fetchBeat(beat.focus, apiKey);
      if (items.length) {
        feed.beats[beat.id] = items;
        console.log(`  ✓ ${items.length} stories`);
      } else {
        console.warn(`  ! no stories parsed for ${beat.id}; keeping previous`);
      }
    } catch (err) {
      console.warn(`  ! ${beat.id} failed: ${err.message}; keeping previous`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // gentle pacing
  }

  feed.generatedAt = new Date().toISOString();

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
