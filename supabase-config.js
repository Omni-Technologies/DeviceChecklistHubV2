// supabase-config.js
const SUPABASE_URL = "https://jgvrhrsclmtcsxlxkxcu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpndnJocnNjbG10Y3N4bHhreGN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MTE5MzUsImV4cCI6MjA3OTE4NzkzNX0.DxpapaE1eZAa4atq5TSJiAa3SlB8s8fSbcMdrjj-WuI";

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Test connection
window.testSupabase = async function () {
  const { data, error } = await supabaseClient.from("companies").select("*").limit(1);
  if (error) {
    console.error(error);
    alert("❌ Supabase connection failed");
  } else {
    console.log(data);
    alert("✅ Supabase connected!");
  }
};
