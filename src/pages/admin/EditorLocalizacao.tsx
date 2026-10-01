import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Crosshair, Loader2 } from 'lucide-react'
import { CampoCep } from '@/components/app/CampoCep'
import { UFS } from '@/lib/constants'
import { soDigitos } from '@/lib/format'
import { buscarCoordenadas, geocodificarEndereco, type Coordenadas, type EnderecoCep } from '@/lib/cep'
import type { EmpreendimentoCompleto } from '@/lib/types'

type CamposLocal = { endereco: string; bairro: string; cidade: string; uf: string; cep: string; latitude: string; longitude: string }

const texto = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
/** 7 casas (~1 cm): o suficiente para o mapa, sem o ruído dos serviços. */
const coordenada = (n: number) => String(Math.round(n * 1e7) / 1e7)

/**
 * Seção "Localização" da aba Dados: controlada (o CEP preenche endereço, bairro, cidade, UF e as coordenadas), mas com
 * `name` em cada campo, porque o formulário da aba é lido por FormData. O CEP vai só com os 8 dígitos. Tudo continua
 * editável; "Localizar pelo endereço" refaz as coordenadas com o que estiver digitado (útil depois de pôr o número).
 */
export function EditorLocalizacao({ e }: { e: EmpreendimentoCompleto }) {
  const [c, setC] = useState<CamposLocal>(() => ({
    endereco: texto(e.endereco), bairro: texto(e.bairro), cidade: texto(e.cidade), uf: texto(e.uf).toUpperCase(),
    cep: soDigitos(texto(e.cep)).slice(0, 8), latitude: texto(e.latitude), longitude: texto(e.longitude),
  }))
  const [localizando, setLocalizando] = useState(false)
  const [precisao, setPrecisao] = useState<Coordenadas['precisao'] | null>(null)
  const busca = useRef<AbortController | null>(null)
  const ids = useId()
  useEffect(() => () => busca.current?.abort(), [])

  const mudar = (k: keyof CamposLocal) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = ev.target.value
    setC((x) => ({ ...x, [k]: v }))
    if (k === 'latitude' || k === 'longitude') setPrecisao(null)
  }

  /** Uma busca de coordenadas por vez: a resposta atrasada de um CEP antigo é descartada. */
  async function localizar(buscar: (sinal: AbortSignal) => Promise<Coordenadas | null>, avisoSemResultado: string) {
    busca.current?.abort()
    const controle = new AbortController()
    busca.current = controle
    setLocalizando(true)
    try {
      const r = await buscar(controle.signal)
      if (controle.signal.aborted) return
      if (!r) { toast.info(avisoSemResultado); return }
      setC((x) => ({ ...x, latitude: coordenada(r.latitude), longitude: coordenada(r.longitude) }))
      setPrecisao(r.precisao)
    } catch {
      if (!controle.signal.aborted) toast.error('Não foi possível buscar as coordenadas agora. Preencha latitude e longitude à mão.')
    } finally {
      if (busca.current === controle) { busca.current = null; setLocalizando(false) }
    }
  }

  function aoEncontrar(end: EnderecoCep) {
    setC((x) => ({
      ...x,
      endereco: end.logradouro || x.endereco, bairro: end.bairro || x.bairro, cidade: end.cidade || x.cidade, uf: end.uf || x.uf,
    }))
    void localizar((sinal) => buscarCoordenadas(end, sinal), 'Coordenadas não encontradas para este CEP. Preencha latitude e longitude à mão.')
  }

  function aoMudarCep(d: string) {
    setC((x) => ({ ...x, cep: d }))
    if (d.length !== 8) { busca.current?.abort(); busca.current = null; setLocalizando(false) }
  }

  const ufsComAtual = c.uf && !(UFS as readonly string[]).includes(c.uf) ? [c.uf, ...UFS] : UFS
  const podeLocalizar = !!(c.endereco.trim() && c.cidade.trim())

  return (
    <fieldset className="card grid gap-4 p-6 sm:grid-cols-2">
      <legend className="px-2 font-semibold">Localização</legend>
      <div>
        <label className="label" htmlFor={`${ids}-cep`}>CEP</label>
        <CampoCep id={`${ids}-cep`} valor={c.cep} aoMudar={aoMudarCep} aoEncontrar={aoEncontrar} />
        <input type="hidden" name="cep" value={c.cep} />
      </div>
      <label><span className="label">UF</span>
        <select name="uf" value={c.uf} onChange={mudar('uf')} className="input">
          <option value="">Selecione</option>
          {ufsComAtual.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
      </label>
      <label className="sm:col-span-2"><span className="label">Endereço</span><input name="endereco" value={c.endereco} onChange={mudar('endereco')} className="input" /></label>
      <label><span className="label">Bairro</span><input name="bairro" value={c.bairro} onChange={mudar('bairro')} className="input" /></label>
      <label><span className="label">Cidade</span><input name="cidade" value={c.cidade} onChange={mudar('cidade')} className="input" /></label>
      <label><span className="label">Latitude</span><input name="latitude" type="number" step="any" min={-90} max={90} value={c.latitude} onChange={mudar('latitude')} className="input" /></label>
      <label><span className="label">Longitude</span><input name="longitude" type="number" step="any" min={-180} max={180} value={c.longitude} onChange={mudar('longitude')} className="input" /></label>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted sm:col-span-2" aria-live="polite">
        <button type="button" className="btn-ghost !px-4 !py-2" disabled={!podeLocalizar || localizando}
          onClick={() => void localizar((sinal) => geocodificarEndereco([c.endereco, c.cidade, c.uf], sinal), 'Endereço não encontrado no mapa. Confira o texto ou preencha latitude e longitude à mão.')}>
          {localizando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Crosshair size={15} aria-hidden />} Localizar pelo endereço
        </button>
        {localizando && <span>Buscando coordenadas…</span>}
        {!localizando && precisao === 'endereco' && <span className="text-sage">Coordenadas da rua preenchidas. Confira no mapa do site.</span>}
        {!localizando && precisao === 'aproximada' && <span className="text-aviso">Coordenadas aproximadas (centro da cidade ou do bairro): ajuste ou use "Localizar pelo endereço" com o número.</span>}
      </div>
      <label className="sm:col-span-2"><span className="label">Link do Waze</span><input name="waze_url" defaultValue={e.waze_url ?? ''} className="input" /></label>
      <label className="sm:col-span-2"><span className="label">Título da seção</span><input name="titulo_localizacao" defaultValue={e.titulo_localizacao ?? ''} className="input" /></label>
      <label className="sm:col-span-2"><span className="label">Texto da localização</span><textarea name="texto_localizacao" rows={4} defaultValue={e.texto_localizacao ?? ''} className="input" /></label>
    </fieldset>
  )
}
