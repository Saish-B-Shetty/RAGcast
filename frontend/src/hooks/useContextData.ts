import { useEffect, useState } from 'react';
import type { Book, Person } from '@shared/types';
import { listBooks } from '../lib/books';
import { listPeople } from '../lib/people';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Books + people for the active episode. Loads on select and subscribes to
// Realtime so the panel fills in live as extraction completes during ingestion.
export function useContextData(episodeId: string | null) {
  const [books, setBooks] = useState<Book[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    setBooks([]);
    setPeople([]);
    if (!episodeId || !isSupabaseConfigured) return;

    let cancelled = false;
    const loadBooks = () =>
      listBooks(episodeId)
        .then((b) => !cancelled && setBooks(b))
        .catch(() => {});
    const loadPeople = () =>
      listPeople(episodeId)
        .then((p) => !cancelled && setPeople(p))
        .catch(() => {});

    void loadBooks();
    void loadPeople();

    // Extraction deletes-then-inserts rows, so just reload on any change.
    const channel = supabase
      .channel(`context-${episodeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books', filter: `episode_id=eq.${episodeId}` },
        () => void loadBooks(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'people', filter: `episode_id=eq.${episodeId}` },
        () => void loadPeople(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [episodeId]);

  return { books, people };
}
