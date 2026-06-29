// Shared domain types used by both frontend and backend (CLAUDE.md §2, §5).
// Define Episode, Message, Book, Person once.

export type EpisodeSourceType = 'youtube_url' | 'manual_paste';
export type EpisodeStatus = 'processing' | 'ready' | 'failed';

export type MessageRole = 'user' | 'assistant';
export type MessageSource = 'transcript' | 'web' | 'hybrid' | 'summary';

export interface Episode {
  id: string;
  user_id: string;
  name: string;
  source_type: EpisodeSourceType;
  source_url: string | null;
  podcast_name: string | null;
  has_timestamps: boolean;
  status: EpisodeStatus;
  created_at: string;
  updated_at: string;
}

export interface Transcript {
  episode_id: string;
  content: string;
}

export interface Message {
  id: string;
  episode_id: string;
  role: MessageRole;
  content: string;
  source: MessageSource | null;
  timestamps_cited: TimestampCitation[] | null;
  created_at: string;
}

export interface TimestampCitation {
  label: string; // e.g. "38:12"
  seconds: number;
}

export interface Book {
  id: string;
  episode_id: string;
  title: string;
  author: string | null;
  description: string | null;
  cover_url: string | null;
  amazon_url: string | null;
  mentioned_at: string | null;
}

export interface Person {
  id: string;
  episode_id: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  context_snippet: string | null;
  mentioned_at: string | null;
}

// Standard API error shape (CLAUDE.md §8)
export interface ApiError {
  error: { code: string; message: string };
}

// Payload for POST /api/episodes
export interface CreateEpisodeRequest {
  source_type: EpisodeSourceType;
  source_url?: string;
  transcript?: string;
  name?: string;
}
