import { useEffect, useState, type ReactNode } from 'react';
import type { Book, Person } from '@shared/types';
import { ChevronIcon, ExtIcon } from './icons';
import { track } from '../lib/analytics';

const COVER_STRIPES = 'repeating-linear-gradient(135deg,#202020 0 9px,#1b1b1b 9px 18px)';
const AVATAR_STRIPES = 'repeating-linear-gradient(135deg,#242424 0 7px,#1e1e1e 7px 14px)';

function Collapsible({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2 [&+&]:mt-[26px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 whitespace-nowrap text-left font-display text-[13px] font-bold tracking-[.01em] text-text transition-colors hover:text-white"
      >
        <span className={`inline-flex text-muted-2 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          <ChevronIcon s={15} />
        </span>
        {label}
        <span className="ml-auto rounded-full border border-border bg-[#1b1b1b] px-[9px] py-0.5 text-[11px] font-bold text-muted-2">
          {count}
        </span>
      </button>
      <div className={`cp-collapse ${open ? '' : 'closed'}`}>
        <div className="cp-collapse-inner">
          <div className="flex flex-col gap-[11px] pt-[13px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-border bg-[#131313] px-[14px] py-[14px] text-[12.5px] leading-relaxed text-muted-2">
      {text}
    </div>
  );
}

function BookRow({ book }: { book: Book }) {
  const href =
    book.amazon_url ??
    `https://www.amazon.in/s?k=${encodeURIComponent(`${book.title} ${book.author ?? ''}`.trim())}`;
  const onClick = () => {
    track('book_card_clicked', { book_title: book.title, episode_id: book.episode_id });
    track('amazon_link_clicked', { book_title: book.title, episode_id: book.episode_id });
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title={book.description ?? undefined}
      className="group relative flex gap-[13px] rounded-[13px] border border-border bg-card p-[13px] no-underline transition hover:border-[rgba(255,153,0,.45)] hover:shadow-[0_8px_22px_-14px_rgba(255,153,0,.4)]"
    >
      <div
        className="flex h-[66px] w-[48px] min-w-[48px] items-center justify-center overflow-hidden rounded-[7px]"
        style={{ background: COVER_STRIPES }}
      >
        {book.cover_url ? (
          <img src={book.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-mono text-[7px] text-[#4d4d4d]">cover</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h4 className="m-0 mb-0.5 text-[13.5px] font-bold leading-[1.25] text-text">{book.title}</h4>
        {book.author && <p className="m-0 mb-[5px] text-[11.5px] text-muted">{book.author}</p>}
        {book.mentioned_at && (
          <p className="m-0 text-[11px] font-semibold text-blue-bright">Mentioned at {book.mentioned_at}</p>
        )}
      </div>
      <span className="absolute right-[11px] top-[11px] text-muted-2 opacity-0 transition group-hover:text-amazon group-hover:opacity-100">
        <ExtIcon s={14} />
      </span>
    </a>
  );
}

function PersonRow({ person }: { person: Person }) {
  // P5: prefer the episode-specific context snippet (what was said here); fall
  // back to the web bio. Full bio is available on hover.
  const line = person.context_snippet ?? person.bio;
  useEffect(() => {
    track('people_card_viewed', { person_name: person.name, episode_id: person.episode_id });
    // fire once per mount (per panel render for this person)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      title={person.bio ?? undefined}
      className="flex items-center gap-[12px] rounded-[13px] border border-border bg-card px-[13px] py-[12px] transition hover:border-[#2c2c2c] hover:shadow-[0_8px_22px_-14px_rgba(0,102,255,.45)]"
    >
      <div
        className="flex h-[42px] w-[42px] min-w-[42px] items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_1px_#2a2a2a]"
        style={{ background: AVATAR_STRIPES }}
      >
        {person.photo_url ? (
          <img src={person.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-mono text-[7px] text-[#4d4d4d]">photo</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="m-0 mb-0.5 text-[13.5px] font-bold text-text">{person.name}</h4>
        {line && <p className="m-0 mb-1 text-[11px] leading-[1.35] text-muted line-clamp-2">{line}</p>}
        {person.mentioned_at && (
          <p className="m-0 text-[11px] font-semibold text-blue-bright">Mentioned at {person.mentioned_at}</p>
        )}
      </div>
    </div>
  );
}

interface ContextPanelProps {
  books?: Book[];
  people?: Person[];
  width: number;
  setWidth: (w: number) => void;
}

export function ContextPanel({ books = [], people = [], width, setWidth }: ContextPanelProps) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => setWidth(startW + (startX - ev.clientX));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <aside
      className="relative flex h-screen flex-col border-l border-border bg-panel"
      style={{ width, minWidth: width }}
    >
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        className="group absolute -left-1 top-0 bottom-0 z-[8] flex w-[9px] cursor-col-resize items-center justify-center"
      >
        <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-[rgba(0,102,255,.55)] group-active:bg-blue" />
      </div>

      <div className="border-b border-border px-[22px] pb-[15px] pt-[21px]">
        <div className="font-display text-[13px] font-bold tracking-[.02em]">In this episode</div>
        <div className="mt-[3px] text-[11.5px] text-muted-2">Auto-extracted from the transcript</div>
      </div>

      <div className="flex-1 overflow-y-auto px-[18px] pb-[26px] pt-[18px]">
        <Collapsible label="Books Mentioned" count={books.length}>
          {books.length ? (
            books.map((b) => <BookRow key={b.id} book={b} />)
          ) : (
            <EmptyState text="No books detected in this transcript yet." />
          )}
        </Collapsible>

        <Collapsible label="People Mentioned" count={people.length}>
          {people.length ? (
            people.map((p) => <PersonRow key={p.id} person={p} />)
          ) : (
            <EmptyState text="No people detected in this transcript yet." />
          )}
        </Collapsible>
      </div>
    </aside>
  );
}
