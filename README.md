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

The home page lets people pick U8s, U9s, U10s or U11s. Each group has its own drills and its own two training days (set in `src/lib/groups.ts`):

| Group | Training days |
|---|---|
| U8s | Wednesday, Friday |
| U9s | Tuesday, Friday |
| U10s | Tuesday, Thursday |
| U11s | Tuesday, Thursday |

Anyone can view. Only coaches linked to a group can add/delete drills or change that group's session plans.

Database changes live in `supabase/migrations/002_age_groups.sql` (run once in the Supabase SQL Editor).

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
