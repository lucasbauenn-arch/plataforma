-- Expansão da rede (docs/ARQUITETURA_EXPANSAO.md §2.1): papéis e status novos.
-- Arquivo isolado de propósito: um valor acrescentado com ALTER TYPE … ADD VALUE só pode ser usado depois do
-- commit, e o CLI aplica cada migration numa transação. As migrations seguintes já podem usar os valores.
--   super       interno; tudo, inclusive o que é crítico
--   imobiliaria parceiro; usuário que representa a organização
--   gerente     parceiro; seus corretores e os clientes deles
--   corretor    parceiro; seus clientes
--   colaborador interno previsto (A8/G1), sem acesso nesta etapa
-- status_parceiro 'inativo': desligamento (exige transferência); 'bloqueado' continua sendo temporário (N19).
alter type public.papel add value if not exists 'super';
alter type public.papel add value if not exists 'imobiliaria';
alter type public.papel add value if not exists 'gerente';
alter type public.papel add value if not exists 'corretor';
alter type public.papel add value if not exists 'colaborador';

alter type public.status_parceiro add value if not exists 'inativo';
