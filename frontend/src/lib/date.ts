// Relative date for the sidebar episode list ("3 days ago", "1 week ago", "Apr 28").
export function relativeDate(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk} week${wk === 1 ? '' : 's'} ago`;

  // older — show an absolute short date
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
