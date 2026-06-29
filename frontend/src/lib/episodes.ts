import { supabase } from './supabase';
import type { Episode } from '@shared/types';

// Sidebar "Recent Episodes". Supabase-direct, RLS-protected (CLAUDE.md §8) —
// RLS guarantees only the current user's rows are returned.
export type EpisodeListItem = Pick<
  Episode,
  'id' | 'name' | 'status' | 'created_at' | 'updated_at'
>;

export async function listEpisodes(): Promise<EpisodeListItem[]> {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, name, status, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Rename — Supabase-direct, RLS-protected (PATCH-equivalent per §8).
export async function renameEpisode(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('episodes').update({ name }).eq('id', id);
  if (error) throw error;
}

// Delete — Supabase-direct, RLS-protected (DELETE-equivalent per §8). The schema's
// ON DELETE CASCADE on child tables removes the transcript, chunks, messages,
// books, and people for this episode automatically.
export async function deleteEpisode(id: string): Promise<void> {
  const { error } = await supabase.from('episodes').delete().eq('id', id);
  if (error) throw error;
}
