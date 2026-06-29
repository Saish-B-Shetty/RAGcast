import { useState } from 'react';
import { createEpisode } from '../lib/api';
import { track } from '../lib/analytics';

interface NewEpisodeProps {
  // Called with the new episode id after creation succeeds.
  onCreated: (episodeId: string) => void;
}

export default function NewEpisode({ onCreated }: NewEpisodeProps) {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [epName, setEpName] = useState('');
  const [busy, setBusy] = useState<'youtube' | 'manual' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (kind: 'youtube' | 'manual') => {
    setError(null);
    setBusy(kind);
    try {
      const ep =
        kind === 'youtube'
          ? await createEpisode({ source_type: 'youtube_url', source_url: url.trim() })
          : await createEpisode({
              source_type: 'manual_paste',
              transcript: transcript.trim(),
              name: epName.trim() || undefined,
            });
      track('episode_created', {
        source: kind === 'youtube' ? 'youtube_url' : 'manual_paste',
        episode_id: ep.id,
      });
      onCreated(ep.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create episode.');
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'w-full rounded-[12px] border border-border bg-[#0E0E0E] px-[15px] py-[13px] text-[14px] text-text transition placeholder:text-[#4f545c] focus:border-[rgba(0,102,255,.6)] focus:shadow-[0_0_0_3px_rgba(0,102,255,.12)]';

  return (
    <main className="relative flex h-screen flex-1 flex-col overflow-hidden bg-bg">
      <div
        className="pointer-events-none absolute -right-[120px] -top-[160px] h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle,rgba(0,102,255,.10),transparent 65%)' }}
      />
      <div className="relative z-[2] flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-8 pb-10 pt-[46px]">
          <h1 className="mb-2 font-display text-[30px] font-bold tracking-[-.02em]">
            Start a New Episode
          </h1>
          <p className="mb-[34px] text-[15px] text-muted">
            Drop in a link or a transcript — RAGcast does the rest.
          </p>

          <div className="relative flex items-stretch gap-0">
            {/* Card 1 — YouTube URL */}
            <div className="flex flex-1 flex-col rounded-[18px] border border-border bg-card p-[26px] transition hover:border-[#2a2a2a] hover:shadow-[0_0_40px_-16px_rgba(0,102,255,.4)]">
              <div className="mb-1 flex items-center gap-[11px] text-[16px] font-extrabold">
                Paste YouTube URL
              </div>
              <p className="mb-[18px] text-[12.5px] text-muted-2">
                We&apos;ll fetch and clean the transcript automatically.
              </p>
              <label className="mb-2 block text-[12px] font-semibold text-muted">Video link</label>
              <input
                className={inputCls}
                placeholder="https://youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                onClick={() => submit('youtube')}
                disabled={busy !== null || !url.trim()}
                className="mt-4 w-full rounded-[12px] bg-blue py-[13px] text-[14.5px] font-bold text-white shadow-[0_8px_22px_-8px_rgba(0,102,255,.6)] transition hover:-translate-y-px hover:bg-[#1a74ff] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {busy === 'youtube' ? 'Creating…' : 'Fetch Transcript'}
              </button>
            </div>

            {/* "or" divider */}
            <div className="flex w-16 flex-col items-center justify-center self-stretch text-muted-2">
              <div className="w-px flex-1 bg-border" />
              <div className="py-[10px] text-[12px] font-bold tracking-[.05em]">or</div>
              <div className="w-px flex-1 bg-border" />
            </div>

            {/* Card 2 — Paste transcript */}
            <div className="flex flex-1 flex-col rounded-[18px] border border-border bg-card p-[26px] transition hover:border-[#2a2a2a] hover:shadow-[0_0_40px_-16px_rgba(0,102,255,.4)]">
              <div className="mb-1 flex items-center gap-[11px] text-[16px] font-extrabold">
                Paste Transcript
              </div>
              <p className="mb-[18px] text-[12.5px] text-muted-2">
                Already have the text? Paste it in directly.
              </p>
              <label className="mb-2 block text-[12px] font-semibold text-muted">Transcript</label>
              <textarea
                className={`${inputCls} resize-none leading-[1.55]`}
                rows={4}
                placeholder="Paste your transcript here..."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              <div className="h-[9px]" />
              <label className="mb-2 block text-[12px] font-semibold text-muted">Episode name</label>
              <input
                className={inputCls}
                placeholder="e.g. The Knowledge Project — Annie Duke"
                value={epName}
                onChange={(e) => setEpName(e.target.value)}
              />
              <button
                onClick={() => submit('manual')}
                disabled={busy !== null || !transcript.trim()}
                className="mt-4 w-full rounded-[12px] border border-border bg-[#161616] py-[13px] text-[14.5px] font-bold text-text transition hover:border-blue hover:bg-[#10182a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'manual' ? 'Saving…' : 'Save Episode'}
              </button>
            </div>
          </div>

          {error && <p className="mt-5 text-center text-[13px] text-danger">{error}</p>}

          <p className="mx-0.5 mt-[26px] text-center text-[13px] italic text-muted-2">
            RAGcast will automatically extract books, people and timestamps from your transcript.
          </p>
        </div>
      </div>
    </main>
  );
}
