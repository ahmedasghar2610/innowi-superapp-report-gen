"""Innowi Super App — Screaming Frog crawler helper.

Runs on a PC that has a licensed Screaming Frog SEO Spider. It asks the Super App
for crawl jobs (outgoing requests only — nothing on this PC is opened to the
internet), runs the Screaming Frog CLI, zips the CSV export and sends it back.
The Super App reads the export with the same importer as a manual import
(app/modules/seo/sf_import.py) and rescores the site.

    python helper.py --check          test the Super App connection, the key and Screaming Frog
    python helper.py                  keep running: ask for work every poll_seconds
    python helper.py --once           ask once, do at most one job, then stop
    python helper.py --local <url>    crawl a site and keep the export here only (nothing is sent)

Standard library only (Python 3.9+). Settings live in config.json next to this file.
3-start-with-windows.bat starts it hidden at every Windows login.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

VERSION = "2.0.1"
HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
LOG_PATH = HERE / "helper.log"
LOCK_PATH = HERE / "helper.lock"

# What Screaming Frog exports — the files the Super App importer reads (app/modules/seo/sf_import.py):
#   internal_all.csv              Internal tab → All                  (required)
#   issues_overview_report.csv    Reports → Issues Overview           (required)
#   issues_reports/*.csv          Bulk Export → Issues → All          (URLs per issue)
#   redirect_chains.csv           Reports → Redirects → Redirect Chains
BASIC_EXPORTS = {
    "export_tabs": "Internal:All",
    "save_report": "Issues Overview,Redirects:Redirect Chains",
    "bulk_export": "Issues:All",
}
# With a saved Screaming Frog config (crawl_config) that has custom extraction (phone / street / hours),
# a link-metrics API and "Crawl Linked XML Sitemaps" + "Crawl Analysis" on, these extras are exported too:
#   custom_extraction_all.csv (website NAP vs Google), link_metrics_all.csv (backlinks), orphan_pages.csv
FULL_EXPORTS = {
    "export_tabs": "Internal:All,Custom Extraction:All,Link Metrics:All",
    "save_report": "Issues Overview,Redirects:Redirect Chains,Orphan Pages",
    "bulk_export": "Issues:All",
}

DEFAULT_CONFIG = {
    "api_base": "https://superapp-web-test.vercel.app/api/v1",
    "crawler_key": "PASTE-THE-KEY-FROM-THE-SUPER-APP-HERE",
    "helper_name": "",  # shown in the Super App, e.g. "Usama laptop"; defaults to the PC name
    "screaming_frog_path": r"C:\Program Files (x86)\Screaming Frog SEO Spider\ScreamingFrogSEOSpiderCli.exe",
    "crawl_config": "",  # optional saved Screaming Frog config (.seospiderconfig) — turns on the extra exports
    "link_metrics": "",  # with a link API connected in that config: "moz", "majestic" or "ahrefs"
    "poll_seconds": 60,
    "crawl_timeout_minutes": 30,
    "keep_crawls_per_domain": 3,
    "work_folder": "crawls",
}


# ======================================================================= utils ==

def log(msg: str) -> None:
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    try:
        print(line, flush=True)
    except (UnicodeEncodeError, OSError):  # pythonw has no console
        pass
    try:
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > 5_000_000:
            LOG_PATH.replace(LOG_PATH.with_suffix(".old.log"))
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
        log(f"Created {CONFIG_PATH.name} — put the crawler key from the Super App in it, then run again.")
        sys.exit(1)
    cfg = {**DEFAULT_CONFIG, **json.loads(CONFIG_PATH.read_text(encoding="utf-8"))}
    cfg["api_base"] = cfg["api_base"].rstrip("/")
    cfg["helper_name"] = cfg["helper_name"] or os.environ.get("COMPUTERNAME") or "crawler"
    return cfg


def host_of(url: str) -> str:
    h = (urlparse(url if "://" in url else f"https://{url}").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


class SuperAppError(Exception):
    def __init__(self, msg: str, status: Optional[int] = None, timed_out: bool = False):
        super().__init__(msg)
        self.status = status
        self.timed_out = timed_out  # the request went out but no answer came back in time


class SuperApp:
    """The four calls this helper makes. All are outgoing HTTPS requests with the crawler key.

        GET  {api_base}/seo/crawler/ping                     key check + "last seen"
        GET  {api_base}/seo/crawler/next                     {"job": {id, domain, url} | null}
        POST {api_base}/seo/crawler/jobs/{id}/status         {"status": "running"|"failed", "message": ...}
        POST {api_base}/seo/crawler/jobs/{id}/result         the export folder as a zip (application/zip)
    """

    def __init__(self, cfg: dict):
        self.base = cfg["api_base"]
        self.headers = {"X-Crawler-Key": cfg["crawler_key"], "X-Crawler-Name": cfg["helper_name"],
                        "X-Crawler-Version": VERSION, "User-Agent": f"innowi-sf-helper/{VERSION}"}

    def _call(self, method: str, path: str, body: Optional[dict] = None, raw: Optional[bytes] = None,
              extra: Optional[dict] = None, timeout: int = 60):
        data, headers = None, {**self.headers, **(extra or {})}
        if body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif raw is not None:
            data = raw
            headers["Content-Type"] = "application/zip"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read()
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            try:
                parsed = json.loads(detail)
                detail = parsed.get("message") or parsed.get("detail") or detail
            except (ValueError, AttributeError):
                pass
            raise SuperAppError(f"Super App answered {e.code}: {detail}", e.code)
        except urllib.error.URLError as e:
            raise SuperAppError(f"Can't reach the Super App at {self.base} ({e.reason})")
        except (TimeoutError, OSError) as e:  # socket timeout / connection reset while waiting for the answer
            raise SuperAppError(f"No answer from the Super App within {timeout}s ({e.__class__.__name__})", timed_out=True)

    def ping(self) -> dict:
        return self._call("GET", "/seo/crawler/ping")

    def next_job(self) -> Optional[dict]:
        return self._call("GET", "/seo/crawler/next").get("job")

    def status(self, job_id: str, status: str, message: str = "") -> None:
        self._call("POST", f"/seo/crawler/jobs/{job_id}/status", {"status": status, "message": message[:1000]})

    def result(self, job_id: str, zipped: bytes, seconds: int) -> dict:
        # The Super App accepts the upload at once and saves it afterwards; the long timeout is only for
        # a serverless host, where saving happens inside this request.
        return self._call("POST", f"/seo/crawler/jobs/{job_id}/result", raw=zipped,
                          extra={"X-Crawl-Duration": str(seconds)}, timeout=600)


# ================================================================ Screaming Frog ==

def exports_for(cfg: dict) -> dict:
    base = FULL_EXPORTS if cfg.get("crawl_config") else BASIC_EXPORTS
    return {k: cfg.get(k) or v for k, v in base.items()}  # export_tabs / save_report / bulk_export can be overridden


def run_screaming_frog(cfg: dict, url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    ex = exports_for(cfg)
    cmd = [cfg["screaming_frog_path"], "--crawl", url, "--headless", "--output-folder", str(out), "--overwrite",
           "--export-format", "csv", "--export-tabs", ex["export_tabs"], "--save-report", ex["save_report"],
           "--bulk-export", ex["bulk_export"]]
    if cfg.get("crawl_config"):
        cmd += ["--config", cfg["crawl_config"]]
    if cfg.get("link_metrics") in ("moz", "majestic", "ahrefs"):
        cmd += [{"moz": "--use-mozscape", "majestic": "--use-majestic", "ahrefs": "--use-ahrefs"}[cfg["link_metrics"]]]
    sf_log = out / "screamingfrog.log"
    with sf_log.open("w", encoding="utf-8", errors="replace") as f:
        try:
            proc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=int(cfg["crawl_timeout_minutes"]) * 60,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"The crawl took longer than {cfg['crawl_timeout_minutes']} minutes and was stopped.")
    if proc.returncode != 0 or not (out / "internal_all.csv").exists():
        tail = sf_log.read_text(encoding="utf-8", errors="replace")[-600:].strip()
        raise RuntimeError(f"Screaming Frog failed (exit code {proc.returncode}). {tail}")


def zip_export(folder: Path) -> bytes:
    """Every CSV of the export (with its sub-folder, e.g. issues_reports/), nothing else."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(folder.rglob("*.csv")):
            z.write(p, p.relative_to(folder).as_posix())
    return buf.getvalue()


