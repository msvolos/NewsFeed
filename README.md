# Signal Desk

A private, self-updating intelligence briefing for **data & analytics, AI innovation, and the analytics / planning / consulting world** — refreshed automatically every day.

It pulls current stories via a hybrid of **free RSS feeds and Google Custom Search**, curates them with **Claude**, writes the results to `data/feed.json`, and serves a static reading site from **GitHub Pages**. Your API keys never touch the browser.

Beats: **The Desk** (top mix) · **AI Innovation** · **Data Platforms** (Databricks / Snowflake / Azure) · **Planning & EPM** (SAP / Pigment / Anaplan) · **Consulting & Research** (McKinsey / BCG / Gartner).

---

## How it works

```
GitHub Actions (cron)
        │
        ▼
scripts/refresh.mjs
        │
        ├── Beats 1-4: fetch RSS feeds (free, no key needed)
        │
        └── Beat 5: Google Custom Search (free tier, ~2 queries/day)
                     targets mckinsey.com, bcg.com, gartner.com etc.
        │
        ▼
Claude API (text only — no web search tool)
Reads the articles, picks the best 10 per beat,
writes summaries and relevance notes
        │
        ▼
commits data/feed.json → GitHub Pages serves index.html
```

- **No server to run, no keys in the browser.** All keys live only in GitHub Actions secrets.
- **Low cost.** RSS is free. Google Custom Search free tier covers 3,000 queries/month (this app uses ~60). Claude token costs for curation are roughly $0.03–0.08/day.

---

## Setup (about 20 minutes)

### 1. Create the repo
Create a new GitHub repository and push these files to it (keep the folder structure).

### 2. Get an Anthropic API key
- Go to [console.anthropic.com](https://console.anthropic.com) → sign up / log in
- **API Keys** in the left sidebar → **Create Key**
- Copy it immediately (shown only once)
- Add a credit card under **Billing** to activate it (a free starting credit is included)

### 3. Set up Google Custom Search (free)
This is used for the consulting/research beat to reach McKinsey, BCG, Gartner etc., which don't publish RSS feeds.

**Create the search engine:**
- Go to [programmablesearchengine.google.com](https://programmablesearchengine.google.com)
- Click **Add** → name it (e.g. "News Feed")
- Add the sites you want to search (up to 50). Recommended:
  ```
  www.mckinsey.com/*
  www.bcg.com/*
  www.bain.com/*
  www.gartner.com/*
  www.deloitte.com/*
  hbr.org/*
  mitsloan.mit.edu/*
  www.ft.com/*
  www.reuters.com/*
  www.bloomberg.com/*
  www.databricks.com/*
  www.snowflake.com/*
  news.sap.com/*
  www.anaplan.com/*
  azure.microsoft.com/*
  www.technologyreview.com/*
  ```
- Click **Create** → copy your **Search Engine ID** from the confirmation screen

**Get a Google API key:**
- Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project
- **APIs & Services → Library** → search for **Custom Search API** → **Enable**
- **APIs & Services → Credentials → Create Credentials → API Key**
- Copy the key
- Recommended: restrict the key to **Custom Search API** only under the key's settings

### 4. Add secrets to GitHub
In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `GOOGLE_API_KEY` | your Google API key |
| `GOOGLE_CSE_ID` | your Search Engine ID |

### 5. Run the refresh once
**Actions** tab → **Refresh briefing** → **Run workflow**. After ~1–2 minutes it commits a populated `data/feed.json`.

> If Actions can't push, go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**.

### 6. Turn on GitHub Pages
**Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Your site appears at `https://<you>.github.io/<repo>/`.

Done. It now refreshes itself daily.

---

## Customizing

| Want to… | Edit |
| --- | --- |
| Change topics / what each tab pulls | the `focus` text in `BEATS` in `scripts/refresh.mjs` |
| Add or change RSS feeds | the `feeds` arrays in `BEATS` in `scripts/refresh.mjs` |
| Change Google search queries | the `googleQueries` arrays in `BEATS` in `scripts/refresh.mjs` |
| Add Google search to more beats | add a `googleQueries` array to any beat (each query = 1 of your 3,000 free/month) |
| Change refresh time/frequency | the `cron` line in `.github/workflows/refresh.yml` ([crontab.guru](https://crontab.guru)) |
| Add or rename tabs | `BEATS` in **both** `scripts/refresh.mjs` and `index.html` (keep the `id`s matching) |
| Number of stories per beat | `ITEMS_PER_BEAT` in `scripts/refresh.mjs` |

The site's search box filters the current beat. Bookmarks are saved in your browser (localStorage).

---

## Run locally

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_API_KEY=AIza...
export GOOGLE_CSE_ID=your-cse-id
npm run refresh          # writes data/feed.json
python3 -m http.server   # then open http://localhost:8000
```

---

## Cost estimate

| Component | Cost |
| --- | --- |
| RSS feeds (beats 1–4) | Free |
| Google Custom Search (~60 queries/month) | Free (limit: 3,000/month) |
| Claude token costs (~5 beats/day) | ~$0.03–0.08/day |

- The script keeps the previous stories for any beat that fails, so a hiccup won't blank your feed.
- Links go to the original sources; reading full Washington Post or McKinsey content uses your own subscriptions.
