# TELOS

**Live with intention. Move with purpose.**

A private, multi-user life management platform that connects what you do today
with the life you are trying to build:

```
Purpose → Objective → Milestone → Project → Responsibility → Today
```

TELOS is not a to-do list. It is a personal system for deciding what deserves
your attention now, and for seeing how that decision ladders up to something
you actually care about.

---

## Running it

```bash
npm install
npm run seed        # optional: a realistic demo account
npm start           # http://localhost:4317
```

The demo account seeded by `npm run seed`:

```
demo@telos.app  ·  Intention-2026!
```

It carries six objectives, twenty milestones, eight projects, fifty
responsibilities across education, career, finance, health, travel, learning
and home, plus two months of completion history so Insights has something real
to reflect. Everything in it is editable and removable.

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with automatic restart |
| `npm run seed` | Create or refresh the demo account |
| `npm test` | Run the 356-check verification suite |
| `node scripts/check-client.mjs` | Parse every client module and resolve its imports |
| `npm run reset` | Delete the database and start clean |

Requires Node 20 or newer. There is no build step: the client is served as
native ES modules.

---

## Architecture

```
server/
  config.js        environment, secrets, cookie and session policy
  db.js            SQLite schema; every user-owned table cascades on delete
  security.js      scrypt password hashing, opaque tokens, cookie handling
  middleware.js    security headers, CORS, rate limiting, CSRF, sessions
  validate.js      input validation for every field the API accepts
  ownership.js     the authorization primitive — `user_id = ?` on every query
  domain.js        dates, recurrence, progress rollups, focus scoring
  serialize.js     row → API shape; drops hashes, tokens and internals
  assistant/
    knowledge.js   the assistant's source of truth about TELOS itself
    plan.js        the plan digest — every count computed in SQL, not guessed
    actions.js     proposals; validated and re-checked before anything applies
    local.js       the on-server responder — no network, no key
    claude.js      the Claude adapter; the API key never leaves the server
  services/
    tasks.js       task operations shared by the REST API and the assistant
    review.js      the weekly review, computed from completion history
  routes/          auth · account · areas · tasks · projects · objectives
                   notes · events · reminders · overview · calendar
                   insights · search · assistant · reflections
public/
  css/telos.css    the whole design system in one file
  js/
    main.js        routing, authentication gate, boot
    shell.js       sidebar, top bar, mobile navigation, shortcuts
    api.js         fetch wrapper; attaches the CSRF token
    quickparse.js  natural-language parsing for Quick Add
    components/    task row, task editor, quick add
    views/         one module per surface
scripts/
  seed-demo.mjs    realistic sample data
  test-suite.mjs   end-to-end verification
  check-client.mjs static analysis of the browser bundle
```

**Stack:** Node + Express + SQLite (`better-sqlite3`). Two runtime dependencies.
Passwords are hashed with scrypt from Node core; sessions, CSRF, rate limiting
and validation are implemented directly rather than pulled in.

---

## Security

Security was treated as an architectural requirement, not a checklist. The
verification suite (`npm test`) exercises each item below against a live
server.

**Credentials**
- scrypt (N=16384, r=8, p=1) with a per-user salt. No password is ever stored,
  logged, or returned.
- Sign-in failures are identical whether or not the account exists, and take
  the same time — a dummy verification runs for unknown accounts.
- Accounts lock for 15 minutes after 8 failed attempts; sign-in, sign-up,
  reset and import are each rate limited independently.
- Password strength is enforced server-side: length, character classes, common
  passwords, and no reuse of the name or email.

**Sessions**
- Opaque 256-bit tokens. Only an HMAC of the token is stored, so a database
  disclosure cannot be replayed as a session.
- `HttpOnly`, `SameSite=Lax`, `Secure` in production. JavaScript never sees the
  session token.
- Absolute expiry, idle expiry, server-side revocation, a live session list,
  and "sign out of other devices". Changing or resetting a password revokes
  every other session and rotates the current one.

**Authorization and isolation**
- Every read and write is scoped by `user_id = ?` in SQL. Nothing relies on the
  client sending the right identifier.
- Another account's record returns *404, not 403* — identifiers cannot be
  probed for existence.
- Foreign keys are validated for ownership before they are stored, so a task
  cannot be attached to someone else's project.
- Bulk operations silently skip identifiers that are not yours.
- The suite attempts 18 cross-account writes and 5 cross-account reads and
  confirms every one is refused and nothing is modified.

