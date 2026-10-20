# Drill Archive

Mobile-first web app to archive and collate youth football training drills.

## Tech Stack
- Frontend: Next.js (App Router) + Tailwind CSS + Lucide Icons
- Backend/DB: Supabase (Auth, Postgres)
- Hosting: Vercel (free tier)

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a Supabase project, then run `supabase/migration.sql` in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).

3. Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL/anon key:
   ```
   cp .env.local.example .env.local
   ```

4. In Supabase Dashboard → Authentication → URL Configuration, add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-PROD-DOMAIN/auth/callback` (once deployed)

5. In Supabase Dashboard → Authentication → Providers → Email, make sure "Confirm email" is enabled (the app blocks posting drills until email is verified).

6. Add real PWA icons to `/public/icon-192.png` and `/public/icon-512.png` (192x192 and 512x512 PNGs).

7. Run locally:
   ```
   npm run dev
   ```

## Age groups

The home page lets people pick Academy, U8s, U9s, U9 Girls, U10s or U11s. Each group has its own drills and its own two training days (set in `src/lib/groups.ts`):

| Group | Training days |
|---|---|
| Academy | Sunday |
| U8s | Wednesday, Friday |
| U9s | Tuesday, Friday |
| U9 Girls | Tuesday, Thursday |
| U10s | Tuesday, Thursday |
| U11s | Tuesday, Thursday |

Anyone can view. Only coaches linked to a group can add/delete drills or change that group's session plans.

Database changes live in `supabase/migrations/002_age_groups.sql` (run once in the Supabase SQL Editor). U9 Girls (`u9g`) was added in `010_u9_girls.sql`; it plays like U9s (5-a-side, two games on the day, no positions).

## Match Day (coaches only)

Pick an upcoming match (players who said Yes are ticked) or a quick game, untick anyone missing, check the starting line-up and the sub plan under it (U10s/U11s are placed by main then second position; the keeper spot is left empty if nobody has GK), then **Kick off**.

- Halves: U8s/U9s/U9 Girls/Academy 12 min, two games if the match has a Game 2; U10s/U11s 25 min, one game.
- When a sub is due: beep + banner. Nothing changes until the coach taps who's coming off and who's going on. "Not now" snoozes 1 minute.
- Tap two pitch players to swap spots (not a sub). Bench is sorted by fewest minutes.
- The clock is worked out from the time on the phone, not by ticking, so it stays right if the phone locks — but a locked phone can't beep. The app asks the phone to keep the screen on and tells coaches to keep it unlocked.
- The live match lives on the coach's phone (survives a reload).
- **Game time:** on the line-up screen, under the bench. Every player shows the % of the game they'll get and their minutes; tap one to set their % (− / + or type it) or leave them on **Auto** (an even share of what's left). **Sub every** N′ is the only timing setting: a sub window at N, 2N, 3N… one sub at a time. **In goal** has one box per half (two games = four): pick the same player for every half and they're 100%; a keeper for one half can't go below 50%. Keepers change only at half-time. **Show plan** opens a timeline (on / in goal) and the subs to expect if everything happens on time. The line under the title goes amber with the reason if the % can't work or the plan is uneven. **Save plan** stores the line-up, bench order, sub gap, keepers and % per match (`match_plans`; keepers live in its `schedule` column) for the other coaches of that group. During the game nothing is fixed in advance: at each window the app picks the sub from real minutes played — the bench player furthest behind their % comes on for the player furthest ahead of theirs (starters can come off at the first window; anyone who comes on stays at least 10′; U10s/U11s like-for-like position only breaks ties). The coach taps **Done** or picks different players; either way the next pick uses the real minutes, so a late or swapped sub never breaks anything. A window where nobody needs a change is skipped. At half-time a keeper change shows first (**Done**, or keep the current keeper). An early sub (e.g. an injury) doesn't move the next window. Quick games work the same, but the plan stays on that phone.

## Squads (coaches only)

Coaches see a second tab row with **Squads**. There they create teams within their age group (e.g. 10.1, 10.2), add players (first name only) and move players between teams. U10s and U11s players get a main and a second position, picked on a mini pitch (GK, LB, RB, LM, CM, RM, ST). Deleting a team keeps its players under "No team yet".

Only that age group's coaches can see or change its squad. Database: `supabase/migrations/003_teams_squad.sql`.

## Parents (coaches only)

Coaches add a match (team, date, meet time, kick-off, opponent, home/away, location, kit, notes; U8s/U9s/U9 Girls/Academy can add a second game on the day). **Share to WhatsApp** opens WhatsApp with the message written, ending in a secret link. Parents tap their child's name and Yes/No — no login. The link only shows that team's first names and stops working the day after the match. Coaches can also set answers themselves.

Database: `supabase/migrations/004_matches.sql`. Parents never get table access; they only reach two database functions (`rsvp_match`, `rsvp_answer`) that check the secret link.

**Table permissions:** this Supabase project does not give the app access to new tables automatically. Every migration that creates a table must `grant … to authenticated` (RLS then decides which rows).

## Coach accounts

Two kinds of coach per age group:

- **Coordinator** — every team in the age group. Only coordinators add, rename or delete teams, and see players with no team.
- **Team coach** — only their own team(s): squad, matches, parents' answers, sub plan, Match Day. Other teams in the group are hidden, by the database not just the screen.

Everyone in an age group shares its drills and training plans. Database: `supabase/migrations/009_team_lock.sql`.

A team can move to another age group (e.g. 9.6 Girls from U9s to U9 Girls): `update teams set age_group = 'u9g' where id = '…'` carries its players, matches, parents' answers and sub plans with it (`010_u9_girls.sql` makes the links follow). Its coaches then need a `coach_groups` row for the new group.

1. Supabase → Authentication → Users → **Add user** → *Create new user*. Enter the coach's email + a temporary password, tick **Auto Confirm User**. Coaches change it themselves: key icon at the top of their age group → **Change password**.
2. Supabase → SQL Editor, give them their group:
   ```sql
   insert into coach_groups (user_id, age_group, all_teams)
   select id, 'u9', false from auth.users where email = 'coach@example.com';
   ```
   `all_teams` `true` = coordinator, `false` = team coach. Groups: `'academy'`, `'u8'`, `'u9'`, `'u9g'` (U9 Girls), `'u10'`, `'u11'`.
3. Team coaches only: link their team (name exactly as in Squads; run again for a second team):
   ```sql
   insert into coach_teams (user_id, team_id)
   select u.id, t.id from auth.users u, teams t
   where u.email = 'coach@example.com' and t.age_group = 'u9' and t.name = '9.5';
   ```
4. To remove access:
   ```sql
   delete from coach_groups
   where age_group = 'u9'
     and user_id = (select id from auth.users where email = 'coach@example.com');
   ```
   (A team coach with no `coach_groups` row sees nothing, even if `coach_teams` still lists them.)
5. Forgotten password (Supabase can't email coaches without your own email service): set a new temporary one, and tell the coach to change it.
   ```sql
   update auth.users set encrypted_password = extensions.crypt('new-temp-password', extensions.gen_salt('bf'))
   where email = 'coach@example.com';
   ```

Keep lists of real coaches' emails out of this repo — it's public.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Vercel → New Project → import repo (Next.js auto-detected).
3. Add environment variables in Vercel → Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (your prod URL)
4. Deploy. Update `NEXT_PUBLIC_SITE_URL` + Supabase redirect URLs once you have the real domain, then redeploy.

## Deploy (Cloudflare)

Not a drop-in fit — this app uses Next.js Server Actions and Node-runtime API routes. Cloudflare Pages needs the `@cloudflare/next-on-pages` adapter and some patterns here (server actions + `redirect()`, cookie mutation in middleware) have had compatibility issues historically. Vercel is the path of least resistance for this stack. Treat Cloudflare as a separate migration effort if required.

## Project Structure

See file tree in this repo. Key directories:
- `src/app/` — routes (App Router)
- `src/components/` — UI components
- `src/lib/supabase/` — Supabase client setup (browser/server/middleware)
- `src/lib/tags.ts` — shared tag resolution logic
- `supabase/migration.sql` — full DB schema, RLS policies, RPC function

## Known follow-ups (not yet built)
- Automated content moderation (currently manual report flag only)
- Instagram/TikTok oEmbed metadata auto-fetch (requires signed app tokens — manual entry for now)
- PWA icons (placeholders needed in `/public`)
