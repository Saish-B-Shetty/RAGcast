// Provider-agnostic analytics (CLAUDE.md §15). Fires the product's events and
// forwards them to whatever provider is present on window (Mixpanel / gtag).
// No vendor SDK is bundled — wiring a real provider is a one-line change here.

export type AnalyticsEvent =
  | 'sign_in'
  | 'sign_out'
  | 'episode_created'
  | 'summary_viewed'
  | 'question_asked'
  | 'web_fallback_triggered'
  | 'book_card_clicked'
  | 'amazon_link_clicked'
  | 'people_card_viewed'
  | 'episode_renamed'
  | 'session_resumed';

type Props = Record<string, unknown>;

interface ProviderWindow {
  mixpanel?: { track?: (event: string, props?: Props) => void };
  gtag?: (command: 'event', event: string, props?: Props) => void;
}

export function track(event: AnalyticsEvent, props: Props = {}): void {
  try {
    const w = window as unknown as ProviderWindow;
    if (w.mixpanel?.track) w.mixpanel.track(event, props);
    else if (typeof w.gtag === 'function') w.gtag('event', event, props);
    if (import.meta.env.DEV) console.debug('[analytics]', event, props);
  } catch {
    // never let instrumentation break the app
  }
}
