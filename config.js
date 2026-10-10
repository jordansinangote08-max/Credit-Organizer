// Supabase connection for cloud saving. Leave empty to keep data on this device only.
// Find both in Supabase: Project Settings → API (Project URL, and the "anon" / publishable key).
// The anon key is meant to be public; the table's Row Level Security keeps each person's data private.
window.PLANNER_CONFIG={
  supabaseUrl:'',
  supabaseAnonKey:''
};
