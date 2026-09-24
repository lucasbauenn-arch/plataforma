import type { ReactNode } from 'react'

export function Campo({ label, erro, obrigatorio, children }: { label: string; erro?: string; obrigatorio?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}{obrigatorio && <span className="text-bronze"> *</span>}</span>
      {children}
      {erro && <span className="mt-1 block text-xs text-red-400">{erro}</span>}
    </label>
  )
}
