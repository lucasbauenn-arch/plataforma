# Mapeamento bauenn.com.br → Arken Incorporadora (Vite + Supabase)

## Stack atual
WordPress 6.8 · Elementor Pro · JetEngine (CPT `empreendimentos`) · Ultimate Member (login parceiros) ·
Formidable Forms (form_clientes) · Code Snippets (lógica de negócio customizada em PHP) · LiteSpeed Cache.
Integração com Notion (snippet "NotionKey").

## Site público
- Home: carrossel de empreendimentos, "Sobre", serviços (Projetos Estruturais, Execução de Obras, Serviços Personalizados),
  "Imóvel em lançamento", "Obras aceleradas", "Breve lançamento" (futuros), rodapé com contatos.
- Quem Somos · Portfólio Brasil · Termos · Privacidade · Cookies
- Página de empreendimento: hero, dorms/vagas, lazer (itens com título+descrição), vídeos, galerias
  (Fachada / Área Comum / Plantas), endereço + mapa + Waze, pontos próximos (distância, tempo a pé/carro/transporte).
- Taxonomias: local (Brasil, Espanha) · status (Lançamentos, Futuro lançamento, Obras iniciadas, Obras aceleradas,
  Em construção, Pronto para morar, Entrega 2025, Portfólio, Comercial Espanha)
- 17 empreendimentos (inclui itens de portfólio e futuros lançamentos).
- CAPTCHA customizado (snippets 26/27/28).

## Área do Parceiro (/login-parceiros → /empreendimento)
Abas:
1. **Empreendimentos** — cards (nome, endereço, estágio, categoria, construtora, nº unidades). Clique abre modal com
   tabela de unidades (APTO, metragem, valor R$) + link "Baixar arquivos" (pasta Google Drive).
2. **Cadastrar Clientes** — nome*, RG, CPF, telefone*, anotações, interesses (checkbox múltiplo: faixa de valor,
   dormitórios, região/cidade, tipo de imóvel, estágio). Abaixo, tabela dos clientes cadastrados pelo parceiro.
3. **Fazer Proposta** — select de empreendimento + texto da proposta.
- Snippets: "Redirecionar Parceiro Logado", "Gerar Senha de 5 Dígitos para Parceiros" (inativo),
  "FomularioParceirosClie", "Tabela p Parceiro", "Forms para propostas", "CardEmpreendimentos".

## Portal do Cliente (/portal-do-cliente)
- Login só com CPF (sem senha) → página do cliente (snippet "Pagina Cliente", ~37 KB — maior módulo).
- ⚠️ Risco de segurança: qualquer pessoa com um CPF acessa os dados. No novo sistema: CPF + senha/OTP (e-mail/WhatsApp).
- Cadastro interno de clientes (/cadclientes, Formidable): nome*, CPF*, telefone, negócios, arquivos.

## Pendências
- Dump do banco (campos JetEngine, unidades, clientes, propostas, dados do portal).
- Export dos snippets (Code Snippets → Exportar), SEM o snippet NotionKey.
- Login de teste no portal do cliente (feito pelo usuário).
