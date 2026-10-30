"""
Writes the first roadmap (app/modules/roadmap/seed_data.py).

Runs only while the roadmap is empty: once any phase exists, the team owns the
roadmap in the app and a deploy never touches it again.

    python -m scripts.seed_roadmap             # write it if the roadmap is empty
    python -m scripts.seed_roadmap --dry-run   # report, write nothing
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models import roadmap as m
from app.modules.roadmap import service
from app.modules.roadmap.seed_data import PHASES


async def main(dry_run: bool = False) -> int:
    async with SessionLocal() as db:
        if (await db.execute(select(func.count()).select_from(m.Phase))).scalar_one():
            print("Roadmap: already has phases, left as it is.")
            return 0
        users = await service.active_users(db)
        phases = items = unassigned = 0
        for p_order, (name, goal, start, end, rows) in enumerate(PHASES, start=1):
            phase = m.Phase(name=name, goal=goal, start_month=start, end_month=end, sort_order=p_order * 10)
            db.add(phase)
            await db.flush()
            phases += 1
            for i_order, (area, title, desc, status, priority, owner, target, done_on) in enumerate(rows, start=1):
                owner_id = service.find_owner(users, owner)
                if owner and not owner_id:
                    unassigned += 1
                db.add(m.Item(phase_id=phase.id, title=title, description=desc, area=area, status=status,
                              priority=priority, owner_id=owner_id, target_date=target, done_on=done_on,
                              sort_order=i_order * 10, created_by_email="seed", updated_by_email="seed"))
                items += 1
        if dry_run:
            await db.rollback()
        else:
            await db.commit()
    verb = "would write" if dry_run else "wrote"
    print(f"Roadmap: {verb} {phases} phases and {items} items"
          + (f" ({unassigned} owner e-mails had no active user, left unassigned)." if unassigned else "."))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    raise SystemExit(asyncio.run(main(parser.parse_args().dry_run)))
