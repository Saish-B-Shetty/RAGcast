import { useCallback, useEffect, useState } from 'react';
import type { EpisodeStatus, Message } from '@shared/types';
import { listMessages } from '../lib/messages';
import { ask } from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase';
import { track } from '../lib/analytics';

// Owns the chat thread for one episode: loads history, sends questions
// (optimistic user message + typing indicator), appends the assistant reply.
export function useThread(episodeId: string | null, status: EpisodeStatus) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load thread when the episode changes or once it becomes ready (the summary
  // message is inserted during ingestion).
  useEffect(() => {
    setMessages([]);
    setError(null);
    if (!episodeId || !isSupabaseConfigured || status === 'processing' || status === 'failed') {
      return;
    }
    let cancelled = false;
    listMessages(episodeId)
      .then((m) => {
        if (!cancelled) setMessages(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load messages.');
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId, status]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || !episodeId || typing) return;

      const optimistic: Message = {
        id: `tmp-${Date.now()}`,
        episode_id: episodeId,
        role: 'user',
        content: text,
        source: null,
        timestamps_cited: null,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setTyping(true);
      setError(null);

      try {
        const assistant = await ask(episodeId, text);
        setMessages((m) => [...m, assistant]);
        track('question_asked', { episode_id: episodeId, answer_source: assistant.source });
        // Web search was used for low-confidence (web) and stitched (hybrid) answers.
        if (assistant.source === 'web' || assistant.source === 'hybrid') {
          track('web_fallback_triggered', { episode_id: episodeId, query_text: text });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to get an answer.');
      } finally {
        setTyping(false);
      }
    },
    [episodeId, typing],
  );

  return { messages, typing, error, send };
}
