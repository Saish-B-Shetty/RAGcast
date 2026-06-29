import { supabase } from './supabase';
import type { CreateEpisodeRequest, EpisodeStatus, Message } from '@shared/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7860';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

interface CreatedEpisode {
  id: string;
  name: string;
  status: EpisodeStatus;
  created_at: string;
  updated_at: string;
}

// Calls the backend (secret-key endpoint) with the user's Supabase JWT (§8).
export async function createEpisode(payload: CreateEpisodeRequest): Promise<CreatedEpisode> {
  const res = await fetch(`${API_BASE}/api/episodes`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message ?? `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return json.episode as CreatedEpisode;
}

// Ask a question → persisted assistant message (with source + timestamps).
export async function ask(episodeId: string, question: string): Promise<Message> {
  const res = await fetch(`${API_BASE}/api/episodes/${episodeId}/ask`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ question }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message ?? `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return json.message as Message;
}
