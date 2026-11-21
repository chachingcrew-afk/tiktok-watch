// Public by design: the publishable key only lets a signed-in owner call the tr_* functions
// (every function checks the owner's e-mail; the tables themselves are not exposed).
window.TR_CONFIG = {
  supabaseUrl: "https://sapxyvfiqyshwnwarctj.supabase.co",
  supabaseKey: "sb_publishable_A2y7JRVx02g5ptjl72pnMA_5OnqnkyJ",
  // Cloudflare R2 public bucket (termekradar-media): gallery images, video covers, Facebook ad creatives
  mediaUrl: "https://pub-118a4cc7721840ce9f18b2d83daf59af.r2.dev",
};
