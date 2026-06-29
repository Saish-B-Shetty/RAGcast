import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend environment.');
}

// Server-side client — uses the SERVICE ROLE key, which BYPASSES RLS.
// NEVER expose this key or this client to the frontend. Because RLS is bypassed,
// every backend query MUST scope by user_id explicitly (CLAUDE.md §12).
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Verify a Supabase JWT from the Authorization header and return the user.
export async function getUserFromToken(accessToken: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}
