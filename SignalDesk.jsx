import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Search,
  Bookmark,
  ExternalLink,
  ArrowUpRight,
  AlertTriangle,
  Loader2,
} from "lucide-react";

// ----------------------------------------------------------------------------
// SignalDesk — a curated intelligence feed for data / analytics / AI consulting.
// Pulls live stories via Claude + web search, organized by your beats.
// ----------------------------------------------------------------------------

const BEATS = [
  {
    id: "top",
    label: "The Desk",
    blurb: "Top signals across every beat",
    focus:
      "the most important recent developments across enterprise data & analytics, AI innovation, and the analytics/planning/consulting industry as reshaped by AI",
  },
  {
    id: "ai",
    label: "AI Innovation",
    blurb: "Frontier models, enterprise AI, agents",
    focus:
      "AI innovation relevant to enterprise: new frontier and enterprise models, agentic AI, AI applied to analytics and forecasting, notable research and product launches, and adoption patterns in large organizations",
  },
  {
    id: "platforms",
    label: "Data Platforms",
    blurb: "Databricks · Snowflake · Azure",
    focus:
      "enterprise data platforms specifically Databricks, Snowflake, and Microsoft Azure / Microsoft Fabric — product launches, AI features, partnerships, acquisitions, earnings, and analyst commentary",
  },
  {
    id: "planning",
    label: "Planning & EPM",
    blurb: "SAP · Pigment · Anaplan",
    focus:
      "enterprise planning, performance management (EPM/xP&A) and analytics platforms specifically SAP (SAP Analytics Cloud, SAP Datasphere, BPC, Business Data Cloud), Pigment, and Anaplan — product news, AI-in-planning features, funding, M&A, and competitive moves",
  },
  {
    id: "research",
    label: "Consulting & Research",
    blurb: "McKinsey · BCG · analyst research",
    focus:
      "business research and consulting-industry analysis: McKinsey, BCG, Bain, Deloitte, and Gartner publications on data, analytics and AI, plus reporting on how AI is reshaping the management-consulting and analytics-services business itself",
  },
];

const PREFERRED_SOURCES =
  "Prefer reputable sources: The Washington Post, McKinsey, BCG, Bain, Deloitte, Gartner, MIT Sloan, HBR, the Financial Times, Reuters, Bloomberg, The Information, official vendor newsrooms (Databricks, Snowflake, Microsoft, SAP, Pigment, Anaplan), and credible trade press. Avoid low-quality SEO/aggregator pages.";

function buildPrompt(focus, custom) {
  const subject = custom
    ? `the user's specific query: "${custom}"`
    : focus;
  const mckinseySupplement = !custom
    ? `\nImportant: explicitly search mckinsey.com for recent articles and include at least 2 items from McKinsey in your results.`
    : "";
  return `You are the editor of a private intelligence briefing for a senior leader working in data & analytics and AI consulting.

Search the web for the most relevant items from roughly the last 3 weeks on ${subject}.${mckinseySupplement}

${PREFERRED_SOURCES}

Return a JSON array of 6 items and NOTHING else — no preamble, no markdown, no code fences. Start your reply with "[" . Each item is an object with these string fields:
- "title": the headline
- "source": the publication or organization
- "url": a direct link to the item
- "date": publication date as "Mon DD, YYYY" (or "" if unknown)
- "tag": ONE short topic tag, 1-3 words (e.g. "Databricks", "AI Agents", "McKinsey")
- "summary": ONE sentence, factual, neutral, under 30 words
- "relevance": ONE short sentence on why it matters to a data/analytics/AI planning & consulting leader

Keep every field tight. Output ONLY the JSON array, starting with [ and ending with ].`;
}

function extractItems(raw) {
  if (!raw) return [];
  let t = raw.replace(/```json/gi, "").replace(/```/g, "");
  // 1) Try a clean full-array parse.
  const s = t.indexOf("[");
  const e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e > s) {
    try {
      const arr = JSON.parse(t.slice(s, e + 1));
      if (Array.isArray(arr)) return arr;
    } catch (_) {
      /* fall through to salvage */
    }
  }
  // 2) Salvage: pull out every complete {...} object, even if the array was cut off.
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
        } catch (_) {
          /* skip malformed */
        }
        start = -1;
      }
    }
  }
  return items;
}

