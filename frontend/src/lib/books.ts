import { supabase } from './supabase';
import type { Book } from '@shared/types';

// Books for the context panel — Supabase-direct, RLS-protected (CLAUDE.md §8).
export async function listBooks(episodeId: string): Promise<Book[]> {
  const { data, error } = await supabase
    .from('books')
    .select('id, episode_id, title, author, description, cover_url, amazon_url, mentioned_at')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Book[];
}