def count_urls(folder: Path) -> int:
    try:
        with (folder / "internal_all.csv").open(encoding="utf-8-sig", errors="replace") as f:
            return max(0, sum(1 for _ in f) - 1)
    except OSError:
        return 0


# ==================================================================== jobs =====

def crawl_folder(cfg: dict, domain: str) -> Path:
    root = (HERE / cfg["work_folder"]) if not os.path.isabs(cfg["work_folder"]) else Path(cfg["work_folder"])
    return root / re.sub(r"[^a-z0-9.-]", "_", domain.lower()) / dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def prune(cfg: dict, folder: Path) -> None:
    olds = sorted((p for p in folder.parent.iterdir() if p.is_dir()), reverse=True)[int(cfg["keep_crawls_per_domain"]):]
    for p in olds:
        shutil.rmtree(p, ignore_errors=True)


def crawl(cfg: dict, url: str) -> tuple[Path, bytes, int]:
    out = crawl_folder(cfg, host_of(url))
    started = time.time()
    run_screaming_frog(cfg, url, out)
    zipped = zip_export(out)
    secs = round(time.time() - started)
    prune(cfg, out)
    return out, zipped, secs


def do_job(cfg: dict, app: SuperApp, job: dict) -> None:
    jid, url = job["id"], job["url"]
    log(f"Job {jid}: crawling {url}")
    app.status(jid, "running", f"Crawling on {cfg['helper_name']}")
    try:
        out, zipped, secs = crawl(cfg, url)
    except Exception as e:  # noqa: BLE001 — every failure is reported to the Super App
        log(f"Job {jid}: failed — {e}")
        app.status(jid, "failed", str(e))
        return
    try:
        saved = app.result(jid, zipped, secs)
    except SuperAppError as e:
        if e.timed_out:  # sent, but no answer in time: the Super App may well be saving it
            log(f"Job {jid}: sent {len(zipped) // 1024} KB but {e} — the Super App may still be saving it; check the site's crawl card. "
                f"The export is kept in {out}.")
            return
        log(f"Job {jid}: the Super App didn't accept the result — {e}")
        if e.status not in (400, 401, 403):  # 400: the Super App already marked the job failed with the reason
            try:
                app.status(jid, "failed", f"Upload failed: {e}")
            except SuperAppError:
                pass
        return
    log(f"Job {jid}: crawled in {secs}s — {count_urls(out)} URLs, {len(zipped) // 1024} KB sent ({out}). {saved.get('message', '')}")


