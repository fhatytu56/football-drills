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

The home page lets people pick Academy, U8s, U9s, U10s or U11s. Each group has its own drills and its own two training days (set in `src/lib/groups.ts`):

| Group | Training days |
|---|---|
| Academy | Sunday |
| U8s | Wednesday, Friday |
| U9s | Tuesday, Friday |
| U10s | Tuesday, Thursday |
| U11s | Tuesday, Thursday |

Anyone can view. Only coaches linked to a group can add/delete drills or change that group's session plans.

Database changes live in `supabase/migrations/002_age_groups.sql` (run once in the Supabase SQL Editor).

## Match Day (coaches only)

Pick an upcoming match (players who said Yes are ticked) or a quick game, untick anyone missing, check the starting line-up and the sub plan under it (U10s/U11s are placed by main then second position; the keeper spot is left empty if nobody has GK), then **Kick off**.

- Halves: U8s/U9s 12 min, two games if the match has a Game 2; U10s/U11s 25 min, one game.
- When a sub is due: beep + banner. Nothing changes until the coach taps who's coming off and who's going on. "Not now" snoozes 1 minute.
- Tap two pitch players to swap spots (not a sub). Bench is sorted by fewest minutes.
- The clock is worked out from the time on the phone, not by ticking, so it stays right if the phone locks — but a locked phone can't beep. The app asks the phone to keep the screen on and tells coaches to keep it unlocked.
- The live match lives on the coach's phone (survives a reload).
- **Sub plan:** on the line-up screen. Set when subs happen (**First subs at** 10′, **How many** 2, **Then every** 5′, **How many** 1 — the 7-a-side default; 5-a-side starts at 1 every 5′) and, if you want, a **game-time %** for any player (tap them; **Auto** players share what's left evenly). The app plans the subs: at each window the bench player furthest behind their target comes on for the player furthest ahead of theirs, nobody comes off within 10′ of coming on, and U10s/U11s like-for-like position only breaks ties. The U10s/U11s keeper stays on. A timeline shows each player's planned time; the line under the settings goes amber if the targets can't work. **Save plan** stores line-up, sub times, targets and subs per match (`match_plans`, migrations 006 + 008) for the other coaches of that group. During the game the alert goes off at each planned minute (a half-time window shows at half-time) with the planned pair and **Done**; the coach can tap different players instead and the plan carries on. An early unplanned sub (e.g. an injury) doesn't skip the next planned one. Quick games get a plan too, but it stays on that phone.

## Squads (coaches only)

Coaches see a second tab row with **Squads**. There they create teams within their age group (e.g. 10.1, 10.2), add players (first name only) and move players between teams. U10s and U11s players get a main and a second position, picked on a mini pitch (GK, LB, RB, LM, CM, RM, ST). Deleting a team keeps its players under "No team yet".

Only that age group's coaches can see or change its squad. Database: `supabase/migrations/003_teams_squad.sql`.

## Parents (coaches only)

Coaches add a match (team, date, meet time, kick-off, opponent, home/away, location, kit, notes; U8s/U9s can add a second game on the day). **Share to WhatsApp** opens WhatsApp with the message written, ending in a secret link. Parents tap their child's name and Yes/No — no login. The link only shows that team's first names and stops working the day after the match. Coaches can also set answers themselves.

Database: `supabase/migrations/004_matches.sql`. Parents never get table access; they only reach two database functions (`rsvp_match`, `rsvp_answer`) that check the secret link.

**Table permissions:** this Supabase project does not give the app access to new tables automatically. Every migration that creates a table must `grant … to authenticated` (RLS then decides which rows).

## Coach accounts

1. Supabase → Authentication → Users → **Add user** → *Create new user*. Enter the coach's email + a password, tick **Auto Confirm User**.
2. Supabase → SQL Editor, give them their group(s):
   ```sql
   insert into coach_groups (user_id, age_group)
   select id, 'u8' from auth.users where email = 'coach@example.com';
   ```
   Use `'u8'`, `'u9'`, `'u10'` or `'u11'`. Run it again with another group to give a coach more than one.
3. To remove access:
   ```sql
   delete from coach_groups
   where age_group = 'u8'
     and user_id = (select id from auth.users where email = 'coach@example.com');
   ```

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
