import { useEffect, useRef, useState } from 'react';
import type { EpisodeStatus } from '@shared/types';
import { PencilIcon, SendIcon } from './icons';
import { Message, Typing } from './Message';
import { useThread } from '../hooks/useThread';
import { track } from '../lib/analytics';

const countWords = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

interface ChatAreaProps {
  episodeId: string | null;
  title: string;
  status?: EpisodeStatus;
  onPasteInstead?: () => void;
}

function Processing() {
  return (
    <div className="flex flex-col items-start gap-3 text-[15px] leading-[1.65] text-[#E3E6EB]">
      <div className="flex items-center gap-3">
        <span className="inline-flex gap-1">
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright [animation-delay:.2s]" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright [animation-delay:.4s]" />
        </span>
        <span className="font-semibold">Processing this episode…</span>
      </div>
      <p className="text-muted">
        Fetching the transcript, detecting timestamps, and indexing it for retrieval. The summary,
        books, and people will appear as soon as it&apos;s ready.
      </p>
    </div>
  );
}

function Failed({ onPasteInstead }: { onPasteInstead?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 text-[15px] leading-[1.65] text-[#E3E6EB]">
      <div className="flex items-center gap-[10px]">
        <span className="h-[8px] w-[8px] rounded-full bg-danger" />
        <span className="font-semibold text-danger">Couldn&apos;t process this episode</span>
      </div>
      <p className="text-muted">
        We couldn&apos;t fetch a transcript for this video — it may have captions disabled or be
        unavailable. You can paste the transcript in manually instead.
      </p>
      {onPasteInstead && (
        <button
          onClick={onPasteInstead}
          className="mt-1 rounded-[11px] bg-blue px-4 py-2 text-[13.5px] font-semibold text-white shadow-send transition hover:bg-[#1a74ff]"
        >
          Paste transcript instead
        </button>
      )}
    </div>
  );
}

export function ChatArea({ episodeId, title, status = 'ready', onPasteInstead }: ChatAreaProps) {
  const [focus, setFocus] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const reportedRef = useRef<string | null>(null);
  const { messages, typing, error, send } = useThread(episodeId, status);

  const ready = status === 'ready' && !!episodeId;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  // Fire summary_viewed / session_resumed once per episode open (§15).
  useEffect(() => {
    if (!episodeId || messages.length === 0 || reportedRef.current === episodeId) return;
    reportedRef.current = episodeId;
    const summary = messages.find((m) => m.source === 'summary');
    if (summary) {
      track('summary_viewed', { episode_id: episodeId, word_count: countWords(summary.content) });
    }
    const history = messages.filter((m) => m.source !== 'summary').length;
    if (history > 0) {
      track('session_resumed', { episode_id: episodeId, messages_in_history: history });
    }
  }, [episodeId, messages.length]);

  const submit = () => {
    const text = input.trim();
    if (!text || !ready || typing) return;
    void send(text);
    setInput('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <main className="relative flex h-screen flex-1 flex-col overflow-hidden bg-bg">
      <div
        className="pointer-events-none absolute -right-[120px] -top-[160px] h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle,rgba(0,102,255,.10),transparent 65%)' }}
      />

      <div className="relative z-[2] flex items-center gap-[10px] px-8 py-5">
        <span className="font-display text-[19px] font-bold tracking-[-.01em]">{title}</span>
        <button className="inline-flex opacity-70 transition hover:opacity-100" title="Rename episode">
          <PencilIcon s={15} />
        </button>
      </div>
      <div className="relative z-[2] h-px bg-border" />

      <div className="relative z-[2] flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="mx-auto flex max-w-[840px] flex-col gap-[22px] px-8 pb-6 pt-7">
          {status === 'processing' ? (
            <Processing />
          ) : status === 'failed' ? (
            <Failed onPasteInstead={onPasteInstead} />
          ) : (
            <>
              {messages.map((m) => (
                <Message key={m.id} m={m} />
              ))}
              {typing && <Typing />}
              {error && <p className="text-[13px] text-danger">{error}</p>}
            </>
          )}
        </div>
      </div>

      <div className="relative z-[2] px-8 pb-[22px] pt-[14px]">
        <div
          className={`mx-auto flex max-w-[840px] items-end gap-[10px] rounded-bubble border bg-card px-[18px] py-[10px] transition ${
            focus
              ? 'border-[rgba(0,102,255,.6)] shadow-[0_0_0_4px_rgba(0,102,255,.1),0_0_30px_-6px_rgba(0,102,255,.35)]'
              : 'border-border'
          }`}
        >
          <textarea
            rows={1}
            disabled={!ready}
            placeholder={ready ? 'Ask anything about this episode...' : 'Available once the episode is ready…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            className="max-h-[140px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-relaxed text-text placeholder:text-muted-2 disabled:cursor-not-allowed"
          />
          <button
            onClick={submit}
            disabled={!ready || !input.trim() || typing}
            className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl bg-blue text-white shadow-send transition hover:bg-[#1a74ff] disabled:cursor-not-allowed disabled:bg-[#222] disabled:text-[#555] disabled:shadow-none"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </main>
  );
}
