"""Sample Fathom meetings, so Ops CRM → Meetings can be tried before a real
Fathom API key is added.

    python -m scripts.seed_meetings            # add 5 sample meetings
    python -m scripts.seed_meetings --remove   # delete them again
    python -m scripts.seed_meetings --domain innowi.com

Each sample is written in exactly the shape Fathom's API sends (GET
/meetings or the webhook) and goes through the same code the real
integration uses (modules/ops/fathom.ingest_meeting), so what you see is
what real meetings will look like. Attendees use the team's emails from
scripts/seed_team.py — run that first. Samples are marked "Sample" in the
list and are the only meetings --remove deletes.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.enums import MeetingSource
from app.models.ops import Meeting, Project
from app.models.profiling import Merchant
from app.modules.ops.fathom import ingest_meeting
from scripts.seed_team import DEFAULT_DOMAIN

BASE_ID = 990_000_000  # recording ids for samples; real Fathom ids won't collide


def _iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def samples(domain: str, now: dt.datetime) -> list[tuple[dict, str | None, str | None]]:
    """(Fathom meeting object, merchant name, project name)."""
    def me(name: str, user: str) -> dict:
        return {"name": name, "email": f"{user}@{domain}", "email_domain": domain, "is_external": False, "matched_speaker_display_name": name}

    def guest(name: str, email: str) -> dict:
        return {"name": name, "email": email, "email_domain": email.split("@")[1], "is_external": True, "matched_speaker_display_name": name}

    def say(name: str, email: str, ts: str, text: str) -> dict:
        return {"speaker": {"display_name": name, "matched_calendar_invitee_email": email}, "text": text, "timestamp": ts}

    def act(text: str, who: str, user: str | None, ts: str, rid: int, external: str | None = None) -> dict:
        email = external or (f"{user}@{domain}" if user else None)
        secs = sum(int(x) * m for x, m in zip(ts.split(":"), (3600, 60, 1)))
        return {
            "description": text,
            "user_generated": False,
            "completed": False,
            "recording_timestamp": ts,
            "recording_playback_url": f"https://fathom.video/calls/{rid}?timestamp={secs}",
            "assignee": {"name": who, "email": email, "team": "Ops"} if email else None,
        }

    def meeting(i: int, title: str, hours_ago: float, minutes: int, invitees: list, transcript: list, summary: str, actions: list) -> dict:
        rid = BASE_ID + i
        start = now - dt.timedelta(hours=hours_ago)
        return {
            "title": title,
            "meeting_title": title,
            "recording_id": rid,
            "url": f"https://fathom.video/calls/{rid}",
            "share_url": f"https://fathom.video/share/sample{rid}",
            "created_at": _iso(start + dt.timedelta(minutes=minutes + 2)),
            "scheduled_start_time": _iso(start),
            "scheduled_end_time": _iso(start + dt.timedelta(minutes=minutes)),
            "recording_start_time": _iso(start + dt.timedelta(minutes=1)),
            "recording_end_time": _iso(start + dt.timedelta(minutes=minutes)),
            "calendar_invitees_domains_type": "one_or_more_external" if any(x["is_external"] for x in invitees) else "only_internal",
            "transcript_language": "en",
            "meeting_url": "https://teams.microsoft.com/l/meetup-join/sample",
            "calendar_invitees": invitees,
            "recorded_by": {"name": "Aima", "email": f"aima@{domain}", "email_domain": domain, "team": "Ops"},
            "transcript": transcript,
            "default_summary": {"template_name": "general", "markdown_formatted": summary},
            "action_items": [act(*a, rid=rid) if len(a) == 4 else act(*a[:4], rid=rid, external=a[4]) for a in actions],
        }

    A, M, AR, MO, R, ALI = (f"{u}@{domain}" for u in ("aima", "maheen", "arbab", "mobeen", "rashid", "muhammad.ali"))
    return [
        (
            meeting(
                1, "Pho Ha Plus · website relaunch kickoff", 50, 45,
                [me("Aima", "aima"), me("Arbab", "arbab"), me("Mobeen", "mobeen"), me("Rashid", "rashid"), guest("Thanh Nguyen", "thanh@phohaplus.com")],
                [
                    say("Aima", A, "00:00:40", "Thanks for joining. Today is about moving Pho Ha Plus to the new website template."),
                    say("Thanh Nguyen", "thanh@phohaplus.com", "00:02:10", "We want to go live before our anniversary promotion on the 20th, and keep our current domain."),
                    say("Arbab", AR, "00:05:32", "Menu pages first, then hours and location, then the blog. Ordering stays on the old site until cut-over day."),
                    say("Mobeen", MO, "00:09:15", "We can reuse the menu photography; I'll need the new logo files though."),
                    say("Thanh Nguyen", "thanh@phohaplus.com", "00:12:01", "Please keep online ordering working the whole time."),
                    say("Aima", A, "00:31:20", "Great — soft launch on staging by the 13th, live on the 20th."),
                ],
                "## Summary\nKickoff for moving **Pho Ha Plus** to the new website template. The merchant wants to keep the current domain and go live before the 20 Oct anniversary promotion. Online ordering must keep working throughout.\n\n## Decisions\n- Launch target **20 Oct**; soft launch on staging by **13 Oct**.\n- Keep the existing domain.\n- Migrate menu pages first, then location/hours, then the blog.\n\n## Open questions\n- Keep the Vietnamese-language page? (Thanh to confirm)\n",
                [
                    ("Migrate menu pages to the new template", "Arbab", "arbab", "00:05:32"),
                    ("Update opening hours and location page", "Rashid", "rashid", "00:07:10"),
                    ("Send new logo files for the header", "Thanh Nguyen", None, "00:09:15", "thanh@phohaplus.com"),
                    ("Prepare staging site for the merchant to review by 13 Oct", "Arbab", "arbab", "00:31:20"),
                    ("Refresh menu photos in the hero section", "Mobeen", "mobeen", "00:09:40"),
                ],
            ),
            "Pho Ha Plus Vietnamese Cuisine",
            "Website relaunch",
        ),
        (
            meeting(
                2, "Cha2Cha · logo direction review", 26, 30,
                [me("Mobeen", "mobeen"), me("Aima", "aima"), guest("Ivy Pham", "ivy@cha2cha.com")],
                [
                    say("Mobeen", MO, "00:01:05", "Here are the three icon directions for the new sign."),
                    say("Ivy Pham", "ivy@cha2cha.com", "00:06:40", "We like direction B — can the tea leaf be a little bigger?"),
                    say("Aima", A, "00:12:30", "We'll send the final vectors to the sign vendor by Wednesday."),
                ],
                "## Summary\nIvy chose **direction B** for the storefront sign logo, with a slightly larger tea leaf. Final vector files go to the sign vendor by Wednesday.\n",
                [
                    ("Enlarge the tea leaf on direction B and share a final preview", "Mobeen", "mobeen", "00:06:40"),
                    ("Export vector files and send them to the sign vendor", "Mobeen", "mobeen", "00:12:30"),
                ],
            ),
            "Cha2Cha",
            "Merchant requests",
        ),
        (
            meeting(
                3, "Weekly ops sync", 6, 35,
                [me("Aima", "aima"), me("Maheen", "maheen"), me("Arbab", "arbab"), me("Mobeen", "mobeen"), me("Rashid", "rashid"), me("Muhammad Ali", "muhammad.ali")],
                [
                    say("Maheen", M, "00:00:30", "Quick round: anything blocked?"),
                    say("Rashid", R, "00:04:12", "The pho ranking drop — I think the GBP category changed."),
                    say("Muhammad Ali", ALI, "00:09:45", "The Microsoft 365 admin still needs to register the app for Teams sign-in."),
                    say("Aima", A, "00:15:20", "Nizario's domain renews next week; we need the merchant to confirm payment."),
                ],
                "## Summary\nWeekly check-in. The Pho Ha Plus ranking drop is likely a Google Business Profile category change. Teams sign-in is waiting on the Microsoft 365 admin. Nizario's domain renewal needs payment confirmation.\n",
                [
                    ("Check and fix the Pho Ha Plus Google Business Profile category", "Rashid", "rashid", "00:04:12"),
                    ("Chase the Microsoft 365 admin for the app registration", "Muhammad Ali", "muhammad.ali", "00:09:45"),
                    ("Confirm domain renewal payment with Nizario's", "Aima", "aima", "00:15:20"),
                    ("Share the weekly ticket report in Teams", "Maheen", "maheen", "00:30:02"),
                ],
            ),
            None,
            "SuperApp",
        ),
        (
            meeting(
                4, "Nizario's Pizza · lunch combo planning", 3, 25,
                [me("Arbab", "arbab"), me("Maheen", "maheen"), guest("Gina Russo", "gina@nizariospizza.com")],
                [
                    say("Gina Russo", "gina@nizariospizza.com", "00:02:00", "A slice and a drink for $9.99, weekdays 11 to 3."),
                    say("Arbab", AR, "00:08:30", "We'll do an Instagram post, a story and an SMS to the loyalty list."),
                ],
                "## Summary\nNizario's confirmed the weekday lunch combo: **slice + drink for $9.99**, 11am–3pm. We'll promote it with an Instagram post, a story and an SMS blast.\n",
                [
                    ("Design the lunch combo post and story", "Mobeen", "mobeen", "00:08:30"),
                    ("Schedule the SMS blast to the loyalty list", "Arbab", "arbab", "00:09:10"),
                ],
            ),
            "Nizario's Pizza",
            "Email & SMS",
        ),
        (
            meeting(
                5, "Atulya Bharat · checkout bug triage", 1.5, 20,
                [me("Arbab", "arbab"), me("Aima", "aima"), guest("Priya Shah", "priya@atulyabharat.com")],
                [
                    say("Priya Shah", "priya@atulyabharat.com", "00:01:15", "Customers see a 404 when they tap checkout."),
                    say("Arbab", AR, "00:04:40", "The ordering link still points at the old menu slug. I'll fix it today."),
                ],
                "## Summary\nCheckout returns a 404 because the ordering link points at an old menu address. Arbab is fixing it today and will test a real order with Priya.\n",
                [
                    ("Point the checkout link at the new menu address", "Arbab", "arbab", "00:04:40"),
                    ("Place a test order with Priya after the fix", "Arbab", "arbab", "00:06:00"),
                ],
            ),
            "Atulya Bharat",
            "Merchant requests",
        ),
    ]


async def main(args) -> None:
    async with SessionLocal() as db:
        if args.remove:
            n = (await db.execute(delete(Meeting).where(Meeting.source == MeetingSource.DEMO))).rowcount
            await db.commit()
            print(f"{n} sample meetings removed.")
            return
        now = dt.datetime.now(dt.timezone.utc)
        for payload, merchant_name, project_name in samples(args.domain, now):
            meeting, created = await ingest_meeting(db, payload, source=MeetingSource.DEMO)
            if merchant_name and not meeting.merchant_id:  # samples have no merchant contacts to match on
                short = merchant_name.split(" Vietnamese")[0]
                m = (await db.execute(select(Merchant).where(Merchant.restaurant_name.ilike(f"%{short}%")))).scalars().first()
                if m:
                    meeting.merchant_id, meeting.merchant_match = m.id, "auto"
            if project_name and not meeting.project_id:
                p = (await db.execute(select(Project).where(Project.name == project_name))).scalar_one_or_none()
                meeting.project_id = p.id if p else None
            print(f"  {'add ' if created else 'keep'}  {meeting.title}")
        await db.commit()
    print("\nDone. Open Ops CRM → Meetings. Remove the samples any time with --remove.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Add sample Fathom meetings")
    ap.add_argument("--domain", default=DEFAULT_DOMAIN, help=f"team email domain, as used with seed_team (default {DEFAULT_DOMAIN})")
    ap.add_argument("--remove", action="store_true", help="delete the sample meetings")
    asyncio.run(main(ap.parse_args()))
