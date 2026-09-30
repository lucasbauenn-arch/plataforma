import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ehFalhaDeModulo } from '@/lib/modulos'

interface Props {
  children: ReactNode
  /** Quando muda (ex.: a rota), a tela de falha sai e o conteúdo tenta de novo. */
  chave?: string
}
interface Estado {
  erro: unknown
  /** A tela de falha já apareceu (`componentDidCatch` rodou) e `chaveDoErro` guarda a rota em que isso aconteceu. */
  vista: boolean
  chaveDoErro: string | undefined
}

/**
 * Última barreira do app (FUX-02): exceção de renderização e falha de carregar uma tela (chunk lazy depois de um deploy)
 * mostram uma mensagem com "Recarregar", em vez de desmontar a árvore e deixar a tela escura vazia. Erros esperados
 * (consultas, RPCs) NÃO passam por aqui: cada tela mostra o próprio `ErroConsulta`. Fica de pé sem depender do roteador
 * (usa `<a href>`), porque a falha pode ter sido justamente no roteador.
 */
export class LimiteErro extends Component<Props, Estado> {
  state: Estado = { erro: null, vista: false, chaveDoErro: undefined }

  static getDerivedStateFromError(erro: unknown): Partial<Estado> {
    return { erro: erro ?? new Error('Erro desconhecido'), vista: false }
  }

  // A tela de falha só sai quando a rota muda DEPOIS de ela aparecer (`vista`). Se a própria navegação causou a falha,
  // a mensagem fica: a rota do erro é registrada em `componentDidCatch`, já com a mensagem na tela.
  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    if (estado.erro && estado.vista && props.chave !== estado.chaveDoErro) return { erro: null, vista: false, chaveDoErro: undefined }
    return null
  }

  componentDidCatch(erro: unknown, info: ErrorInfo) {
    console.error('[LimiteErro]', erro, info.componentStack)
    this.setState({ vista: true, chaveDoErro: this.props.chave })
  }

  render() {
    if (!this.state.erro) return this.props.children
    const atualizacao = ehFalhaDeModulo(this.state.erro)
    return (
      <div role="alert" className="grid min-h-svh place-items-center bg-ink p-6 text-stone">
        <div className="max-w-md text-center">
          <p className="eyebrow">{atualizacao ? 'Nova versão disponível' : 'Algo deu errado'}</p>
          <h1 className="display mt-3 text-3xl">Não foi possível abrir esta tela</h1>
          <p className="mt-3 text-sm text-muted">
            {atualizacao
              ? 'O sistema foi atualizado enquanto você o usava. Recarregue a página para continuar.'
              : 'Ocorreu um erro inesperado. Recarregue a página; se o problema continuar, fale com a equipe Arken.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Recarregar a página</button>
            <a className="btn-ghost" href="/">Ir para o início</a>
          </div>
        </div>
      </div>
    )
  }
}

/** `LimiteErro` dentro do roteador: trocar de rota tira a tela de falha (o `React.lazy` que falhou continua falhando até recarregar). */
export function LimiteErroDeRotas({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <LimiteErro chave={pathname}>{children}</LimiteErro>
}
