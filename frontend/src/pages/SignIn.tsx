import { useState } from 'react';
import { Logo } from '../components/Logo';
import { GoogleIcon } from '../components/icons';
import { signInWithGoogle } from '../hooks/useAuth';
import { isSupabaseConfigured } from '../lib/supabase';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser redirects to Google; no further action needed.
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-bg">
      {/* dotted grid, radially masked toward center */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px)',
          backgroundSize: '48px 48px',
          WebkitMaskImage: 'radial-gradient(circle at 50% 42%, black 0%, transparent 70%)',
          maskImage: 'radial-gradient(circle at 50% 42%, black 0%, transparent 70%)',
        }}
      />
      {/* large radial blue glow behind the card */}
      <div
        className="pointer-events-none absolute left-1/2 top-[42%] h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[20px]"
        style={{
          background:
            'radial-gradient(circle, rgba(0,102,255,.22) 0%, rgba(0,102,255,.07) 38%, transparent 66%)',
        }}
      />

      {/* card */}
      <div
        className="relative z-[2] w-[440px] max-w-[calc(100vw-48px)] rounded-signin border border-border px-11 pb-9 pt-12 shadow-signin animate-rise"
        style={{ background: 'linear-gradient(180deg,#131313 0%,#0E0E0E 100%)' }}
      >
        <div className="flex w-full justify-center">
          <Logo size={30} />
        </div>
        <p className="mt-3.5 text-center text-[15px] font-normal leading-relaxed text-muted">
          Ask anything from every podcast you&apos;ve heard.
        </p>

        <button
          onClick={handleContinue}
          disabled={busy}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-[14px] border border-blue bg-[#0F0F0F] px-5 py-[15px] text-[15.5px] font-semibold text-white transition duration-200 hover:-translate-y-px hover:border-blue-bright hover:bg-[#121823] hover:shadow-[0_0_26px_-4px_rgba(0,102,255,.55)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <GoogleIcon s={19} />
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error && <p className="mt-3 text-center text-[12.5px] text-danger">{error}</p>}

        <p className="mt-[22px] text-center text-[12px] leading-relaxed text-muted-2">
          By continuing you agree to our{' '}
          <a href="#" className="border-b border-[#333] text-muted no-underline">
            Terms
          </a>{' '}
          and{' '}
          <a href="#" className="border-b border-[#333] text-muted no-underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>

      <div className="absolute bottom-[26px] left-0 right-0 z-[2] text-center text-[12px] text-muted-2">
        RAGcast · retrieval-augmented listening
      </div>
    </div>
  );
}
