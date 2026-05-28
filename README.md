# Signal Desk

A private, self-updating intelligence briefing for **data & analytics, AI innovation, and the analytics / planning / consulting world** — refreshed automatically every day.

It pulls current stories with **Claude + web search** on a schedule (via GitHub Actions), writes them to `data/feed.json`, and serves a static reading site from **GitHub Pages**. Your API key never touches the browser.

Beats: **The Desk** (top mix) · **AI Innovation** · **Data Platforms** (Databricks / Snowflake / Azure) · **Planning & EPM** (SAP / Pigment / Anaplan) · **Consulting & Research** (McKinsey / BCG / Gartner).

---

## How it works

```
GitHub Actions (cron)  ──run──▶  scripts/refresh.mjs  ──calls──▶  Claude API + web search
        │                                                              │
        └────────── commits data/feed.json ◀───────── curated JSON ────┘
                              │
                    GitHub Pages serves index.html, which reads data/feed.json
```

- **No server to run, no key in the browser.** The key lives only in GitHub Actions secrets.
- **Free** on a public repo (GitHub Actions + Pages). You pay only Anthropic API usage.

---

## Setup (about 10 minutes)

### 1. Create the repo
Create a new GitHub repository and push these files to it (keep the folder structure).

### 2. Add your Anthropic API key as a secret
Get a key from <https://console.anthropic.com> → **API Keys**. Then in your repo:

**Settings → Secrets and variables → Actions → New repository secret**
- Name: `ANTHROPIC_API_KEY`
- Value: your key

### 3. Run the refresh once
**Actions** tab → **Refresh briefing** → **Run workflow**. After ~1–2 minutes it commits a populated `data/feed.json`.

> If Actions can't push, go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**.

### 4. Turn on GitHub Pages
**Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Your site appears at `https://<you>.github.io/<repo>/`.

Done. It now refreshes itself daily.

---

## Customizing

| Want to… | Edit |
| --- | --- |
| Change topics / what each tab pulls | the `focus` text in `BEATS` in `scripts/refresh.mjs` |
| Change refresh time/frequency | the `cron` line in `.github/workflows/refresh.yml` ([crontab.guru](https://crontab.guru)) |
| Add or rename tabs | `BEATS` in **both** `scripts/refresh.mjs` and `index.html` (keep the `id`s matching) |
| Number of stories per beat | `ITEMS_PER_BEAT` in `scripts/refresh.mjs` |
| Preferred sources | `PREFERRED_SOURCES` in `scripts/refresh.mjs` |

The site's search box filters the current beat. Bookmarks are saved in your browser (localStorage).

---

## Run locally

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run refresh          # writes data/feed.json
python3 -m http.server   # then open http://localhost:8000
```

---

## Notes & cost

- Model: `claude-sonnet-4-6`. Web search is billed separately from tokens — see Anthropic pricing. A daily run across five beats is a small cost, but check your usage.
- The script keeps the previous stories for any beat that fails, so a hiccup won't blank your feed.
- Links go to the original sources; reading full Washington Post or McKinsey content uses your own subscriptions.
