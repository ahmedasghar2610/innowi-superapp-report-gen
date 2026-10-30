"""Report Generator — one-click monthly merchant reports (Phase 0).

    flag.py        REPORT_GEN_ENABLED guard: every route answers 404 while the flag is off
    whitelist.py   the only tables / columns the generator may read, and the payload scan
    periods.py     calendar-month maths (pure)
    assemble/      one adapter per report section; each returns figures or "not supplied" + reason
    narrative.py   headline cards, summary sentences, default recommendations (pure)
    service.py     lifecycle: generating → draft → edited → approved → sent | failed | deleted
    sender.py      dry-run / sandbox / live sending (Phase 0 ships dry-run)
    router.py      /report-gen/* endpoints

Read-only towards every other module: it imports their public helpers and
selects whitelisted columns from their tables, and writes only report_gen_*.
"""
