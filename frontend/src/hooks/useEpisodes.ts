import { useCallback, useEffect, useState } from 'react';
import {
  listEpisodes,
  renameEpisode,
  deleteEpisode,
  type EpisodeListItem,
} from '../lib/episodes';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { track } from '../lib/analytics';

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const list = await listEpisodes();
      setEpisodes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load episodes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates: ingestion flips status processing → ready/failed (and may
  // auto-name from the oEmbed title). Realtime delivery respects RLS (§6A.6).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel('episodes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'episodes' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id;
            if (oldId) setEpisodes((list) => list.filter((e) => e.id !== oldId));
            return;
          }
          const row = payload.new as EpisodeListItem;
          setEpisodes((list) => {
            const exists = list.some((e) => e.id === row.id);
            const next = exists
              ? list.map((e) => (e.id === row.id ? { ...e, ...row } : e))
              : [row, ...list];
            return next.sort(
              (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
            );
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Optimistic rename, then persist.
  const rename = useCallback(async (id: string, name: string) => {
    setEpisodes((list) => list.map((e) => (e.id === id ? { ...e, name } : e)));
    await renameEpisode(id, name);
    track('episode_renamed', { episode_id: id });
  }, []);

  // Optimistic remove, then persist. (Realtime DELETE also prunes it, so this is
  // idempotent.) On failure, refresh to restore the true list.
  const remove = useCallback(
    async (id: string) => {
      setEpisodes((list) => list.filter((e) => e.id !== id));
      try {
        await deleteEpisode(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete episode');
        await refresh();
      }
    },
    [refresh],
  );

  return { episodes, loading, error, refresh, rename, remove };
}
