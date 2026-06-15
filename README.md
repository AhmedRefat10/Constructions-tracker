# Construction Tracker — Supabase + Vercel

This version is prepared to avoid the Vercel `npm error Exit handler never called!` install issue.

Changes in this fixed package:

- Removed `package-lock.json`.
- Pinned dependency versions instead of using `latest`.
- Added Node 20 engine.
- Added a Vercel install command that runs `npm install --no-package-lock --no-audit --no-fund`.

## Vercel settings

Framework Preset: Vite
Install Command: `npm install --no-package-lock --no-audit --no-fund`
Build Command: `npm run build`
Output Directory: `dist`

## Environment Variables

Add these in Vercel Project Settings → Environment Variables:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Supabase setup

Run the SQL in:

```text
supabase/schema.sql
```