async function fetchFeed({ focus, custom }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: buildPrompt(focus, custom) }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err).slice(0, 200);
    } catch (_) {}
    throw new Error(detail);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const items = extractItems(text).filter((i) => i && i.title);
  items.sort((a, b) => {
    const da = a.date ? new Date(a.date) : new Date(0);
    const db = b.date ? new Date(b.date) : new Date(0);
    return db - da;
  });
  if (items.length === 0) {
    throw new Error(
      "No stories parsed from the response" +
        (text ? ` (got ${text.length} chars of text)` : " (empty response)")
    );
  }
  return items;
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.sd-root{
  --paper:#f3ede1; --card:#fbf8f1; --ink:#191712; --ink-soft:#5e574a;
  --line:#ddd3bf; --line-soft:#e8e0cf; --accent:#23459e; --accent-deep:#1a3578;
  --signal:#b14528; --gold:#9a7b1f;
  background:var(--paper); color:var(--ink);
  font-family:'IBM Plex Sans',sans-serif; min-height:100%;
  background-image:radial-gradient(rgba(120,100,60,.05) 1px, transparent 1px);
  background-size:4px 4px;
}
.sd-mono{font-family:'IBM Plex Mono',monospace;}
.sd-serif{font-family:'Fraunces',serif;}

.sd-wrap{max-width:1080px;margin:0 auto;padding:0 22px 80px;}

.sd-masthead{border-bottom:3px double var(--ink);padding:30px 0 18px;margin-bottom:0;}
.sd-kicker{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--signal);font-weight:500;}
.sd-title{font-family:'Fraunces',serif;font-weight:800;font-size:clamp(38px,7vw,68px);
  line-height:.92;letter-spacing:-.02em;margin:6px 0 4px;}
.sd-sub{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft);
  display:flex;gap:14px;flex-wrap:wrap;align-items:center;}
.sd-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;}

.sd-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  padding:14px 0;border-bottom:1px solid var(--line);position:sticky;top:0;
  background:var(--paper);z-index:5;}
.sd-search{flex:1;min-width:220px;display:flex;align-items:center;gap:8px;
  background:var(--card);border:1px solid var(--line);border-radius:2px;padding:9px 12px;}
.sd-search input{border:none;background:transparent;outline:none;flex:1;
  font-family:'IBM Plex Sans',sans-serif;font-size:14px;color:var(--ink);}
.sd-search input::placeholder{color:#9b9race;color:#a59c89;}
.sd-btn{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.04em;
  border:1px solid var(--ink);background:var(--ink);color:var(--paper);
  padding:9px 14px;border-radius:2px;cursor:pointer;display:flex;align-items:center;
  gap:7px;transition:all .15s;text-transform:uppercase;}
.sd-btn:hover{background:var(--accent);border-color:var(--accent);}
.sd-btn.ghost{background:transparent;color:var(--ink);}
.sd-btn.ghost:hover{background:var(--ink);color:var(--paper);}

.sd-beats{display:flex;gap:0;flex-wrap:wrap;border-bottom:1px solid var(--line);
  margin-bottom:6px;}
.sd-beat{padding:14px 16px 12px;cursor:pointer;border-bottom:3px solid transparent;
  margin-bottom:-1px;transition:all .15s;}
.sd-beat:hover{background:var(--line-soft);}
.sd-beat.active{border-bottom-color:var(--signal);}
.sd-beat-l{font-family:'Fraunces',serif;font-weight:600;font-size:16px;display:block;}
.sd-beat.active .sd-beat-l{color:var(--signal);}
.sd-beat-b{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--ink-soft);
  letter-spacing:.02em;}

.sd-feed{display:grid;gap:0;}
.sd-card{padding:22px 4px;border-bottom:1px solid var(--line);
  display:grid;grid-template-columns:1fr auto;gap:14px;animation:rise .5s both;}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sd-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:7px;}
