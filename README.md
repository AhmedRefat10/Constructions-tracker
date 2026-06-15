# Construction Tracker — Vercel + Supabase

This version saves the app data in Supabase so the same expenses appear on laptop and mobile after signing in with the same account.

## What changed

- Added Supabase client: `src/supabaseClient.js`
- Added email/password login and sign-up screen
- Added cloud sync for the full app state
- Kept localStorage as a fallback/backup cache
- Added Supabase SQL schema and RLS policies: `supabase/schema.sql`
- Added Vercel-ready build config

## 1) Create Supabase project

1. Open Supabase Dashboard.
2. Create a new project.
3. Go to **Authentication → Providers → Email** and keep Email enabled.
4. Go to **SQL Editor → New query**.
5. Paste and run the contents of `supabase/schema.sql`.

## 2) Get Supabase keys

From **Project Settings → API** copy:

- Project URL
- `anon` key / publishable key for client-side use

Create a local `.env` file:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-key-here
```

## 3) Run locally

```bash
npm install
npm run dev
```

## 4) Deploy to Vercel

Import this folder into Vercel or deploy with the CLI.

Add the same variables in **Vercel → Project → Settings → Environment Variables**:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Then redeploy.

## Important behavior

- The React app is hosted on Vercel.
- Supabase stores the data online.
- Open the app on laptop and mobile, sign in with the same email/password, and the data will sync.
- Export/import JSON still exists as a manual backup option.

## Build check

This package was tested with:

```bash
npm run build
```
