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

## Installments by lender

Each installment shows its payment the way BillBuddy does: **3/12** means this bill is your 3rd payment of 12 (after you mark it paid, the one you just paid). A card in Accounts lists the installments inside its statement the same way, with what they come to, the rest of the bill and the statement total. The Installments tab groups installments by lender: each lender is a card showing its total per month, what's left to pay and when it's all done, with each installment inside as Installment 1, 2… showing payments left (like 4/6), the amount still to go and the month it ends. The lender is the **Lender** field in the installment's form (it suggests the lenders you already have); left empty, it's the name without a trailing letter or number, so "UnionBank Loan A" and "UnionBank Loan B" both sit under UnionBank Loan. Loans that BillBuddy adds are filed under their bank.

## Repeating and one-time bills

A bill repeats every month on its due day. In its form, **Stops after** sets the last month it's due; leave it empty and it never stops. Untick **Repeats every month** for a one-time bill, which takes an exact due date and only counts in the pay cycle that date falls in. One-time bills in a later cycle are listed under *Coming in a later cycle*; bills that have stopped, or one-time bills whose date has passed, are kept under *Ended* until you remove them. Installments and credit cards don't have these options: installments end by payments left, and card amounts come from each statement.

## Every tab is monitored

The top of each tab (This cycle, Bills, Installments, Accounts, Income, Borrow, Plan) lists what needs attention: money running out, bills past due or due soon, cards over 30% or 50% of their limit, missing last 4 digits, installments without payments left, expensive debt, entries from past cycles. The planner works these out itself as you go, free and instantly. With an AI key set, the ✨ button asks the AI to review that tab: it gets the tab's checks plus a snapshot of the whole planner, so its advice rests on the same numbers. A review is kept for the day until the numbers change, so looking again costs nothing.

**Daily AI limit.** Every AI use is counted in the API tab, by purpose (loan checks, tab reviews, sorting bills, placing installments), with the last week's totals. In the API tab, set how many tokens the AI may use per day (about 2,000 a question; empty means no limit). The meter shows today's use. When the limit is reached the AI stops until the next day. Loan checks come first: tab reviews pause at 70% of the limit, so there's always room to check a loan.

## AI: should I take this loan?

The **AI** tab checks a loan before you take it. Pick a creditor from the Borrow tab to fill in its interest, rate type, months and upfront fee (the check then shows what you receive after the fee, and warns if you ask for more than that creditor offers), or type your own terms: the amount, installments or a one-time payment, the interest, and when it's due. The planner first does the maths itself: it lays the loan's payments over your coming pay cycles next to every bill, installment, card and income you've entered, and works out the most you can borrow on those terms while every cycle keeps your buffer. That part is exact, free and needs no key.

With an AI key in the **API** tab, the AI then reads a short summary of those numbers (about 2,000 characters: amounts, bill names, the cycle table; never card digits or your email) and explains the call in plain words, with tips. It's told to use the planner's numbers rather than redo them, and it answers in a fixed JSON format, so a question costs very little. Asking the same question again doesn't call the API. Pick the provider in the API tab; each keeps its own key and model:

- **Claude (Anthropic)**: through the Anthropic SDK, at low effort, with server-side fallback on Opus and Sonnet. Well under a cent a question on Haiku 5.5 (the default), about $0.01 on Sonnet 5.5, $0.02 on Opus 5.5.
- **ChatGPT (OpenAI)**: OpenAI's chat completions with a strict JSON schema; type any model your key can use (starts at `gpt-5-mini`). The answer shows the tokens used.
- **Other (OpenAI-compatible)**: any service that speaks OpenAI's chat format at its own address (for example OpenRouter or a local server), in plain JSON mode. It has to allow requests from a browser.

Keys are saved in your account and used straight from the device, so give each a monthly spend limit with its provider.

## Draft: a testing room

**Draft** (next to your email at the top) opens a copy of the whole planner: every tab, bill, installment, card and setting, with the AI working as usual. Try anything there (a new bill, a different salary, marking things paid, a loan check). Nothing in a draft is saved, and changes from your other devices aren't pulled in while you're in it. BillBuddy keeps syncing, so new bills appear in the draft too. The same button then reads **Close draft**: it brings back your planner exactly as it was; closing the tab does the same. AI used in a draft is real, so it still counts toward the daily AI limit.

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
- BillBuddy sends everything its dashboard shows, the installment plans behind each statement included. A card fills in its credit limit and statement day when they're empty; the installment plans its statement lists ("SHOPEE 04/12") become installments under the card in the Installments tab, with payments left and the end month, and are kept out of the cycle maths because the card's amount already includes them (a plan the next statement no longer lists after its last payment is removed). A loan's breakdown sets its payments left and total. Needs BillBuddy with the installments column (see its scanner/README.md). The API tab's BillBuddy line says how many installments came with the bills, or that BillBuddy sent none (its `/api/bills` needs updating). A card plan whose number of months the statement cut off still shows, by its payment number.
- Each installment goes to the right loan or card. A plan on a card statement is filed under that card; if it's an installment you entered yourself (same purchase), that one moves under the card instead of being added twice. A loan statement that lists several loans (like UnionBank's two personal loans, 3/12 and 6/12, on one bill) stays one bill in Bills and This cycle, and each loan is its own installment under it in the Installments tab, with its own payments left and end month; the Plan tab counts each one until it ends. If you entered those loans yourself, yours become its installments instead of copies. Marking the bill paid pays its installments. The planner decides this itself when it's clear: nothing of yours looks like the plan (it's new), or exactly one of yours has the same amount to the centavo (it's that one). Only when it's unclear (a similar name or a close amount) does the AI decide, if one is set up: those plans only, all in one small request, each once, within the daily limit. Without AI, an unclear plan is added as new.
- A bill BillBuddy couldn't type ("other") is sorted for free when the name says what it is (Meralco, Globe, PLDT, SSS, Netflix, Spotify, rent, Home Credit and other common billers); only names the planner doesn't know go to the AI, if one is set up: all in one small request, each once, within the daily limit.
- Sorting bills and placing installments always use the provider's lightest model (Claude Haiku 5.5, or gpt-5-nano with ChatGPT, falling back to your model if the key can't use it), whatever model the API tab picks for loan checks. Switch both off in the API tab.
- A BillBuddy card is recognised by its last 4 digits: if a card in Accounts has the same last 4, the bill goes onto that card under the name you gave it, even after you removed its bill. A second copy an older sync made of that card is folded back in.
- BillBuddy's link and key are saved in your account too, so every signed-in device syncs with it.
- A device stays signed in: Supabase keeps the sign-in on the device and renews it automatically, so the planner opens straight away. The email address is also remembered to fill in the sign-in form.
- An open planner reloads itself when a newer version is published (checked when you come back to it and every 5 minutes). The database also rejects saves from an older copy, so it can't put back outdated data. If you set up Supabase before this rule existed, run `supabase/schema.sql` again.
- Signing out clears the planner from the screen and forgets the sign-in on that device.
- Data an earlier version kept in this browser moves to the account on its first sign-in (if the account is empty) and is then deleted from the browser.
