import { z } from 'zod'

// Zod sem compilação JIT (FR1-03). O zod 4 compila o parser de cada objeto com `new Function` e, antes, "sonda" se o
// navegador permite eval: numa CSP sem 'unsafe-eval' (public/.htaccess) a sonda é bloqueada, o zod cai no parser normal,
// mas o navegador registra uma violação de CSP em toda página. Os formulários daqui são pequenos: o ganho do JIT é nenhum.
// Este módulo precisa ser o PRIMEIRO import de main.tsx: a configuração vale para os schemas criados depois dela.
z.config({ jitless: true })
