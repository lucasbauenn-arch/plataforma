// Atalhos de login só no `npm run dev`. Os valores vêm de .env.development.local (não versionado),
// que o Vite não carrega no `npm run build`: em produção a lista fica vazia e nada disso aparece.
export type ContaDev = { email: string; senha: string }

export const contasDev: ContaDev[] = import.meta.env.DEV
  ? [
      { email: import.meta.env.VITE_DEV_LOGIN_EMAIL ?? '', senha: import.meta.env.VITE_DEV_LOGIN_SENHA ?? '' },
      { email: import.meta.env.VITE_DEV_LOGIN_PARCEIRO_EMAIL ?? '', senha: import.meta.env.VITE_DEV_LOGIN_PARCEIRO_SENHA ?? '' },
    ].filter((c) => c.email && c.senha)
  : []

export const cpfDev: string = import.meta.env.DEV ? (import.meta.env.VITE_DEV_CPF ?? '') : ''
