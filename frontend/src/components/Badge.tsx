import type { MessageSource } from '@shared/types';

// Source badges (CLAUDE.md §9). transcript=green, web=blue, hybrid=split, summary=purple.
const BASE =
  'inline-flex items-center gap-[5px] rounded-[7px] px-[9px] py-1 text-[10.5px] font-bold uppercase tracking-[.03em]';

export function Badge({ source }: { source: MessageSource }) {
  switch (source) {
    case 'web':
      return (
        <span
          className={`${BASE} text-[#5C9BFF]`}
          style={{ background: 'rgba(0,102,255,.13)', boxShadow: 'inset 0 0 0 1px rgba(0,102,255,.3)' }}
        >
          <i className="h-[6px] w-[6px] rounded-full bg-blue" />
          From Web
        </span>
      );
    case 'hybrid':
      return (
        <span
          className={`${BASE} text-[#cfeede]`}
          style={{
            background:
              'linear-gradient(90deg,rgba(0,196,140,.14) 0%,rgba(0,196,140,.14) 50%,rgba(0,102,255,.14) 50%,rgba(0,102,255,.14) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(120,170,150,.3)',
          }}
        >
          <i
            className="h-[6px] w-[6px] rounded-full"
            style={{ background: 'linear-gradient(90deg,#00C48C 50%,#0066FF 50%)' }}
          />
          From Transcript + Web
        </span>
      );
    case 'summary':
      return (
        <span
          className={`${BASE} text-[#B794FF]`}
          style={{ background: 'rgba(139,92,246,.14)', boxShadow: 'inset 0 0 0 1px rgba(139,92,246,.32)' }}
        >
          <i className="h-[6px] w-[6px] rounded-full" style={{ background: '#8B5CF6' }} />
          Episode Summary
        </span>
      );
    case 'transcript':
    default:
      return (
        <span
          className={`${BASE} text-[#3FE3B4]`}
          style={{ background: 'rgba(0,196,140,.12)', boxShadow: 'inset 0 0 0 1px rgba(0,196,140,.28)' }}
        >
          <i className="h-[6px] w-[6px] rounded-full bg-green" />
          From Transcript
        </span>
      );
  }
}
