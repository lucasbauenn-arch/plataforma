import { Link } from 'react-router-dom'
export default function NaoEncontrada() {
  return (
    <div className="container-x py-40 text-center">
      <p className="eyebrow">Erro 404</p>
      <h1 className="display mt-3 text-5xl">Página não encontrada</h1>
      <Link to="/" className="btn-primary mt-8">Voltar ao início</Link>
    </div>
  )
}
