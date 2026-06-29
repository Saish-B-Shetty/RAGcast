// RAGcast wordmark (Space Grotesk, 700). No icon/dot — text only, per the design handoff.
export function Logo({ size = 21 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center font-display font-bold tracking-[-.02em] leading-none"
      style={{ fontSize: size }}
    >
      RAGcast
    </span>
  );
}
