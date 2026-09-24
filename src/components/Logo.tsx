export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5 text-stone">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
        <rect width="64" height="64" fill="currentColor" />
        <path d="M18 46 32 16l14 30h-7l-7-15-7 15z" fill="#c08457" />
      </svg>
      <span className="leading-none">
        <span className="block text-lg font-bold tracking-[0.18em]">ARKEN</span>
        <span className="block text-[9px] font-semibold tracking-[0.34em] opacity-60">INCORPORADORA</span>
      </span>
    </span>
  )
}
