const SUPABASE_AUTH_COOKIE =
  /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/i;

export function isSupabaseAuthCookieName(name: string): boolean {
  return SUPABASE_AUTH_COOKIE.test(name);
}