**Transport and input**
- CSP (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP/CORP. No inline scripts.
- Double-submit CSRF token plus an `Origin` check on every state change.
- CORS is same-origin by default; credentialed cross-origin requests only for
  explicitly allow-listed origins.
- Every SQL value is a bound parameter. Every value rendered in the browser is
  set via `textContent` — the only markup ever injected is the internal icon
  set.
- Links are restricted to `http`/`https`, so `javascript:` and `data:` URLs
  cannot be stored.
- Errors return a plain message; stack traces and paths stay on the server.

**Privacy**
- One-click export of everything the account holds, as JSON.
- Import remaps every identifier, so it can never reference or overwrite
  another account.
- Selective deletion, full data deletion, and account deletion — each
  password-confirmed and typed-to-confirm. Deletion cascades through every
  table; the suite verifies zero rows remain.
- No third-party requests, no analytics, no telemetry. The CSP forbids them.

### Before deploying

1. Set `TELOS_SECRET` to a unique random value of at least 32 characters.
2. Set `TELOS_APP_URL` to the real origin.
3. Terminate TLS in front of the app and set `TELOS_TRUST_PROXY=true`.
4. Leave `TELOS_EXPOSE_DEV_TOKENS` off — in development it returns reset links
   in the response so they can be followed without a mail transport.
5. Configure `TELOS_EMAIL_TRANSPORT=webhook` so reset and verification links
   actually reach people.
6. Back up the `data/` directory.

---

## What it does

**Overview** — the greeting, one honest line about the day, Today's Focus,
Attention Required, Upcoming, objectives, active projects, and quick actions.
Focus ordering blends proximity of the due date, stated priority, marked
importance, whether work is already in motion, and whether it serves an
objective — not simply chronology.

**Responsibilities** — title, description, notes, start and due dates, due
time, priority, importance, area, tags, status, recurrence, reminder,
subtasks, links, estimated and actual duration. Complete, edit, delete,
duplicate, reschedule, reprioritise, mark important, make recurring, add
steps. List, board and timeline layouts, with bulk actions.

**Importance is not urgency.** A responsibility can be urgent (a deadline in
two hours), important (an application due this month), meaningful (a skill
worth building), or routine — and TELOS keeps those distinct in both its
ordering and its language.

**Objectives → Milestones → Projects** — progress flows upward automatically:
subtasks inform a responsibility, responsibilities inform a project, projects
and direct work inform a milestone, milestones inform the objective. Or set an
objective's progress by hand.

**Recurrence** — daily, weekdays, weekly (any set of days), fortnightly,
monthly, a set day each month, quarterly, yearly, or a custom interval, with an
optional end date. Completing an occurrence advances the next one; missed
occurrences either skip forward or advance one step, your choice.

**Calendar** — day, week, month and year. Drag to reschedule. Future
occurrences of recurring work appear as dashed projections. Project and
objective deadlines and milestone targets sit alongside.

**Quick Add** — write it the way you would say it. *"Submit assignment tomorrow
at 6 PM, high priority"* or *"Review finances every Sunday at 10 AM"*. What the
parser understood is shown as chips before anything is created, and the full
editor is one click away.

When the patterns clearly miss something — *"chase the invoice again in a couple
of weeks"*, *"review the contract sometime next quarter"* — and the assistant is
in Claude mode, Claude reads the sentence instead and fills the gaps the
patterns left. The chips look the same either way, with a line naming what it
did: *Read by Claude — read "a couple of weeks" as two weeks from today*. It
still only proposes; nothing is created until you press Add. See
[The Quick Add fallback](#the-quick-add-fallback).

**Insights** — completion rate, distribution by area and priority, rhythm by
weekday and time of day, project and objective progress, monthly trend. Every
chart carries a table view. No scores, no streaks, no comparisons.

**Weekly reflection** — *Insights → Weekly review*. The week as it actually
went: what was completed and on which days, what was due and is still open,
where attention went by area, which milestones and objectives moved, what is
already dated for the week ahead, and what has been quietly open for a while.
Beneath it, a space to write, with a few questions drawn from that particular
week. Move between weeks with the arrows.

The writing is yours and saves as you type; the figures are snapshotted with
it, so a reflection read months later still shows the week it was about rather
than a recalculation against data that has moved on. Overview offers a link
back when a finished week has something in it and nothing has been written —
and the offer disappears once it has, rather than reappearing to shame a
skipped week.

The tone is deliberately flat. *"7 responsibilities completed, against 15 the
week before, 13 still open from the week"* is how a worse week reads: stated,
not softened and not scolded. The prompts are questions rather than verdicts —
*"Career and Finance had your attention last week and none this week. Was that
a choice, or did it slip out of view?"* — and they notice **changes** rather
than absences, since most areas are quiet in most weeks and saying so would be
noise.

**Assistant** — answers questions about your actual plan (*"what's overdue?"*,
*"what should I start with today?"*, *"how is the portfolio project going?"*),
helps with the fiddly parts (wording a title, a short description, tags,
breaking work into steps or milestones), explains TELOS's own settings and
vocabulary, and can **propose changes for you to confirm** — *"move everything
overdue to tomorrow"*. It appears as a side panel (`A`), and as a *Suggest*
control beside the fields it can help with. Nothing is ever applied without you
choosing it.

**Also** — global search across every surface, notes, events, reminders,
customisable Areas of Life, light/dark/system themes, five accents, two
densities, timezone and week-start preferences, keyboard shortcuts.

---

## The assistant, and what it shares

The assistant has three modes, chosen per account in **Settings → Assistant**.
The mode is stored on the account and enforced on the server, not hidden in the
interface.

| Mode | What happens | Setup |
|---|---|---|
| **On this server only** *(default)* | Answers come from TELOS's own definitions — its settings, its vocabulary — plus simple wording rules. **Nothing you write leaves the machine TELOS runs on.** | None |
| **Use Claude** | Richer wording, descriptions and breakdowns via the Claude API. | An API key on the server |
| **Off** | No assistant, no suggestion controls anywhere. | — |

### Ground the facts, let language happen on top

Two things are never left to a model to remember or infer:

- **How TELOS works** comes from `server/assistant/knowledge.js` — the real
  settings, their real paths, and the product's vocabulary. In Claude mode that
  file is injected into the system prompt.
- **What is in your plan** comes from `server/assistant/plan.js`, which reads
  your own rows and computes counts, overdue items, focus ordering and progress
  using the same helpers the dashboard uses.

So "three responsibilities are past their date" is a query result, not a guess,
and it agrees with the number on the Overview screen. **This works with no API
key at all** — reading your own database is free and private, so the on-server
mode answers plan questions just as accurately as Claude mode does. Claude adds
judgment and open-ended reasoning on top of the same facts.

### Actions are proposed, never taken

The assistant can act on your plan — reschedule, complete, reopen, change a
priority, mark something important, add a responsibility. It cannot do any of
it on its own.

What it produces is a **proposal**: a list of intended changes, each with a
checkbox. Nothing touches the database until you untick what you don't want and
press **Apply**. Applied changes come back with an **Undo** built from the same
action vocabulary, so reverting is just applying the inverse.

Three properties make this safe rather than merely polite:

- **The model cannot execute anything.** It returns actions as *data* — never
  as tool calls that run. The server validates every reference against your own
  rows and silently drops anything it invented.
- **`/assistant/apply` treats its input as hostile.** It re-validates and
  re-checks ownership from scratch, so an action list edited in the browser
  cannot reach another account's data. The suite proves this by having one
  account submit a hand-written action list against another's task.
- **Deletion is not in the vocabulary.** In any mode. Removing something stays a
  decision you make directly.

Changes route through `server/services/tasks.js`, shared with the REST API, so
completing a recurring item through the assistant advances it exactly as
completing it from the list does.

### The Quick Add fallback

Quick Add's own parser is regex over a fixed vocabulary, and that is the right
default: it is instant, free, offline, and predictable. But it only knows the
phrasings it was written for. *"in a couple of weeks"*, *"sometime next
quarter"*, *"after the holidays"* — real ways people write dates — go unread,
and the responsibility is created with no date at all.

So the patterns run first, always. Only when they **clearly** left something
unread does Claude get asked:

```js
export function looksUnread(text, parsed) {
  const value = String(text || '').trim();
  if (value.length < 12) return false;
  if (RECURRENCE_HINT.test(value) && !parsed.recurrence) return true;
  if (DATE_HINT.test(value) && !parsed.dueDate) return true;
  return false;
}
```

That is the whole trigger: the sentence *talks about* time, and the parser found
none. A sentence with no scheduling language in it is not a failure and does not
call anything — *"Rewrite the onboarding email copy"* offers a **Read with
Claude** button instead and waits to be asked. The automatic path is debounced
to 750ms, so it is one call per settled sentence, not one per keystroke.

Claude's reading is merged **over** the patterns, never instead of them: any
field it leaves empty keeps the local value, and the moment you edit the
sentence the patterns become authoritative again. A slow reply that arrives
after you have changed the text is discarded rather than applied to a sentence
it never saw.

Both readings render through one function, so the chips cannot quietly mean
different things depending on who produced them. When Claude produced them the
chips are followed by a line saying so, and what it inferred:

> *Read by Claude — read "a couple of weeks" as two weeks from today*

**The reply is data, not an instruction.** `POST /assistant/parse` asks for a
[structured output](server/assistant/claude.js) and then re-validates every
field against your own rows — a date must be a real date, a priority must be one
of the four, an area or project name is resolved to an id **owned by you** or
dropped. There is no field it can return that creates, changes or deletes
anything: the result is a draft on screen, and Add is still yours to press.

Privacy is unchanged by this. The sentence you type is your message, and area
and project names were already in the always-sent column below; no plan data is
sent, and the fallback needs no permission beyond Claude mode itself. In
on-server mode the endpoint returns nothing and says why, and Quick Add carries
on with the patterns exactly as before.

### What is shared

Reading your plan in **on-server mode sends nothing anywhere** — it is the same
data already on your screen, read from the same database.

Sending it to Claude is a **separate permission**, off by default, in
Settings → Assistant. Letting it propose changes is a **third** permission,
also off by default:

| | Always sent in Claude mode | Added by "let Claude see what's on your plate" | Never sent |
|---|---|---|---|
| | Your message; the field you asked about; names of areas, projects and objectives | Titles, dates, priorities, statuses, progress, completion counts | Descriptions, notes, note bodies, links |

Nothing is sent unless you send a message or press *Suggest*. The permission is
checked on the server on every request, not hidden in the interface.

The knowledge base and voice are byte-stable and carry the prompt-cache
breakpoint; the plan digest — which changes every request — sits after it, so
the expensive half of the prompt is cached rather than re-billed.

The API key lives only in the server's environment. The browser never holds it
and never calls Anthropic directly — every request is proxied, rate limited,
and scoped to the signed-in account.

To enable Claude mode:

```bash
# in .env
TELOS_ANTHROPIC_API_KEY=sk-ant-...
```

Then restart. If the key is missing or a request fails, accounts set to Claude
fall back to the on-server assistant and say so, rather than failing.

---

## Design

Minimal, sophisticated, calm. A serif display face against a system sans, warm
paper light theme and warm charcoal dark theme, hairline borders, generous
whitespace, and a single restrained accent. No gradients, no decorative
illustration, no gamification, and — apart from what you type yourself — no
emoji anywhere: navigation and areas use a hand-drawn line icon set.

Responsive from a phone to a wide display: a sidebar on desktop, a compact
header and bottom navigation on mobile, no horizontal scrolling, and touch
targets sized for thumbs.

---

## Verification

```
npm test
```

356 checks across registration, sign-in, lockout, sign-out, password reset,
email verification, rate limiting, CSRF, security headers, authentication,
cross-account isolation, input validation, injection handling, error leakage,
recurrence arithmetic, progress rollups, calendar interaction, persistence,
export/import, account deletion, the assistant, its actions, the weekly
reflection, and the Quick Add fallback.

Defects this suite caught during development, all since fixed:

- Ending a session also cleared the CSRF cookie, which would have broken the
  sign-in form straight after a password reset.
- A yearly recurrence anchored on 29 February skipped to 1 March instead of
  clamping to the 28th.
- The assistant matched keywords as substrings, so "import**ant**" resolved to
  the Import setting. Matching is now on whole words.
- A rough task that happened to contain a settings word ("I need to **email**
  Sarah…") was answered as a question about that setting instead of being
  worded as a task.
- A verb buried mid-phrase was promoted to the front, turning "Draft the case
  **study** introduction" into "Read Draft the case introduction".
- Once the assistant could read the plan, *"what's the difference between
  **important** and urgent?"* was answered by listing what is marked important.
  Definitional questions now stand aside for the knowledge base.
- *"How is the portfolio **website project** going?"* resolved to an objective
  that merely shared a word with it. Name matching now prefers an exact name,
  and the kind the question actually asked for.
- *"Complete the dentist one"* matched nothing and fell through to rewording,
  because a single-word title match was rejected. It now matches on a
  distinctive word — and where two responsibilities fit equally well, it asks
  instead of picking one.
- Applying a proposal refreshed the sidebar counts but left the list behind the
  panel showing the old dates.
- `event.currentTarget` was read after an `await` in seven handlers — it is
  null by then, so every one of those error paths would itself have thrown.
  Found via the assistant's Undo; fixed everywhere.
- In the weekly chart, a percentage bar height inside each day's own flex
  column made empty days lay out 4px taller than filled ones, pushing their
  labels 44px out of line. Bars and labels are now separate rows sharing one
  baseline.
- One defect was in the test, not the code. A Quick Add case asserted that
  *"finish the deck before the end of the month"* needed the fallback — but the
  patterns handle "end of month" perfectly well, and the assertion was written
  from an assumption about the parser rather than from reading it. The
  expectation was wrong, so it was replaced with sentences the patterns really
  do miss, plus a positive check that pins down the behaviour that was there all
  along. Worth recording: a red test is a claim about the code, and the claim is
  sometimes the thing that is false.

