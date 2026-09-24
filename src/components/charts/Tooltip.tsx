export function Tooltip({ tip }: { tip: { x: number; y: number; titulo: string; valor: string } | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-line bg-ink px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <p className="text-stone/60">{tip.titulo}</p>
      <p className="font-semibold text-stone">{tip.valor}</p>
    </div>
  )
}
