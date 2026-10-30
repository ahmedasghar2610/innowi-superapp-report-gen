# Innowi crawler helper (Screaming Frog) — v2

This folder lets the Innowi Super App use **your licensed Screaming Frog** to crawl client websites.

- In the Super App, **SEO → "Crawl all sites"** (or **Crawl now** on one site) puts crawls in a queue. This helper asks for work every minute, runs Screaming Frog in the background (no window), zips the export and sends it back. The site's scores and findings update as soon as each crawl arrives.
- It only makes **outgoing** requests to the Super App, so nothing on this laptop is opened to the internet. No tunnel, domain or open port is needed.
- It crawls one site at a time, and only sites the Super App asks for.

## One-time setup

1. **Python 3.10+** — install from python.org and tick **"Add Python to PATH"**. Nothing else is needed.
2. **Screaming Frog** must be licensed on this laptop, under your own licence, and opened once so its terms are accepted.
3. **Put this folder somewhere permanent**, e.g. `C:\SF-Helper`.
4. **Get a key:** in the Super App, **Settings → Integrations → Screaming Frog crawler → New key** (name it after this laptop). It is shown once — copy it.
5. **Copy `config.example.json` to `config.json`** (first time only) and edit it:
   - `crawler_key`: paste the key. Keep it private.
   - `api_base`: the Super App's address + `/api/v1` (e.g. `https://superapp-web-test.vercel.app/api/v1`).
   - `helper_name`: how this laptop shows up in the Super App.
   - `screaming_frog_path`: change it only if Screaming Frog is installed somewhere else.
6. **Double-click `1-check.bat`.** It should say:
   `Screaming Frog CLI … found` · `Super App: reachable, key accepted` · `All good`.
7. **Double-click `3-start-with-windows.bat`.** The helper starts now (hidden) and by itself at every login. To watch it in a window instead, use `2-run-helper.bat`.
8. **Windows power settings:** never sleep when plugged in, and closing the lid does nothing.

## Every day

Nothing to do. Keep the laptop on and logged in. The Super App shows **"<name> online"** on the SEO pages. Queued crawls start within about a minute; if the laptop is off they wait until it's back.

## Files

| File | What it is |
|---|---|
| `helper.py` | The helper |
| `config.json` | Your settings and key |
| `helper.log` | What it did, including any errors. Check here first if something looks wrong. |
| `crawls\` | The last 3 Screaming Frog exports per site (raw CSVs, kept for checking) |
| `1-check.bat` | Tests Screaming Frog, the Super App and the key |
| `2-run-helper.bat` | Runs it in a window |
| `3-start-with-windows.bat` / `4-stop-autostart.bat` | Turns auto-start on or off (Startup folder, no admin rights needed) |

## What Screaming Frog exports on each crawl

- `--export-tabs "Internal:All"` → `internal_all.csv` (every URL with title, meta, H1, status, words, links…)
- `--save-report "Issues Overview,Redirects:Redirect Chains"` → `issues_overview_report.csv`, `redirect_chains.csv`
- `--bulk-export "Issues:All"` → `issues_reports\*.csv` (the URLs behind every issue)

**Optional extras** (set `crawl_config` to a saved Screaming Frog config, `.seospiderconfig`): with custom extraction
(Phone / Street / Hours), "Crawl Linked XML Sitemaps" + "Crawl Analysis" on, and a link-data API connected
(set `link_metrics` to `moz`, `majestic` or `ahrefs`), the helper also exports Custom Extraction, Link Metrics and
Orphan Pages — the Super App then fills the website-vs-Google NAP check, backlinks and orphan pages.
See the "screaming-frog-setup" notes for the exact extraction rules.

## Test crawl without the Super App

```
python helper.py --local orderkabobfusion.com
```

This saves the export in `crawls\` and sends nothing.
