import { supabase } from './supabase';
import type { Person } from '@shared/types';

// People for the context panel — Supabase-direct, RLS-protected (CLAUDE.md §8).
export async function listPeople(episodeId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('people')
    .select('id, episode_id, name, bio, photo_url, context_snippet, mentioned_at')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Person[];
}
