# Paycheck and Debt Planner

A minimalist, mobile-first planner for each pay cycle: salary, bills, installments, credit cards, other money, borrowing options and BillBuddy sync.

Plain static files, no build step. Open `index.html` or serve the folder (e.g. `python3 -m http.server`) and deploy to any static host.

- `index.html` – markup
- `styles.css` – layout for phones, tablets and desktop (two columns from 1024px), light/dark
- `app.js` – planner logic
- `config.js` – Supabase connection (optional)
- `supabase/schema.sql` – the table and access rules for cloud saving
- `vendor/` – the Supabase client library (v2.116.0), served locally
- `manifest.webmanifest`, `icon*.{svg,png}` – install to home screen

## Saving

Data is always kept in the browser. With Supabase set up, signing in also saves it to your account so it follows you to every device.

### Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it. This creates `planner_state` (one row per user) with Row Level Security, so each person can only read and change their own row.
3. **Authentication → URL Configuration**: set **Site URL** to where the planner is hosted (e.g. `https://your-planner.vercel.app`) and add it under **Redirect URLs**. Sign-in links send you back there.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into `config.js`. The anon key is meant to be public; Row Level Security protects the data. Never put the `service_role` key here.
5. Open the planner, tap **Sign in**, enter your email and open the link from the same device.

How it syncs:

- Every change saves to your account about a second later.
- The first time you sign in, the account gets whatever is on that device. After that, the account's copy wins when you sign in on another device.
- Coming back to the app picks up changes made on another device.
- BillBuddy's link and key are never sent to Supabase; they stay on each device.
