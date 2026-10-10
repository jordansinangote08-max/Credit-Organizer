# Paycheck and Debt Planner

A minimalist, mobile-first planner for each pay cycle: salary, bills, installments, credit cards, other money, borrowing options and BillBuddy sync.

Plain static files, no build step. Open `index.html` or serve the folder (e.g. `python3 -m http.server`) and deploy to any static host.

- `index.html` – markup
- `styles.css` – layout for phones, tablets and desktop (two columns from 1024px), light/dark
- `app.js` – planner logic; data is saved in the browser (`localStorage`)
- `manifest.webmanifest`, `icon*.{svg,png}` – install to home screen
