// Decisões provisórias adotadas nesta etapa (docs/ARQUITETURA_EXPANSAO.md §1.1 e §1.2, marcadas com ⚑).
// Alimenta o painel "Regras provisórias" de /admin/configuracoes e o selo "Provisório (código)" de cada campo
// configurável. O WP7 leva as mesmas entradas para o docs/PRD.md §13.

export interface RegraProvisoria {
  /** Código da especificação (A1…I2) ou pendência nova (N1…N20). */
  codigo: string
  titulo: string
  /** Escolha adotada, em uma ou duas frases. */
  regra: string
  /** Onde o Super muda (tabela/coluna), ou `null` quando não é configurável. */
  ondeConfigura: string | null
  /** Tela de configuração correspondente (rota absoluta), quando existe. */
  rota: string | null
  /**
   * Campos configuráveis que levam o selo, no formato `tabela.coluna` (ou `tabela.chave` em tabelas por linha:
   * `permissoes_rede.<acao>`, `status_transicoes.<entidade>`, `notificacoes_config.<tipo>`).
   */
  campos: string[]
  /** Origem da sugestão (ex.: "sugestão da doc", "caminho conservador"). */
  sinalizacao: string
  /** O que fica bloqueado até o negócio decidir, quando for o caso. */
  bloqueia?: string
}

const CFG = '/admin/configuracoes'

