import { Fragment, type ReactNode } from 'react';
import type { Message as Msg } from '@shared/types';
import { Badge } from './Badge';

// Matches MM:SS / H:MM:SS timestamp tokens for inline bright-blue links.
const TS_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

function renderWithTimestamps(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TS_TOKEN);
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    nodes.push(
      <span key={key++} className="font-semibold text-blue-bright">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}

export function Message({ m }: { m: Msg }) {
  if (m.role === 'user') {
    return (
      <div className="flex max-w-[78%] flex-col items-end self-end">
        <div className="rounded-[18px_18px_6px_18px] border border-border bg-[#1E1E1E] px-[17px] py-[13px] text-[14.5px] font-normal leading-[1.5] text-[#F0F2F5] shadow-[0_8px_24px_-14px_rgba(0,0,0,.7)]">
          {m.content}
        </div>
      </div>
    );
  }

  // assistant — plain text (no bubble), badge above
  const paragraphs = m.content.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <div className="flex max-w-full flex-col items-start self-start">
      <div className="px-0.5 pt-0.5 text-[15px] leading-[1.65] text-[#E3E6EB]">
        {m.source && (
          <div className="mb-[9px] flex items-center gap-[7px]">
            <Badge source={m.source} />
          </div>
        )}
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-[10px] last:mb-0">
            {renderWithTimestamps(p)}
          </p>
        ))}
      </div>
    </div>
  );
}

export function Typing() {
  return (
    <div className="flex max-w-full flex-col items-start self-start">
      <div className="px-0.5 py-3">
        <span className="inline-flex gap-1">
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-[#5C9BFF]" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-[#5C9BFF] [animation-delay:.2s]" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-[#5C9BFF] [animation-delay:.4s]" />
        </span>
      </div>
    </div>
  );
}