.sd-tag{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;background:var(--accent);color:#fff;padding:3px 7px;border-radius:2px;}
.sd-new{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;background:var(--signal);color:#fff;padding:3px 7px;border-radius:2px;}
.sd-src{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink);font-weight:500;}
.sd-date{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-soft);}
.sd-head{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(19px,2.4vw,24px);
  line-height:1.15;letter-spacing:-.01em;margin:0 0 8px;}
.sd-head a{color:var(--ink);text-decoration:none;background-image:linear-gradient(var(--signal),var(--signal));
  background-size:0% 1.5px;background-repeat:no-repeat;background-position:0 100%;transition:background-size .25s;}
.sd-head a:hover{background-size:100% 1.5px;color:var(--accent-deep);}
.sd-summary{font-size:14.5px;line-height:1.55;color:#34302a;margin:0 0 10px;max-width:62ch;}
.sd-why{display:flex;gap:9px;align-items:flex-start;border-left:2px solid var(--gold);
  padding-left:11px;max-width:62ch;}
.sd-why-l{font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--gold);padding-top:2px;white-space:nowrap;font-weight:500;}
.sd-why-t{font-size:13px;line-height:1.5;font-style:italic;color:#46402f;}
.sd-actions{display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.sd-icon{background:none;border:1px solid var(--line);border-radius:2px;padding:7px;
  cursor:pointer;color:var(--ink-soft);transition:all .15s;line-height:0;}
.sd-icon:hover{border-color:var(--ink);color:var(--ink);}
.sd-icon.on{background:var(--gold);border-color:var(--gold);color:#fff;}

.sd-skel{padding:22px 4px;border-bottom:1px solid var(--line);}
.sd-sk{background:linear-gradient(90deg,var(--line-soft),#efe8d8,var(--line-soft));
  background-size:200% 100%;animation:sh 1.3s infinite;border-radius:2px;}
@keyframes sh{from{background-position:200% 0}to{background-position:-200% 0}}

.sd-empty,.sd-err{text-align:center;padding:60px 20px;color:var(--ink-soft);}
.sd-err{color:var(--signal);}
.sd-foot{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink-soft);
  text-align:center;padding-top:26px;line-height:1.7;}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:560px){.sd-card{grid-template-columns:1fr}.sd-actions{flex-direction:row}}
`;

function Skeleton() {
  return (
    <div className="sd-skel">
      <div className="sd-sk" style={{ height: 12, width: 140, marginBottom: 12 }} />
      <div className="sd-sk" style={{ height: 22, width: "75%", marginBottom: 10 }} />
      <div className="sd-sk" style={{ height: 12, width: "90%", marginBottom: 6 }} />
      <div className="sd-sk" style={{ height: 12, width: "55%" }} />
    </div>
  );
}

export default function SignalDesk() {
  const [beat, setBeat] = useState("top");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(null);
  const [saved, setSaved] = useState({});
  const [showSaved, setShowSaved] = useState(false);

  const load = useCallback(async (opts) => {
    setLoading(true);
    setError("");
    setShowSaved(false);
    try {
      const data = await fetchFeed(opts);
      setItems(data);
      setUpdated(new Date());
    } catch (e) {
      setError(
        "Couldn't assemble the briefing. Tap refresh to retry.\n\nDetail: " +
          (e?.message || "unknown error")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const b = BEATS.find((x) => x.id === beat);
    load({ focus: b.focus, custom: activeQuery });
  }, [beat, activeQuery, load]);

  const runSearch = () => {
    const q = query.trim();
    setActiveQuery(q);
    if (!q) {
      const b = BEATS.find((x) => x.id === beat);
      load({ focus: b.focus, custom: "" });
    }
  };

  const toggleSave = (item) => {
    const key = item.url || item.title;
    setSaved((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = item;
      return next;
    });
  };

  const savedList = Object.values(saved);
  const visible = showSaved ? savedList : items;
  const activeBeat = BEATS.find((x) => x.id === beat);

  return (
    <div className="sd-root">
      <style>{STYLES}</style>
      <div className="sd-wrap">
        <header className="sd-masthead">
          <span className="sd-kicker">Private Intelligence Briefing</span>
          <h1 className="sd-title sd-serif">Signal Desk</h1>
          <div className="sd-sub">
            <span>Data &amp; Analytics</span>
            <span className="sd-dot" />
            <span>AI Innovation</span>
            <span className="sd-dot" />
            <span>Planning &amp; Consulting</span>
            <span className="sd-dot" />
            <span>
              {updated
                ? `Updated ${updated.toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Assembling…"}
            </span>
          </div>
        </header>

        <nav className="sd-beats">
          {BEATS.map((b) => (
            <div
              key={b.id}
              className={`sd-beat ${beat === b.id && !showSaved ? "active" : ""}`}
              onClick={() => {
                setQuery("");
                setActiveQuery("");
                setBeat(b.id);
              }}
            >
              <span className="sd-beat-l sd-serif">{b.label}</span>
              <span className="sd-beat-b">{b.blurb}</span>
            </div>
          ))}
        </nav>

        <div className="sd-controls">
          <div className="sd-search">
            <Search size={15} color="#a59c89" />
            <input
              value={query}
              placeholder={`Search within ${activeBeat.label}…  (e.g. "Anaplan AI forecasting")`}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
          </div>
          <button className="sd-btn" onClick={runSearch}>
            Search
          </button>
          <button
            className="sd-btn ghost"
            onClick={() => setShowSaved((s) => !s)}
          >
            <Bookmark size={13} />
            {showSaved ? "Feed" : `Saved (${savedList.length})`}
          </button>
          <button
            className="sd-btn ghost"
            onClick={() =>
              load({ focus: activeBeat.focus, custom: activeQuery })
            }
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>

        {activeQuery && !showSaved && (
          <div
            className="sd-mono"
            style={{ fontSize: 11, color: "#8a8270", padding: "12px 4px 0" }}
          >
            ▸ results for “{activeQuery}”
          </div>
        )}

        <div className="sd-feed">
          {loading && !showSaved ? (
            [...Array(6)].map((_, i) => <Skeleton key={i} />)
          ) : error && !showSaved ? (
            <div className="sd-err">
              <AlertTriangle size={26} style={{ marginBottom: 10 }} />
              <p style={{ maxWidth: 380, margin: "0 auto", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {error}
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="sd-empty">
              {showSaved
                ? "No saved stories yet — tap the bookmark on any item to keep it here."
                : "No items found. Try another beat or search."}
            </div>
          ) : (
            visible.map((item, i) => {
              const key = item.url || item.title;
              const isSaved = !!saved[key];
              return (
                <article
                  className="sd-card"
                  key={key + i}
                  style={{ animationDelay: `${Math.min(i * 0.05, 0.4)}s` }}
                >
                  <div>
                    <div className="sd-meta">
                      {item.isNew && <span className="sd-new">New</span>}
                      {item.tag && <span className="sd-tag">{item.tag}</span>}
                      {item.source && (
                        <span className="sd-src">{item.source}</span>
                      )}
                      {item.date && <span className="sd-date">{item.date}</span>}
                    </div>
                    <h2 className="sd-head sd-serif">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h2>
                    {item.summary && (
                      <p className="sd-summary">{item.summary}</p>
                    )}
                    {item.relevance && (
                      <div className="sd-why">
                        <span className="sd-why-l">Why it matters</span>
                        <span className="sd-why-t">{item.relevance}</span>
                      </div>
                    )}
                  </div>
                  <div className="sd-actions">
                    <button
                      className={`sd-icon ${isSaved ? "on" : ""}`}
                      onClick={() => toggleSave(item)}
                      title={isSaved ? "Unsave" : "Save"}
                    >
                      <Bookmark size={15} />
                    </button>
                    {item.url && (
                      <a
                        className="sd-icon"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open"
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="sd-foot">
          Signal Desk — assembled live via Claude + web search.
          <br />
          Links open at the source; use your own Washington Post / McKinsey
          access to read in full.
        </div>
      </div>
    </div>
  );
}