def single_instance() -> None:
    """Refuse to start twice on the same PC (two helpers would fight over Screaming Frog)."""
    if LOCK_PATH.exists():
        try:
            pid = int(LOCK_PATH.read_text().strip())
            if pid != os.getpid() and _pid_alive(pid):
                log(f"Another helper is already running (process {pid}). Stop it first.")
                sys.exit(1)
        except ValueError:
            pass
    LOCK_PATH.write_text(str(os.getpid()))


def _pid_alive(pid: int) -> bool:
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


# ===================================================================== main ====

def check(cfg: dict) -> int:
    ok = True
    sf = Path(cfg["screaming_frog_path"])
    log(f"Screaming Frog CLI: {sf} — {'found' if sf.exists() else 'NOT FOUND (fix screaming_frog_path in config.json)'}")
    ok &= sf.exists()
    if cfg.get("crawl_config"):
        exists = Path(cfg["crawl_config"]).exists()
        log(f"Crawl config: {cfg['crawl_config']} — {'found' if exists else 'NOT FOUND'}")
        ok &= exists
    log(f"Exports: {exports_for(cfg)}")
    try:
        info = SuperApp(cfg).ping()
        log(f"Super App: reachable, key accepted — {info.get('message', 'ok')}")
    except SuperAppError as e:
        log(f"Super App: {e}")
        if e.status == 401:
            log("  → create a key in the Super App (Settings → Integrations → Screaming Frog crawler) and paste it as crawler_key.")
        ok = False
    log("All good — run 3-start-with-windows.bat (or `python helper.py`) to start." if ok else "Fix the items above, then run --check again.")
    return 0 if ok else 1


def loop(cfg: dict, once: bool) -> int:
    single_instance()
    app = SuperApp(cfg)
    log(f"Helper {VERSION} started as '{cfg['helper_name']}' — asking {cfg['api_base']} for work every {cfg['poll_seconds']}s")
    wait = int(cfg["poll_seconds"])
    while True:
        try:
            job = app.next_job()
            wait = int(cfg["poll_seconds"])
            if job:
                do_job(cfg, app, job)
                if not once:
                    continue  # straight to the next job in the queue
        except SuperAppError as e:
            if e.status in (401, 403):
                log(f"{e} — check crawler_key in config.json.")
            else:
                log(str(e))
            wait = min(wait * 2, 900)  # back off while the Super App is unreachable
        except Exception:  # noqa: BLE001 — never die on one bad cycle
            log("Unexpected error:\n" + traceback.format_exc())
            wait = min(wait * 2, 900)
        if once:
            return 0
        time.sleep(wait)


def main() -> int:
    ap = argparse.ArgumentParser(description="Innowi Super App — Screaming Frog crawler helper")
    ap.add_argument("--check", action="store_true", help="test Screaming Frog, the Super App and the key")
    ap.add_argument("--once", action="store_true", help="ask for one job, do it, stop")
    ap.add_argument("--local", metavar="URL", help="crawl a site and keep the export here (nothing is sent)")
    args = ap.parse_args()
    cfg = load_config()
    if args.check:
        return check(cfg)
    if args.local:
        out, zipped, secs = crawl(cfg, args.local if "://" in args.local else f"https://{args.local}")
        log(f"Done in {secs}s: {count_urls(out)} URLs → {out} ({len(zipped) // 1024} KB zipped; nothing sent)")
        return 0
    try:
        return loop(cfg, args.once)
    except KeyboardInterrupt:
        log("Stopped.")
        return 0
    finally:
        try:
            if LOCK_PATH.exists() and LOCK_PATH.read_text().strip() == str(os.getpid()):
                LOCK_PATH.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
