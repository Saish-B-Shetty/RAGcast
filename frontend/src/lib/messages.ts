import { supabase } from './supabase';
import type { Message } from '@shared/types';

// Thread loading — Supabase-direct, RLS-protected (CLAUDE.md §8).
export async function listMessages(episodeId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, episode_id, role, content, source, timestamps_cited, created_at')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}
