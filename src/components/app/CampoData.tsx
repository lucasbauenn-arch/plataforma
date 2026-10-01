import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DIAS_SEMANA, MESES, brParaIso, dentroDoIntervalo, gradeDoMes, hojeIso, isoParaBr, mascaraData, montarIso,
} from '@/lib/datas'

interface Props {
  /** yyyy-mm-dd ou vazio. Sem `valor`, o campo guarda o próprio estado (use `valorInicial` e `name`). */
  valor?: string | null
  valorInicial?: string | null
  /** Recebe yyyy-mm-dd quando a data fica completa e válida, ou '' quando o campo é esvaziado. */
  aoMudar?: (iso: string) => void
  /** Para formulários lidos por FormData: grava yyyy-mm-dd num campo oculto com este nome. */
  name?: string
  id?: string
  min?: string | null
  max?: string | null
  invalido?: boolean
  desabilitado?: boolean
  /** Rótulo acessível quando não há `Campo`/`label` em volta. */
  rotulo?: string
  className?: string
}

function vistaDe(iso: string) {
  const base = iso && /^\d{4}-\d{2}/.test(iso) ? iso : hojeIso()
  return { ano: Number(base.slice(0, 4)), mes: Number(base.slice(5, 7)) }
}

/**
 * Data no padrão do painel: digitação com máscara dd/mm/aaaa e calendário próprio (mês e ano por seletor), sem o
 * seletor nativo do navegador. O valor trafega em ISO (yyyy-mm-dd), como o banco grava `date`.
 */
export function CampoData({ valor, valorInicial, aoMudar, name, id, min, max, invalido, desabilitado, rotulo, className }: Props) {
  const controlado = valor !== undefined
  const [interno, setInterno] = useState(valorInicial ?? '')
  const iso = (controlado ? valor : interno) ?? ''
  const [texto, setTexto] = useState(() => isoParaBr(iso))
  const [isoDoTexto, setIsoDoTexto] = useState(iso)
  const [aberto, setAberto] = useState(false)
  const [vista, setVista] = useState(() => vistaDe(iso))
  const caixa = useRef<HTMLDivElement>(null)
  const idCal = useId()

  // valor trocado por fora (limpar filtros, reset do formulário): ajusta o texto durante o render, sem efeito
  if (isoDoTexto !== iso) {
    setIsoDoTexto(iso)
    if (brParaIso(texto) !== iso) setTexto(isoParaBr(iso))
  }

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc, true) }
  }, [aberto])

  function definir(novo: string, textoNovo: string) {
    setTexto(textoNovo)
    setIsoDoTexto(novo)
    if (!controlado) setInterno(novo)
    aoMudar?.(novo)
  }

  function digitar(t: string) {
    const m = mascaraData(t)
    if (!m) return definir('', '')
    const convertido = brParaIso(m)
    if (convertido && dentroDoIntervalo(convertido, min, max)) {
      definir(convertido, m)
      setVista(vistaDe(convertido))
    } else {
      setTexto(m)
    }
  }

  function escolher(dia: number) {
    const novo = montarIso(vista.ano, vista.mes, dia)
    definir(novo, isoParaBr(novo))
    setAberto(false)
  }

  function mudarMes(delta: number) {
    setVista((v) => {
      const total = v.ano * 12 + (v.mes - 1) + delta
      return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
    })
  }

  const hoje = hojeIso()
  const anoAtual = Number(hoje.slice(0, 4))
  const anoMin = min ? Number(min.slice(0, 4)) : Math.min(anoAtual - 100, vista.ano)
  const anoMax = max ? Number(max.slice(0, 4)) : Math.max(anoAtual + 15, vista.ano)
  const anos = Array.from({ length: anoMax - anoMin + 1 }, (_, i) => anoMin + i)
  const digitado = brParaIso(texto)
  const incompleto = texto.length > 0 && !digitado
  const foraDoIntervalo = !!digitado && !dentroDoIntervalo(digitado, min, max)

  return (
    <div ref={caixa} className={clsx('relative', className)}>
      <input
        id={id} className="input pr-11" inputMode="numeric" placeholder="dd/mm/aaaa" autoComplete="off"
        value={texto} disabled={desabilitado} aria-label={rotulo}
        aria-invalid={invalido || incompleto || foraDoIntervalo || undefined}
        onChange={(e) => digitar(e.target.value)}
        onBlur={() => { if (incompleto || foraDoIntervalo) setTexto(isoParaBr(iso)) }}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      <button
        type="button" disabled={desabilitado} aria-label="Abrir calendário" aria-expanded={aberto} aria-controls={idCal}
        onClick={() => { setVista(vistaDe(iso)); setAberto((a) => !a) }}
        className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 text-muted hover:text-stone disabled:opacity-40"
      >
        <CalendarDays size={17} aria-hidden />
      </button>

      {aberto && (
        <div id={idCal} role="dialog" aria-label="Calendário" className="absolute right-0 z-50 mt-1 w-72 border border-line bg-ink-soft p-3 shadow-2xl">
          <div className="mb-2 flex items-center gap-1">
            <button type="button" onClick={() => mudarMes(-1)} aria-label="Mês anterior" className="p-1.5 text-muted hover:bg-sand hover:text-stone"><ChevronLeft size={16} /></button>
            <select aria-label="Mês" value={vista.mes} onChange={(e) => setVista((v) => ({ ...v, mes: Number(e.target.value) }))}
              className="min-w-0 flex-1 border border-line bg-ink px-2 py-1.5 text-sm">
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select aria-label="Ano" value={vista.ano} onChange={(e) => setVista((v) => ({ ...v, ano: Number(e.target.value) }))}
              className="w-20 border border-line bg-ink px-2 py-1.5 text-sm">
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" onClick={() => mudarMes(1)} aria-label="Próximo mês" className="p-1.5 text-muted hover:bg-sand hover:text-stone"><ChevronRight size={16} /></button>
          </div>
          <table className="w-full table-fixed text-center text-sm">
            <thead>
              <tr>{DIAS_SEMANA.map((d, i) => <th key={i} className="py-1 text-xs font-semibold text-muted">{d}</th>)}</tr>
            </thead>
            <tbody>
              {gradeDoMes(vista.ano, vista.mes).map((semana, s) => (
                <tr key={s}>
                  {semana.map((dia, i) => {
                    if (!dia) return <td key={i} />
                    const esta = montarIso(vista.ano, vista.mes, dia)
                    return (
                      <td key={i} className="p-0.5">
                        <button
                          type="button" disabled={!dentroDoIntervalo(esta, min, max)} onClick={() => escolher(dia)}
                          aria-label={isoParaBr(esta)} aria-pressed={esta === iso}
                          className={clsx('h-8 w-full text-sm disabled:opacity-25',
                            esta === iso ? 'bg-stone font-semibold text-ink' : 'hover:bg-sand',
                            esta === hoje && esta !== iso && 'border border-bronze text-bronze')}
                        >
                          {dia}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs">
            <button type="button" className="font-semibold text-bronze hover:underline disabled:opacity-40" disabled={!dentroDoIntervalo(hoje, min, max)}
              onClick={() => { definir(hoje, isoParaBr(hoje)); setAberto(false) }}>Hoje</button>
            <button type="button" className="text-muted hover:text-stone" onClick={() => { definir('', ''); setAberto(false) }}>Limpar</button>
          </div>
        </div>
      )}
    </div>
  )
}