const REGRAS: RegraProvisoria[] = [
  {
    codigo: 'A1', titulo: 'Gerente cadastra cliente',
    regra: 'Permitido: o gerente fica como corretor responsável do cliente. Não existe corretor virtual por gerente.',
    ondeConfigura: "permissoes_rede ('gerente_como_corretor', gerente)", rota: `${CFG}/permissoes`,
    campos: ['permissoes_rede.gerente_como_corretor'], sinalizacao: 'sugestão da doc',
  },
  {
    codigo: 'A2', titulo: 'Duplicidade por CPF/CNPJ',
    regra: 'Uma pessoa, um registro. O primeiro cadastro é o dono, com exclusividade de 90 dias. Toda tentativa com documento existente é bloqueada com resposta genérica; depois do prazo, o caso vai para a fila "Duplicidades" e a equipe decide. Nunca há transferência automática.',
    ondeConfigura: 'configuracao_geral.exclusividade_dias (90) e duplicidade_bloqueios_hora (10)', rota: `${CFG}/geral`,
    campos: ['configuracao_geral.exclusividade_dias', 'configuracao_geral.duplicidade_bloqueios_hora'],
    sinalizacao: 'prazo e dono sugeridos; pós-prazo pelo caminho conservador',
  },
  {
    codigo: 'A3', titulo: 'Níveis de gerência',
    regra: 'Um nível só (corretor → gerente). O histórico de vínculos já permite crescer sem refazer os dados.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'A4', titulo: 'Corretor autônomo',
    regra: 'Fica na Imobiliária Arken (da casa), com a "Gerência Arken" e a "Carteira Arken" virtuais. Legados, autocadastros sem imobiliária e cadastros sem indicador entram nela.',
    ondeConfigura: 'configuracao_geral.imobiliaria_casa_id / gerente_casa_id / corretor_casa_id', rota: `${CFG}/geral`,
    campos: ['configuracao_geral.imobiliaria_casa_id', 'configuracao_geral.gerente_casa_id', 'configuracao_geral.corretor_casa_id'],
    sinalizacao: 'sugestão da doc',
  },
  { codigo: 'A5', titulo: 'Super Agente', regra: 'Não criado (nem papel, nem nível, nem modelo de contrato).', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'decisão do negócio' },
  { codigo: 'A6', titulo: 'Agente de Negócios', regra: 'Vira só Imobiliária. Construtora e captador não entram.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  { codigo: 'A7', titulo: 'Investidor', regra: 'Não criado, nem o e-mail de investidor.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  { codigo: 'A8', titulo: 'Colaborador', regra: 'Existe só no enum de papéis, sem acesso nenhum ("acesso ainda não liberado").', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  { codigo: 'D1', titulo: 'Status "R" do contrato', regra: 'Dois valores separados: rascunho e recusado.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  { codigo: 'D2', titulo: 'Tipos de contrato', regra: 'Só aquisição. Investimento, serviço, parceria e interno não são criados.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  {
    codigo: 'D3', titulo: 'Signatários',
    regra: 'Cliente e representante Arken ativo sem e-mail na semente: o envio fica bloqueado até o Super preencher. Testemunhas opcionais (inativas).',
    ondeConfigura: 'contrato_signatario_regras', rota: `${CFG}/signatarios`, campos: ['contrato_signatario_regras.email'],
    sinalizacao: 'bloqueia o primeiro envio, de propósito', bloqueia: 'Envio para assinatura',
  },
  {
    codigo: 'D4', titulo: 'Prazo e lembretes de assinatura',
    regra: 'Nenhum. O status "expirado" só entra se o D4Sign informar.',
    ondeConfigura: 'configuracao_geral.prazo_assinatura_dias', rota: `${CFG}/geral`, campos: ['configuracao_geral.prazo_assinatura_dias'],
    sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'D5', titulo: 'Todos assinaram',
    regra: 'Contrato vai a assinado, o cliente a Finalizado e o evento fica gravado. O imóvel já estava "No contrato" desde o envio. As parcelas ficam para a etapa financeira.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'CTR-4 parcial',
  },
  { codigo: 'D6', titulo: 'Contrato de serviço de parceiro', regra: 'Só pré-visualização, sem gravar e sem assinatura.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  {
    codigo: 'E2', titulo: 'Aprovação de imóvel',
    regra: 'Rascunho → Pendente (criador ou equipe) → Em revisão → Aprovado (equipe). Revisão pode voltar a rascunho com observação. Aprovado vai a "No contrato" no envio do contrato e volta se ele for recusado, expirar ou for cancelado.',
    ondeConfigura: 'status_transicoes (imovel)', rota: `${CFG}/transicoes`, campos: ['status_transicoes.imovel'], sinalizacao: 'proposta da doc',
  },
  {
    codigo: 'E3', titulo: 'Tipos de imóvel', regra: 'Casa, apartamento e terreno. O Super acrescenta outros.',
    ondeConfigura: 'imovel_tipos', rota: null, campos: ['imovel_tipos.codigo'], sinalizacao: 'sugestão da doc',
  },
  {
    codigo: 'E4', titulo: 'Quem cadastra, edita e vê imóveis',
    regra: 'Cadastram internos e parceiros aprovados. Editam o criador e a equipe em rascunho/pendente; depois, só a equipe. Em rascunho, pendente e revisão veem o criador, a cadeia acima dele e a equipe; aprovados e no contrato, todos os parceiros aprovados.',
    ondeConfigura: "permissoes_rede ('cadastrar_imovel', tipo)", rota: `${CFG}/permissoes`, campos: ['permissoes_rede.cadastrar_imovel'],
    sinalizacao: 'hoje "todos veem todos"',
  },
  {
    codigo: 'Fotos', titulo: 'Limite de fotos do imóvel', regra: 'Até 20 fotos de 5 MB por imóvel.',
    ondeConfigura: 'configuracao_geral.imovel_fotos_max e imovel_foto_max_bytes', rota: `${CFG}/geral`,
    campos: ['configuracao_geral.imovel_fotos_max', 'configuracao_geral.imovel_foto_max_bytes'], sinalizacao: 'sugestão',
  },
  { codigo: 'E5', titulo: 'Parâmetros sem significado e "Chip"', regra: 'Não criados.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador' },
  {
    codigo: 'F1', titulo: 'Perdido e reativar',
    regra: 'Novo contato, Contato iniciado ou Documentação → Perdido com motivo obrigatório; Perdido → Novo contato (reativar). Finalizado é final.',
    ondeConfigura: 'status_transicoes (cliente_etapa)', rota: `${CFG}/transicoes`, campos: ['status_transicoes.cliente_etapa'], sinalizacao: 'sugestão da doc',
  },
  {
    codigo: 'F2', titulo: 'Validações por etapa',
    regra: 'Entrar em Documentação cria as 4 solicitações de documento básico, sem duplicar. Finalizado exige contrato assinado e só acontece pelo sistema. Voltar de etapa não é permitido.',
    ondeConfigura: 'status_transicoes e configuracao_geral.documentos_basicos', rota: `${CFG}/transicoes`,
    campos: ['status_transicoes.cliente_etapa', 'configuracao_geral.documentos_basicos'], sinalizacao: 'proposta da doc',
  },
  {
    codigo: 'F3', titulo: 'Timeline automática',
    regra: 'Cadastro, etapa, nota, tarefa criada/concluída, documento solicitado/enviado/analisado, contrato gerado/enviado/assinado, transferência, proposta enviada/respondida. Pagamento fica para o financeiro.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'lista mínima da doc',
  },
  {
    codigo: 'F4', titulo: 'Quem analisa documento',
    regra: 'A equipe e os parceiros com escopo sobre o cliente.',
    ondeConfigura: "permissoes_rede ('analisar_documento', tipo)", rota: `${CFG}/permissoes`, campos: ['permissoes_rede.analisar_documento'],
    sinalizacao: 'leitura da tabela de fluxos',
  },
  {
    codigo: 'H1', titulo: 'Inatividade da sessão',
    regra: 'Sai depois de 8 horas sem uso. Pelo Auth se o plano permitir; senão, um temporizador no navegador (controle fraco).',
    ondeConfigura: 'configuracao_geral.sessao_inatividade_horas', rota: `${CFG}/geral`, campos: ['configuracao_geral.sessao_inatividade_horas'],
    sinalizacao: 'depende do plano',
  },
  {
    codigo: 'H2', titulo: 'Tentativas de login',
    regra: 'Turnstile e limite por IP do Auth. O bloqueio por conta (5 tentativas em 15 min) exige o Password Verification Hook.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'atendido em parte, depende do plano',
  },
  {
    codigo: 'H3', titulo: 'Retenção de logs',
    regra: 'Acessos: 24 meses. Demais registros: 60 meses. Purga mensal automática.',
    ondeConfigura: 'configuracao_geral.retencao_acesso_meses e retencao_operacao_meses', rota: `${CFG}/geral`,
    campos: ['configuracao_geral.retencao_acesso_meses', 'configuracao_geral.retencao_operacao_meses'], sinalizacao: 'sugestão; 60 meses para o não classificado',
  },
  {
    codigo: 'H4', titulo: 'Texto de consentimento',
    regra: 'Termos versionados. A versão "0-provisória" usa o texto da política de privacidade, sem revisão jurídica. O pré-cadastro público não vai ao ar sem uma versão revisada.',
    ondeConfigura: 'lgpd_termos', rota: `${CFG}/termos`, campos: ['lgpd_termos.texto'], sinalizacao: 'bloqueia o go-live do pré-cadastro',
    bloqueia: 'Pré-cadastro público',
  },
  {
    codigo: 'H5', titulo: '2FA para a equipe',
    regra: 'TOTP do Supabase. Começa desligado; liga depois de todos os internos cadastrarem o autenticador.',
    ondeConfigura: 'configuracao_geral.exigir_mfa_interno', rota: `${CFG}/geral`, campos: ['configuracao_geral.exigir_mfa_interno'],
    sinalizacao: 'depende do cadastro do TOTP',
  },
  {
    codigo: 'Convite', titulo: 'Convite por link (WhatsApp/copiar)',
    regra: 'Desligado para imobiliária e gerente: quem gera o link pode definir a senha do convidado. Eles convidam só por e-mail; o link fica com a equipe.',
    ondeConfigura: "permissoes_rede ('convite_por_link', tipo)", rota: `${CFG}/permissoes`, campos: ['permissoes_rede.convite_por_link'],
    sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'Criar contrato', titulo: 'Quem cria contrato',
    regra: 'Imobiliária, gerente e corretor criam contratos dos clientes no seu escopo. Só a equipe envia para assinatura.',
    ondeConfigura: "permissoes_rede ('criar_contrato', tipo)", rota: `${CFG}/permissoes`, campos: ['permissoes_rede.criar_contrato'],
    sinalizacao: 'sugestão',
  },
  {
    codigo: 'Estado civil', titulo: 'Estado civil "divorciado"',
    regra: 'A lista inclui "divorciado", que falta na especificação.', ondeConfigura: null, rota: null, campos: [], sinalizacao: 'lacuna da doc',
  },
  {
    codigo: 'N1', titulo: 'Portal só por CPF com dados do CRM',
    regra: 'Mantido, com mitigações: portal liberado só manualmente, o cliente só envia documentos (não baixa), contratos aparecem a partir do envio para assinatura. Recomendação: exigir CPF + código antes de ativar contratos no portal.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'amplia um risco aceito em 21/09',
  },
  {
    codigo: 'N2', titulo: 'Quem vira Super',
    regra: 'Nenhum admin vira Super automaticamente: o dono define por um comando do runbook. Depois, só o Super muda papéis internos.',
    ondeConfigura: 'Configurações › Equipe (equipe_definir_papel)', rota: `${CFG}/equipe`, campos: [], sinalizacao: 'caminho conservador',
    bloqueia: 'Configurações críticas',
  },
  {
    codigo: 'N3', titulo: 'Regularizar corretor migrado',
    regra: 'Ao levar um corretor da casa para uma imobiliária real, o Super escolhe explicitamente se os clientes vão junto (exceção declarada ao PAR-6).',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N4', titulo: 'Produto do contrato', regra: 'Vale para unidade de empreendimento Arken ou para imóvel cadastrado — exatamente um dos dois.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'sugestão',
  },
  {
    codigo: 'N5', titulo: 'Status da unidade ao contratar',
    regra: 'Continua manual. Só se impede dois contratos ativos para a mesma unidade e contratar unidade vendida.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N8', titulo: 'Autocadastro de parceiro pelo site',
    regra: 'Passa a exigir CPF e CRECI. A aprovação cria o corretor na cadeia escolhida (padrão: casa).',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'PAR-4',
  },
  {
    codigo: 'N11', titulo: 'Importador do Notion', regra: 'Grava no CRM como origem "importação", com a mesma regra de duplicidade (A2).',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'sugestão',
  },
  {
    codigo: 'N12', titulo: 'Consentimento declarado',
    regra: 'No cadastro interno, o consentimento é registrado como "declarado" por quem cadastrou. A base legal precisa do jurídico.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'depende do jurídico',
  },
  {
    codigo: 'N13', titulo: 'Finalizar sem contrato no sistema',
    regra: 'Não é permitido por padrão: Finalizado exige contrato assinado. O Super pode liberar nas transições.',
    ondeConfigura: 'status_transicoes (cliente_etapa)', rota: `${CFG}/transicoes`, campos: ['status_transicoes.cliente_etapa'], sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N15', titulo: 'Migração dos dados atuais',
    regra: 'Clientes do portal ficam na casa (Finalizado se tiverem negócio, senão Novo contato). Em conflito de CPF entre parceiros, o cadastro mais antigo é dono provisório e o caso vai para a fila. Tudo pode ser decidido antes do corte.',
    ondeConfigura: 'migracao_decisoes (antes do corte)', rota: null, campos: [], sinalizacao: 'sem decisão registrada', bloqueia: 'Corte da migração',
  },
  {
    codigo: 'N16', titulo: 'Preço negociado', regra: 'Não suportado: o valor do contrato é sempre o do produto, lido no servidor.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N18', titulo: 'Autocadastro pelo site continua',
    regra: 'Continua, sempre com aprovação da equipe. O autocadastro de corretor ou imobiliária por link de indicação não é construído.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'recurso já existente',
  },
  {
    codigo: 'N19', titulo: 'Bloqueado × inativo',
    regra: 'Bloqueado é temporário: perde o acesso e mantém a carteira. Inativo é desligamento e exige transferência.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'sugestão',
  },
  {
    codigo: 'N20', titulo: 'Quem lê a auditoria', regra: 'Admin e Super, por uma consulta que também fica registrada.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'sugestão',
  },
  {
    codigo: 'N7', titulo: 'Dados da Arken como vendedora',
    regra: 'Razão social, CNPJ e endereço começam vazios. O envio para assinatura fica bloqueado até preencher.',
    ondeConfigura: 'configuracao_geral.vendedora_razao_social / vendedora_cnpj / vendedora_endereco', rota: `${CFG}/geral`,
    campos: ['configuracao_geral.vendedora_razao_social', 'configuracao_geral.vendedora_cnpj', 'configuracao_geral.vendedora_endereco'],
    sinalizacao: 'pendente no PRD', bloqueia: 'Envio para assinatura',
  },
  {
    codigo: 'N9', titulo: 'Portal para quem veio pelo link',
    regra: 'Não: o pré-cadastro não libera o portal. A equipe libera manualmente.',
    ondeConfigura: 'configuracao_geral.portal_libera_pre_cadastro', rota: `${CFG}/geral`, campos: ['configuracao_geral.portal_libera_pre_cadastro'],
    sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N10', titulo: 'E-mails opcionais',
    regra: 'Só boas-vindas do pré-cadastro e documento rejeitado começam ligados.',
    ondeConfigura: 'notificacoes_config', rota: `${CFG}/notificacoes`,
    campos: ['notificacoes_config.crm.boas_vindas', 'notificacoes_config.crm.documento_rejeitado', 'notificacoes_config.crm.documento_solicitado',
      'notificacoes_config.crm.novo_lead_corretor', 'notificacoes_config.contratos.enviado', 'notificacoes_config.contratos.assinado',
      'notificacoes_config.rede.transferencia'],
    sinalizacao: 'caminho conservador',
  },
  {
    codigo: 'N14', titulo: 'Parâmetros de simulação',
    regra: '8,5% de taxa e de 12 a 360 parcelas (valores da Ocka). O valor mínimo do plano flexível começa vazio, o que bloqueia esse plano.',
    ondeConfigura: 'parametros_simulacao (nova versão)', rota: `${CFG}/simulacao`,
    campos: ['parametros_simulacao.taxa_aporte_proprio', 'parametros_simulacao.parcela_minima', 'parametros_simulacao.parcela_maxima', 'parametros_simulacao.valor_minimo_flex'],
    sinalizacao: 'semente provisória', bloqueia: 'Plano flexível',
  },
  {
    codigo: 'N17', titulo: 'Base parcelada',
    regra: 'Segue a fórmula do legado: aporte − entrada. O "restante" (valor − aporte) fica só como informação.',
    ondeConfigura: null, rota: null, campos: [], sinalizacao: 'fórmula do legado',
  },
]

/** Ordem de exibição: códigos da especificação (A1…I2), depois as regras sem código, depois as pendências N1…N20. */
function posicao(codigo: string): [number, number] {
  const m = /^([A-IN])(\d+)$/.exec(codigo)
  if (!m) return [1, 0]
  return [m[1] === 'N' ? 2 : 0, m[1].charCodeAt(0) * 1000 + Number(m[2])]
}

export const REGRAS_PROVISORIAS: RegraProvisoria[] = REGRAS
  .map((r, i) => ({ r, i, p: posicao(r.codigo) }))
  .sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1] || a.i - b.i)
  .map(({ r }) => r)

const porCodigo = new Map(REGRAS_PROVISORIAS.map((r) => [r.codigo, r]))

export const regraProvisoria = (codigo: string) => porCodigo.get(codigo)

/** Regras que marcam um campo (`tabela.coluna`), para o selo "Provisório (código)". */
export const provisoriasDoCampo = (campo: string) => REGRAS_PROVISORIAS.filter((r) => r.campos.includes(campo))
