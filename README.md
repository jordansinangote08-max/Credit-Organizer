# Paycheck and Debt Planner

A minimalist, mobile-first planner for each pay cycle: salary, bills, installments, credit cards, other money, borrowing options and BillBuddy sync.

Plain static files, no build step. Open `index.html` or serve the folder (e.g. `python3 -m http.server`) and deploy to any static host.

- `index.html` – markup
- `styles.css` – layout for phones, tablets and desktop (two columns from 1024px), light/dark, iOS-style frosted glass (solid cards when the device asks for less transparency); uses the device's own font, so nothing is downloaded
- `app.js` – planner logic
- `config.js` – Supabase connection (optional)
- `supabase/schema.sql` – the table and access rules for cloud saving
- `vendor/` – the Supabase client library (v2.116.0) and the Anthropic SDK (v0.133.0, bundled for the browser and loaded only when the AI tab asks a question), served locally
- `manifest.webmanifest`, `icon*.{svg,png}` – install to home screen

## Payday

Under the salary, **Payday** sets your pay schedule: once a month on one day, twice a month on two days (like the 15th and 30th), or every week on a weekday. A pay cycle runs from one payday to the day before the next, and each bill, installment and card counts in the cycle its due date falls in. Paid once a month, the planner switches to the upcoming cycle in the last 16 days before payday so you can plan it; paid more often, it shows the cycle you're in. The Plan tab shows one row per pay cycle. Each schedule remembers its own days, so switching back and forth keeps them.

## Bills and categories

**Add bill**, or the pencil on a bill, opens a small window with its form. Edits save as you type; a new bill is kept only when you tap **Add** (closing the window any other way leaves it out). Adding or editing an installment opens the same window from the Installments tab. Adding or editing a card, and adding other money or a creditor, open the same kind of window. Due days and statement days are picked on a calendar: the field shows the next date, and the day you pick repeats every month.

Each category's bills sit together on a background of that category's color. **Categories** (on the Bills tab) opens a small window: add a category, or pick one to rename it, change its color, choose what it counts as (bills you must pay, essentials, installments, credit cards, or can be cut) or delete it. A category that still has bills asks where to move them. To move a bill, tap Edit on it and pick its category.

## Repeating and one-time bills

A bill repeats every month on its due day. In its form, **Stops after** sets the last month it's due; leave it empty and it never stops. Untick **Repeats every month** for a one-time bill, which takes an exact due date and only counts in the pay cycle that date falls in. One-time bills in a later cycle are listed under *Coming in a later cycle*; bills that have stopped, or one-time bills whose date has passed, are kept under *Ended* until you remove them. Installments and credit cards don't have these options: installments end by payments left, and card amounts come from each statement.

## AI: should I take this loan?

The **AI** tab checks a loan before you take it: the amount, installments or a one-time payment, the interest, and when it's due. The planner first does the maths itself: it lays the loan's payments over your coming pay cycles next to every bill, installment, card and income you've entered, and works out the most you can borrow on those terms while every cycle keeps your buffer. That part is exact, free and needs no key.

With an AI key in the **API** tab, the AI then reads a short summary of those numbers (about 2,000 characters: amounts, bill names, the cycle table; never card digits or your email) and explains the call in plain words, with tips. It's told to use the planner's numbers rather than redo them, and it answers in a fixed JSON format, so a question costs very little. Asking the same question again doesn't call the API. Pick the provider in the API tab; each keeps its own key and model:

- **Claude (Anthropic)**: through the Anthropic SDK, at low effort, with server-side fallback on Opus and Sonnet. About $0.02 a question on Claude Opus 5.5 (the default), $0.01 on Sonnet 5.5, well under a cent on Haiku 5.5.
- **ChatGPT (OpenAI)**: OpenAI's chat completions with a strict JSON schema; type any model your key can use (starts at `gpt-5-mini`). The answer shows the tokens used.
- **Other (OpenAI-compatible)**: any service that speaks OpenAI's chat format at its own address (for example OpenRouter or a local server), in plain JSON mode. It has to allow requests from a browser.

Keys are saved in your account and used straight from the device, so give each a monthly spend limit with its provider.

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
