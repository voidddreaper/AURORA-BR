/** Brazilian geometric star: rhombus (flag geometry) + 8-point star. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB800" />
          <stop offset="1" stopColor="#FF6B00" />
        </linearGradient>
      </defs>
      <path d="M32 3 L61 32 L32 61 L3 32 Z" fill="none" stroke="#FF6B00" strokeOpacity="0.45" strokeWidth="3" />
      <path d="M32 12 L36.5 27.5 L52 32 L36.5 36.5 L32 52 L27.5 36.5 L12 32 L27.5 27.5 Z" fill="url(#lg-star)" />
      <circle cx="32" cy="32" r="3.5" fill="#000" />
    </svg>
  );
}
