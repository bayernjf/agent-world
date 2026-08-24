/**
 * Reactor-core mark, carried over from the marketing site. Colours come from the
 * shared tokens rather than being baked in, so the mark tracks the palette.
 */
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M16 1.4 29.8 8.7v14.6L16 30.6 2.2 23.3V8.7z"
        fill="var(--steel-800)"
        stroke="var(--steel-400)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d="M16 6.7 24.8 11.35v9.3L16 25.3 7.2 20.65v-9.3z"
        fill="none"
        stroke="var(--data)"
        strokeWidth={1.6}
        opacity={0.6}
      />
      <g transform="translate(10.7 7.6) scale(1.0625)">
        <path d="M6 0 0 9h4l-1 7 7-10H5.5z" fill="var(--power)" />
      </g>
    </svg>
  );
}
