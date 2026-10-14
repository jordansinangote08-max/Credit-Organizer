// Supabase connection for cloud saving.
// Find both in Supabase: Project Settings → API (Project URL, and the "anon" / publishable key).
// The anon key is public by design: it ships in this file, which is public on GitHub Pages. It can only
// read and write through the table's Row Level Security, which keeps each person's data private.
// To rotate it: create a new anon key in Supabase → Project Settings → API, paste it below, then
// delete the old key there. The app needs no other change.
window.PLANNER_CONFIG={
  supabaseUrl:'https://zcxjqtbextuqqvxvsjsk.supabase.co',
  supabaseAnonKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGpxdGJleHR1cXF2eHZzanNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1ODE0MzQsImV4cCI6MjEwNzE1NzQzNH0.BWs7sU_h8fZSgObMt8i3sjJkmjenatVVCc8eCKXxyB0'
};

// Single version constant: bump together with ?v= in index.html, version.json, and sw.js.
window.APP_VERSION=45;
