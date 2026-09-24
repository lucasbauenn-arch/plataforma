import type { ReactNode } from 'react'
export function AuthCard({ eyebrow, titulo, children }: { eyebrow: string; titulo: string; children: ReactNode }) {
  return (
    <section className="container-x grid min-h-[70svh] place-items-center py-16">
      <div className="card w-full max-w-md p-8 sm:p-10">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display mt-2 text-4xl">{titulo}</h1>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  )
}
