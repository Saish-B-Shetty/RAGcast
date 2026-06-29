import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

// Tracks the Supabase auth session and keeps it in sync via onAuthStateChange.
// Used once at the app root to decide between Sign In and the Main App.
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      // SIGNED_IN/SIGNED_OUT fire on real auth changes, not session restore
      // ('INITIAL_SESSION') or token refresh — so they map cleanly to §15.
      if (event === 'SIGNED_IN') track('sign_in', { method: 'google' });
      else if (event === 'SIGNED_OUT') track('sign_out');
      setSession(newSession);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
