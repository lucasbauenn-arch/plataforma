// Desenho do PDF do contrato com pdf-lib (JS puro, sem DOM nem navegador headless; §6.3). Só Deno: a diagramação
// (quebra de linha, paginação, rodapé, WinAnsi) é do módulo puro _shared/pdf.ts, que recebe daqui a medida real das
// fontes. Helvetica padrão (WinAnsi cobre os acentos do português); a Jost embutida (fontkit) fica para depois ⚑.
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "npm:pdf-lib@1.17.1";
import type { BlocoRenderizado } from "../_shared/modelo-contrato.ts";
import { type EstiloFonte, LAYOUT_A4, montarLayout, rodapeContrato } from "../_shared/pdf.ts";

export interface MetaPdf {
  /** contratos.codigo (#0000123). */
  codigo: number;
  /** Versão da minuta que este arquivo vai ser (pdf_versao + 1). */
  versao: number;
}

/** Gera o PDF da minuta. Metadados sem dado pessoal (só número do contrato e versão). */
export async function gerarPdf(blocos: BlocoRenderizado[], meta: MetaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontes: Record<EstiloFonte, PDFFont> = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrito: await doc.embedFont(StandardFonts.HelveticaBold),
    italico: await doc.embedFont(StandardFonts.HelveticaOblique),
    negrito_italico: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const medir = (texto: string, tamanho: number, estilo: EstiloFonte) => fontes[estilo].widthOfTextAtSize(texto, tamanho);
  const layout = montarLayout(blocos, medir, LAYOUT_A4, rodapeContrato(meta.codigo));
  const cor = rgb(0.1, 0.1, 0.1);
  for (const p of layout.paginas) {
    const pagina = doc.addPage([LAYOUT_A4.largura, LAYOUT_A4.altura]);
    for (const t of p.textos) {
      pagina.drawText(t.texto, { x: t.x, y: t.y, size: t.tamanho, font: fontes[t.estilo], color: cor });
    }
  }
  const numero = String(meta.codigo).padStart(7, "0");
  doc.setTitle(`Contrato nº ${numero} (minuta v${meta.versao})`);
  doc.setAuthor("Arken Incorporadora");
  doc.setCreator("Plataforma Arken");
  doc.setProducer("Plataforma Arken (pdf-lib)");
  doc.setLanguage("pt-BR");
  return await doc.save({ useObjectStreams: true });
}
