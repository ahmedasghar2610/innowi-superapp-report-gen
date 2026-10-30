"""The first roadmap (2026-10-18). Written to the database once, while the
roadmap is empty; after that the team edits it in the app.

Owners are given by e-mail and matched to Super App users; an e-mail with no
active user leaves the item unassigned.
"""
from __future__ import annotations

import datetime as dt

SHAYAN = "shayan.s.toor@gmail.com"
MUHAMMAD = "muhammad.ali@innowi.com"

D = dt.date

# (name, goal, start month, end month, items)
# item: (area, title, description, status, priority, owner e-mail, target date, done on)
PHASES = [
    (
        "Foundation",
        "A working Super App on our own setup: team logins, merchant profiles, websites and the first sales tools.",
        D(2026, 9, 1), D(2026, 10, 1),
        [
            ("PLATFORM", "Super App code in our GitHub, live on Vercel and Supabase",
             "Imported from the developer's code, fixed to build and run on Vercel, using a restricted database user.",
             "DONE", "HIGH", SHAYAN, None, D(2026, 10, 11)),
            ("PLATFORM", "Team logins: roles, invites by e-mail, change password",
             "Admin, Marketing Manager / Executive, Sales Manager / Executive. Invite links expire after 7 days.",
             "DONE", "HIGH", SHAYAN, None, D(2026, 10, 11)),
            ("PLATFORM", "Audit log of every change", "Who changed what and when, for admins and managers.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 11)),
            ("MERCHANTS", "Merchant profiles: directory and workspace",
             "Profile, brand, locations, contacts, services, competitors, keywords, catering, promotions, documents, "
             "connections and history for each merchant.",
             "DONE", "HIGH", SHAYAN, None, D(2026, 10, 11)),
            ("MARKETING", "Website intake, Studio editor and public site template",
             "Build and edit a restaurant site and publish it on the site template.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 11)),
            ("SALES", "Partner leads from partners.innowi.com",
             "Applications from partners.innowi.com, assigned to an owner, with an alert to the owner.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 11)),
            ("SALES", "Sales: Salesforce deals, restaurants, visits and cases",
             "A read-only copy of Salesforce, My Day overview, pipeline, and a team view for managers.",
             "DONE", "HIGH", SHAYAN, None, D(2026, 10, 13)),
            ("SALES", "Partner network: contacts from business cards",
             "People met at events, kept apart from leads until someone promotes them.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 15)),
            ("SALES", "Quote builder: quote links, proposals, PDF and online accept",
             "Restaurants build their own setup from the price sheet; links can show or hide prices, with special "
             "pricing per link.",
             "DONE", "HIGH", SHAYAN, None, D(2026, 10, 18)),
            ("SALES", "Quote alerts in Teams and by e-mail",
             "New requests and acceptances post to the Teams channel and e-mail the rep. myinnowi.com verified for "
             "sending.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 18)),
            ("PLATFORM", "Assistant: ask questions about Super App data",
             "The first screen after sign-in. Answers in plain English from read-only lookups, limited to what "
             "each person is allowed to see; chats are saved.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 18)),
            ("PLATFORM", "Roadmap in the Super App", "This page: phases, owners and status in one place.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 18)),
            ("PLATFORM", "Revoke the GitHub token saved in the marketing folder",
             "A personal access token sits in plain text in the git settings of the 'Marketing for Innowi "
             "Restaurants' folder. Delete it on GitHub; the folder's remote is then reset without it.",
             "TODO", "HIGH", SHAYAN, D(2026, 10, 24), None),
            ("SALES", "Get Freddie signed in", "His invite (Sales Executive) expires on Oct 21; resend if needed.",
             "TODO", "NORMAL", SHAYAN, D(2026, 10, 21), None),
            ("PLATFORM", "Remove test data from production",
             "Test merchant TEST-001 and the 'TEST … (delete me)' quotes and links.",
             "TODO", "NORMAL", SHAYAN, D(2026, 10, 31), None),
        ],
    ),
    (
        "Ready for real customers",
        "Safe to put real merchants and the whole team on it: security gaps closed, real secrets, a database sized "
        "for production, and agreements signed from accepted quotes.",
        D(2026, 11, 1), D(2026, 11, 1),
        [
            ("PLATFORM", "Decide: one platform and one website system",
             "Super App or Uplit as the place the team works, and which website system stays. Everything after this "
             "builds on the answer.",
             "TODO", "HIGH", SHAYAN, D(2026, 11, 7), None),
            ("PLATFORM", "Only a Super Admin can grant Super Admin",
             "Today an Admin can create or promote a Super Admin through the API. The screen hides it; the server "
             "must refuse it too.",
             "TODO", "HIGH", MUHAMMAD, D(2026, 11, 7), None),
            ("PLATFORM", "Forgot password and reset link",
             "Team members can reset their own password from the login page.",
             "TODO", "HIGH", MUHAMMAD, None, None),
            ("PLATFORM", "Remove a team member",
             "Only 'Turn off' exists today; add a proper remove with a confirm step.",
             "TODO", "NORMAL", MUHAMMAD, None, None),
            ("PLATFORM", "Invite screen tells the truth when the e-mail fails",
             "The e-mail function answers OK even when sending fails, so the screen says 'Invitation sent'. Show the "
             "copy-link fallback instead.",
             "TODO", "NORMAL", MUHAMMAD, None, None),
            ("PLATFORM", "Login lockout that works on Vercel",
             "Failed-login limits are kept in memory, which each server instance has its own copy of. Keep them in "
             "the database.",
             "TODO", "NORMAL", MUHAMMAD, None, None),
            ("PLATFORM", "Replace the test secrets",
             "New JWT keys and a new database password before real customer data goes in.",
             "TODO", "HIGH", SHAYAN, None, None),
            ("PLATFORM", "Production database with backups",
             "The Super App shares a small database (60 connections) with Uplit and the partner site. Move it to its "
             "own project or a bigger plan, with backups on.",
             "TODO", "HIGH", SHAYAN, None, None),
            ("PLATFORM", "Keep uploaded files", "Uploads are stored in temporary space and disappear. Store them in "
             "Supabase Storage.", "TODO", "NORMAL", MUHAMMAD, None, None),
            ("PLATFORM", "App on our own domain", "For example app.innowi.com instead of the vercel.app address.",
             "TODO", "NORMAL", SHAYAN, None, None),
            ("PLATFORM", "Code in an Innowi-owned GitHub organization",
             "Move the repository out of a personal account so access can be managed per person.",
             "TODO", "LOW", SHAYAN, None, None),
            ("SALES", "PandaDoc: send the agreement after a quote is accepted",
             "Fill the PandaDoc template from the accepted proposal and send it for signature; track signed status.",
             "TODO", "HIGH", MUHAMMAD, None, None),
            ("SALES", "Accepted quotes update Salesforce",
             "Create or update the opportunity with the accepted items and totals.",
             "TODO", "NORMAL", MUHAMMAD, None, None),
        ],
    ),
    (
        "Running merchants",
        "One place to see each merchant's health and what needs attention, in place of today's sample screens.",
        D(2026, 12, 1), D(2027, 1, 1),
        [
            ("MERCHANTS", "Home dashboard with real numbers",
             "The Home page shows sample data today. Replace it with real counts, issues and recent changes.",
             "TODO", "HIGH", MUHAMMAD, None, None),
            ("MERCHANTS", "Issues queue",
             "One list of what needs attention across merchants and modules, with an owner and a status from open "
             "to closed.",
             "TODO", "HIGH", MUHAMMAD, None, None),
            ("MERCHANTS", "Change log per merchant",
             "What we changed for a merchant, what we expected, and what happened after.",
             "TODO", "NORMAL", MUHAMMAD, None, None),
            ("MERCHANTS", "Notifications inbox and daily digest",
             "In-app notifications plus one morning e-mail, instead of scattered alerts.",
             "TODO", "NORMAL", None, None, None),
            ("MERCHANTS", "Search everything", "One search box (⌘K) across merchants, deals, quotes and people.",
             "TODO", "NORMAL", None, None, None),
            ("MERCHANTS", "Link merchants to Salesforce restaurants",
             "Connect each merchant profile to its Salesforce account, so sales and service data meet.",
             "TODO", "NORMAL", None, None, None),
            ("MERCHANTS", "Location view for multi-location merchants", "See and filter by location, with roll-ups.",
             "TODO", "LOW", None, None, None),
        ],
    ),
    (
        "Marketing modules",
        "The team's marketing work lives in the Super App: SEO, GBP and Google Ads (Uplit is retired).",
        D(2027, 2, 1), D(2027, 3, 1),
        [
            ("MARKETING", "SEO and GBP modules in the Super App",
             "Built by the developer and merged in October 2026; they replace Uplit. Next: connect Google and load "
             "the client list.",
             "IN_PROGRESS", "HIGH", MUHAMMAD, None, None),
            ("MARKETING", "Google Search Console and Business Profile connection",
             "Pull clicks, views and calls automatically with a Google sign-in. Built; needs the Google sign-in "
             "keys and redirect addresses on the live API.",
             "IN_PROGRESS", "NORMAL", None, None, None),
            ("MARKETING", "Decide: is Google Ads a full module?",
             "Yes: Google Ads is a full Super App module, and Uplit is retired.",
             "DONE", "NORMAL", SHAYAN, None, D(2026, 10, 19)),
            ("MARKETING", "Ads: Google Ads module connected to live data",
             "Accounts, monthly reports and alerts in the Super App, synced from Google Ads.",
             "IN_PROGRESS", "NORMAL", MUHAMMAD, None, None),
            ("MARKETING", "Reviews per merchant", "Ratings, new reviews and reply status.",
             "TODO", "NORMAL", None, None, None),
            ("MARKETING", "Email and SMS campaign results", "Sends, opens, clicks and orders per campaign.",
             "TODO", "NORMAL", None, None, None),
            ("MARKETING", "Custom domains for restaurant websites", "Sites on the restaurant's own domain.",
             "TODO", "LOW", None, None, None),
        ],
    ),
    (
        "Intelligence, money and reporting",
        "Turn the data into answers and reports, and see Innowi's revenue per merchant.",
        D(2027, 4, 1), D(2027, 6, 1),
        [
            ("MERCHANTS", "MIA: AI assistant that shows its evidence",
             "Summaries and answers on each screen, always pointing to the data behind them.",
             "TODO", "NORMAL", None, None, None),
            ("MERCHANTS", "Client reports with PDF and Excel export",
             "Build a monthly report per merchant and send it.", "TODO", "NORMAL", None, None, None),
            ("MARKETING", "Performance across modules", "Results per merchant from SEO, ads, website and campaigns.",
             "TODO", "NORMAL", None, None, None),
            ("SALES", "Billing: what each merchant pays us",
             "Contract versus charged per merchant, missed charges and churn risk.", "TODO", "NORMAL", None, None,
             None),
            ("MARKETING", "Rewards (loyalty) results", "Members and redemptions from Innowi loyalty.",
             "TODO", "LOW", None, None, None),
            ("MERCHANTS", "Orders and guests", "Order volume and guest counts per merchant.",
             "TODO", "LOW", None, None, None),
            ("MERCHANTS", "Restaurant owner portal", "Owners sign in to see their own reports (read-only).",
             "TODO", "LOW", None, None, None),
        ],
    ),
]
