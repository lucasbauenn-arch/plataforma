# Perfis de Usuário

> **Atualizado em 28/09/2026.**
> - Para a **rede de parceiros** (imobiliária → gerente → corretor → cliente), a regra do novo sistema está em [area-parceiros.md](./area-parceiros.md). Ela **prevalece** sobre este documento.
> - Este documento descreve os **perfis que existem hoje** (para migração) e os perfis **internos da Ocka**, que não fazem parte da árvore de parceiros.

## 1. Perfis do novo sistema (alvo)

| Perfil | Tipo | Escopo de dados | Definido em |
|---|---|---|---|
| **Super (Ocka)** | Interno | Tudo, inclusive configurações globais, comissões e modelos de contrato | Este documento |
| **Administrador (Ocka)** | Interno | Tudo, exceto configurações críticas ⚠️ (definir o que é "crítico") | Este documento |
| **Colaborador (Ocka)** | Interno | Próprios dados de RH; demais acessos conforme cargo ⚠️ | [modulo-capital-humano.md](./modulo-capital-humano.md) |
| **Imobiliária** | Parceiro | Toda a sua imobiliária | [area-parceiros.md](./area-parceiros.md) |
| **Gerente** | Parceiro | Seus corretores e os clientes deles | [area-parceiros.md](./area-parceiros.md) |
| **Corretor** | Parceiro | Seus clientes | [area-parceiros.md](./area-parceiros.md) |
| **Cliente** | Cliente final | Próprios dados, contratos, documentos e pagamentos | Este documento |

⚠️ O perfil **Super Agente** (gestor regional acima das imobiliárias) existe hoje, mas não aparece na nova regra. Decidir se continua. Ver [decisoes-pendentes.md](./decisoes-pendentes.md).

## 2. Perfis que existem hoje (sistema legado)

Campo `usuario.perfil`. Um usuário tem exatamente um perfil.

| Código | Nome | Usuários no banco (jul/2025) | Observações |
|---|---|---|---|
| `S` | Super | 3 | A documentação antiga dizia "limitado a 1": **não é verdade**. Um deles é marcado como `superPadrao`. |
| `AD` | Administrador | 0 | Existe no código, mas ninguém usa. |
| `SA` | Super Agente | 4 | "Gestor Regional de cidades ou estado". |
| `AN` | Agente de Negócios | 4 | "Imobiliária, Construtora, Captador, Outros negócios". |
| `AI` | Agente Imobiliário (Corretor) | 6 | "Corretores PF, PJ". |
| `CL` | Cliente | 32 | "Pessoa física ou jurídica que só faz aporte". |
| `C` | (sem nome, valor padrão) | 2 | Tratado como funcionário interno no Capital Humano. |

### 2.1 Hierarquia hoje
Cadeia linear: **S → AD → SA → AN → AI → Cliente**.
Quem cadastra outro usuário vira o ancestral dele no seu nível: por exemplo, quando um AI cadastra um cliente, o cliente recebe `AI = id do corretor`, e os níveis acima são copiados subindo pelo campo `superior`.

### 2.2 O que cada perfil vê hoje (confirmado no código)

| Item | S | AD | SA | AN | AI | CL |
|---|---|---|---|---|---|---|
| Dashboard | Super | Super | Super Agente | Agente de Negócios | **Cliente** (mesmo do CL) | Cliente |
| Menu Capital Humano | ✅ | ✅ | Só o link principal (submenu oculto) | Só o link principal (submenu oculto) | Escondido | Escondido |
| Menu Configurações | ✅ | Escondido | Escondido | Escondido | Escondido | Escondido |
| Financeiro | Visão geral | Comissões | Comissões | Comissões | Comissões | Comissões |
| Filtro de lançamentos/contratos | Todos | `AD = eu` | `SA = eu` | `AN = eu` | `AI = eu` | Só os meus |

> ⚠️ **Os itens de menu "escondidos" são ocultados só na tela.** As páginas continuam acessíveis pela URL. Teste feito com um usuário Cliente: `/admin/configuracao` e `/admin/capital-humano` responderam normalmente. O novo sistema deve bloquear no servidor.

## 3. Regras para o novo sistema

1. **Permissão no servidor:** toda rota e toda consulta verifica perfil + escopo do usuário logado.
2. **Menu derivado da permissão:** o front-end só mostra o que o back-end autoriza, mas nunca é a única barreira.
3. **Perfis internos da Ocka** não aparecem na árvore de parceiros e não recebem comissão de venda (exceto a parcela da própria Ocka).
4. **Cliente** só enxerga os próprios dados, contratos, documentos e parcelas, e o contato do seu corretor.
5. **Um usuário = um perfil.** ⚠️ Decidir se alguém pode acumular papéis (ex.: gerente que também vende; ver [area-parceiros.md §5](./area-parceiros.md)).

## 4. Itens removidos da documentação antiga

A versão anterior deste documento listava regras que **não existem no código e não foram decididas pelo negócio**. Foram removidas daqui; as relevantes viraram requisitos em [visao-geral.md](./visao-geral.md#requisitos-não-funcionais-do-novo-sistema):

- Regras de promoção (ex.: "AN → SA com 6 meses de experiência") e de rebaixamento
- "Bloqueio após 3 tentativas", "sessão de 24 horas", "bloqueio de IP suspeito", "bloqueio de múltiplos acessos"
- "Todos os acessos são registrados" (não há log de auditoria)
- Notificações e relatórios diferentes por perfil (não implementados)
- Backup diário com criptografia e teste mensal (não há evidência no projeto)
