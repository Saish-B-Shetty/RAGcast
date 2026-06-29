import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Logo } from './Logo';
import { PlusIcon, PencilIcon, TrashIcon, ChevronIcon, LogoutIcon } from './icons';
import { relativeDate } from '../lib/date';
import type { EpisodeListItem } from '../lib/episodes';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

interface EpisodeRowProps {
  ep: EpisodeListItem;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function EpisodeRow({ ep, active, onSelect, onRename, onDelete }: EpisodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ep.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(ep.name);
    setEditing(true);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${ep.name}"? This permanently removes its transcript, chat, and extracted books & people.`)) {
      onDelete();
    }
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== ep.name) onRename(next);
    else setDraft(ep.name);
  };

  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-[11px] border-l-2 py-[11px] pl-[15px] pr-[13px] transition-colors ${
        active
          ? 'border-blue bg-[#161b22] shadow-[inset_0_0_0_1px_rgba(0,102,255,.12)]'
          : 'border-transparent hover:bg-[#171717]'
      }`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setDraft(ep.name);
              setEditing(false);
            }
          }}
          className="w-full rounded-md border border-blue bg-[#0E0E0E] px-2 py-1 text-[13.5px] font-semibold text-text outline-none"
        />
      ) : (
        <>
          <div
            className={`truncate pr-[44px] text-[13.5px] font-semibold leading-[1.35] ${
              active ? 'text-white' : 'text-text'
            }`}
          >
            {ep.name}
          </div>
          <div className="mt-[3px] flex items-center gap-[6px] text-[11.5px] text-muted-2">
            {ep.status === 'processing' ? (
              <>
                <span className="h-[6px] w-[6px] animate-blink rounded-full bg-blue-bright" />
                <span className="text-blue-bright">Processing…</span>
              </>
            ) : ep.status === 'failed' ? (
              <>
                <span className="h-[6px] w-[6px] rounded-full bg-danger" />
                <span className="text-danger">Failed</span>
              </>
            ) : (
              relativeDate(ep.updated_at)
            )}
          </div>
          <div className="absolute right-[9px] top-[11px] flex items-center gap-[2px] opacity-0 transition group-hover:opacity-100">
            <button
              onClick={startEdit}
              title="Rename"
              className="flex h-6 w-6 items-center justify-center rounded-[7px] text-muted transition hover:bg-[#222] hover:text-white"
            >
              <PencilIcon s={13} />
            </button>
            <button
              onClick={handleDelete}
              title="Delete"
              className="flex h-6 w-6 items-center justify-center rounded-[7px] text-muted transition hover:bg-[rgba(255,90,90,.14)] hover:text-danger"
            >
              <TrashIcon s={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface SidebarProps {
  user: User | null;
  newOpen: boolean;
  onNew: () => void;
  onLogout: () => void;
  episodes: EpisodeListItem[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({
  user,
  newOpen,
  onNew,
  onLogout,
  episodes,
  loading,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const fullName =
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    user?.email?.split('@')[0] ||
    'Account';
  const email = user?.email ?? '';

  return (
    <aside className="relative flex h-screen w-[280px] min-w-[280px] flex-col border-r border-border bg-panel">
      <div className="px-5 pb-[14px] pt-[22px]">
        <Logo size={21} />
      </div>

      <button
        onClick={onNew}
        className={`mx-3 mb-0.5 mt-1 flex items-center gap-[11px] rounded-[11px] px-[13px] py-[10px] text-[13.5px] font-semibold transition-colors ${
          newOpen
            ? 'bg-[#161b22] text-blue-bright shadow-[inset_0_0_0_1px_rgba(0,102,255,.18)]'
            : 'text-text hover:bg-[#171717]'
        }`}
      >
        <span className={`inline-flex ${newOpen ? 'text-blue-bright' : 'text-muted'}`}>
          <PlusIcon />
        </span>
        New Episode
        <span className="ml-auto rounded-md border border-border bg-[#141414] px-[7px] py-px font-mono text-[11.5px] leading-normal text-muted-2">
          ⌘N
        </span>
      </button>

      <div className="px-[22px] pb-[9px] pt-5 text-[11px] font-bold uppercase tracking-[.12em] text-muted-2">
        Recent Episodes
      </div>

      <div className="flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 pb-4">
        {loading ? (
          <div className="px-[15px] py-3 text-[12.5px] text-muted-2">Loading…</div>
        ) : episodes.length === 0 ? (
          <div className="px-[15px] py-3 text-[12.5px] leading-relaxed text-muted-2">
            No episodes yet. Click <span className="text-muted">New Episode</span> to start.
          </div>
        ) : (
          episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              ep={ep}
              active={ep.id === activeId && !newOpen}
              onSelect={() => onSelect(ep.id)}
              onRename={(name) => onRename(ep.id, name)}
              onDelete={() => onDelete(ep.id)}
            />
          ))
        )}
      </div>

      <div className="relative">
        {menuOpen && <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />}
        {menuOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-3 right-3 z-30 animate-rise-menu rounded-[13px] border border-border bg-[#161616] p-1.5 shadow-menu">
            <button
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-[11px] rounded-[9px] px-3 py-[11px] text-left text-[13.5px] font-semibold text-danger transition-colors hover:bg-[rgba(255,90,90,.12)]"
            >
              <LogoutIcon s={16} /> Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex w-full items-center gap-[11px] border-t border-border px-4 py-[14px] text-left transition-colors hover:bg-[#161616]"
        >
          <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border border-border bg-[#222] text-[13px] font-bold text-text">
            {initials(fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{fullName}</div>
            <div className="truncate text-[11.5px] text-muted-2">{email}</div>
          </div>
          <span
            className={`inline-flex text-muted-2 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
          >
            <ChevronIcon s={16} />
          </span>
        </button>
      </div>
    </aside>
  );
}
