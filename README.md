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

## Bills and categories

Each category's bills sit together on a background of that category's color. **Categories** (on the Bills tab) opens a small window: add a category, or pick one to rename it, change its color, choose what it counts as (bills you must pay, essentials, installments, credit cards, or can be cut) or delete it. A category that still has bills asks where to move them. To move a bill, tap Edit on it and pick its category.

## Repeating and one-time bills

A bill repeats every month on its due day. In its form, **Stops after** sets the last month it's due; leave it empty and it never stops. Untick **Repeats every month** for a one-time bill, which takes an exact due date and only counts in the pay cycle that date falls in. One-time bills in a later cycle are listed under *Coming in a later cycle*; bills that have stopped, or one-time bills whose date has passed, are kept under *Ended* until you remove them. Installments and credit cards don't have these options: installments end by payments left, and card amounts come from each statement.

## Saving

Everything is stored in Supabase: you sign in first, and the planner loads from and saves to your account. Nothing is kept in the browser except the sign-in (so the device opens straight in) and your email address. Without `config.js` filled in, the planner shows a setup message instead.

### Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it. This creates `planner_state` (one row per user) with Row Level Security, so each person can only read and change their own row.
3. **Authentication → URL Configuration**: set **Site URL** to where the planner is hosted (e.g. `https://your-planner.vercel.app`) and add it under **Redirect URLs**. Sign-in links send you back there.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into `config.js`. The anon key is meant to be public; Row Level Security protects the data. Never put the `service_role` key here.
5. Open the planner, enter your email and open the sign-in link from the same device.

How it syncs:

- Every change saves to your account about a second later; a failed save retries every 5 seconds.
- Coming back to the app picks up changes made on another device.
- A BillBuddy card is recognised by its last 4 digits: if a card in Accounts has the same last 4, the bill goes onto that card under the name you gave it, even after you removed its bill. A second copy an older sync made of that card is folded back in.
- BillBuddy's link and key are saved in your account too, so every signed-in device syncs with it.
- A device stays signed in: Supabase keeps the sign-in on the device and renews it automatically, so the planner opens straight away. The email address is also remembered to fill in the sign-in form.
- An open planner reloads itself when a newer version is published (checked when you come back to it and every 5 minutes). The database also rejects saves from an older copy, so it can't put back outdated data. If you set up Supabase before this rule existed, run `supabase/schema.sql` again.
- Signing out clears the planner from the screen and forgets the sign-in on that device.
- Data an earlier version kept in this browser moves to the account on its first sign-in (if the account is empty) and is then deleted from the browser.
