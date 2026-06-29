import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Sidebar } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { ContextPanel } from '../components/ContextPanel';
import NewEpisode from './NewEpisode';
import { usePanelWidth } from '../hooks/usePanelWidth';
import { useEpisodes } from '../hooks/useEpisodes';
import { useContextData } from '../hooks/useContextData';
import { signOut } from '../hooks/useAuth';

export default function MainApp({ user }: { user: User | null }) {
  const [newOpen, setNewOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { width, setWidth } = usePanelWidth();
  const { episodes, loading, rename, remove, refresh } = useEpisodes();

  // Default the active episode to the most recent once the list loads.
  useEffect(() => {
    if (!activeId && episodes.length > 0) setActiveId(episodes[0].id);
  }, [episodes, activeId]);

  // ⌘N / Ctrl+N opens the New Episode screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeEpisode = episodes.find((e) => e.id === activeId) ?? null;
  const { books, people } = useContextData(newOpen ? null : activeEpisode?.id ?? null);

  return (
    <div className="flex h-screen w-screen">
      <Sidebar
        user={user}
        newOpen={newOpen}
        onNew={() => setNewOpen(true)}
        onLogout={() => {
          setNewOpen(false);
          signOut();
        }}
        episodes={episodes}
        loading={loading}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setNewOpen(false);
        }}
        onRename={rename}
        onDelete={(id) => {
          // If the active episode is being removed, clear the selection so the
          // default-to-most-recent effect re-picks once the list updates.
          if (id === activeId) setActiveId(null);
          void remove(id);
        }}
      />

      {newOpen ? (
        <NewEpisode
          onCreated={async (id) => {
            await refresh();
            setActiveId(id);
            setNewOpen(false);
          }}
        />
      ) : (
        <>
          <ChatArea
            episodeId={activeEpisode?.id ?? null}
            title={activeEpisode?.name ?? 'No episode selected'}
            status={activeEpisode?.status ?? 'ready'}
            onPasteInstead={() => setNewOpen(true)}
          />
          <ContextPanel books={books} people={people} width={width} setWidth={setWidth} />
        </>
      )}
    </div>
  );
}
