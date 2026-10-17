// LOCAL MODE works immediately with no backend.
// For public deployment with globally unique exams and centralized weak-area history,
// change mode to "supabase" and fill in the two public values below.
window.APP_CONFIG = {
  mode: "local", // "local" or "supabase"
  supabaseUrl: "",
  supabaseAnonKey: ""
};
