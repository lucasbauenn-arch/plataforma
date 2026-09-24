"""Converte o dump WordPress (Bauenn) em SQL de seed para o schema Arken/Supabase."""
import re, subprocess, json, datetime, html

def q(sql):
    out = subprocess.run(['mysql','-uroot','--default-character-set=utf8mb4','-N','-B','wp','-e',sql],capture_output=True,text=True,check=True).stdout
    return [l.split('\t') for l in out.split('\n') if l]

def unesc(v):  # mysql -B escapa \n \t \\
    return v.replace('\\n','\n').replace('\\t','\t').replace('\\\\','\\') if v not in (None,'NULL') else None

def php_unserialize(s):
    b = s.encode('utf-8'); i = 0
    def parse():
        nonlocal i
        t = chr(b[i])
        if t == 'N': i += 2; return None
        if t in 'ibd':
            j = b.index(b';', i); v = b[i+2:j].decode(); i = j+1
            return int(v) if t=='i' else (v=='1' if t=='b' else float(v))
        if t == 's':
            j = b.index(b':', i+2); n = int(b[i+2:j]); v = b[j+2:j+2+n].decode('utf-8','replace'); i = j+2+n+2; return v
        if t == 'a':
            j = b.index(b':', i+2); n = int(b[i+2:j]); i = j+2; d = {}
            for _ in range(n):
                k = parse(); d[k] = parse()
            i += 1; return d
        raise ValueError(f'tipo {t} em {i}')
    try: return parse()
    except Exception: return {}

def lit(v):
    if v is None or v == '': return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, list): return "array[" + ",".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

def strip_html(v):
    if not v: return None
    v = re.sub(r'<br\s*/?>', '\n', v); v = re.sub(r'</p>\s*<p>', '\n\n', v); v = re.sub(r'<[^>]+>', '', v)
    return html.unescape(v).strip() or None

UP = 'https://bauenn.com.br/wp-content/uploads/'
# imagens vão para o bucket convertidas em WebP (scripts/upload-midias.mjs) — o seed já aponta para o .webp
def webp(p): return re.sub(r'\.(png|jpe?g|avif)$', '.webp', p, flags=re.I)

def midia(url):  # caminho relativo ao bucket 'empreendimentos' (pasta wp/)
    if not url: return None
    return webp('wp/' + url.split(UP,1)[1]) if UP in url else url

attach = {r[0]: r[1] for r in q("select post_id, meta_value from wp_postmeta where meta_key='_wp_attached_file'")}
def att(id_): return webp('wp/' + attach[id_]) if id_ in attach else None

STATUS = {'lancamentos':'lancamento','lancamento':'obras_iniciadas','futuros-lancamentos':'futuro_lancamento','obras-aceleradas':'obras_aceleradas',
          'em-obras':'em_construcao','pronto-para-morar':'pronto_para_morar','portifolio':'portfolio','entrega-2025':'em_construcao'}
TIPO_GAL = lambda n: ('planta' if 'plant' in n.lower() else 'fachada' if 'fachad' in n.lower() else 'area_comum')

posts = q("select ID, post_name, post_title, post_status, menu_order from wp_posts where post_type='empreendimentos' and post_status in ('publish','draft')")
terms = {}
for pid, slug, tax in q("select tr.object_id, t.slug, tt.taxonomy from wp_term_relationships tr join wp_term_taxonomy tt using(term_taxonomy_id) join wp_terms t using(term_id)"):
    terms.setdefault(pid, {}).setdefault(tax, []).append(slug)

out = ['-- Seed gerado a partir do dump WordPress da Bauenn', 'begin;']
for pid, slug, titulo, st, _ in posts:
    m = {r[0]: unesc(r[1] if len(r)>1 else None) for r in q(f"select meta_key, meta_value from wp_postmeta where post_id={pid} and meta_key not like '\\_%'")}
    thumb = q(f"select meta_value from wp_postmeta where post_id={pid} and meta_key='_thumbnail_id'")
    capa = att(thumb[0][0]) if thumb else None
    stt = terms.get(pid, {}).get('status', [])
    estagio = next((STATUS[s] for s in stt if s in STATUS), 'futuro_lancamento')
    pais = 'Espanha' if 'espanha' in terms.get(pid, {}).get('local-do-empreendimento', []) else 'Brasil'
    entrega = None
    if (m.get('entrega') or '').isdigit():
        entrega = datetime.datetime.utcfromtimestamp(int(m['entrega'])).date().isoformat()
    tour = None
    gi = php_unserialize(m.get('galeria_iframe') or '')
    for it in (gi or {}).values():
        src = re.search(r'src=["\']([^"\']+)', (it or {}).get('codigo_iframe') or '')
        if src: tour = src.group(1)
    video = m.get('video')
    import unicodedata
    base = slug or unicodedata.normalize('NFKD', html.unescape(titulo)).encode('ascii','ignore').decode().lower()
    base = re.sub(r'[^a-z0-9]+','-', base).strip('-')
    slug_ok = base if not base.isdigit() else f'portfolio-{base}'
    if not slug: slug_ok += f'-rascunho-{pid}'
    cols = dict(
        wp_id=int(pid), slug=slug_ok, nome=html.unescape(titulo), chamada=m.get('h_tagline'), tagline=m.get('a_tagline'),
        titulo_hero=m.get('a_title'), descricao=strip_html(m.get('a_description')), titulo_lazer=m.get('la_tagline'),
        descricao_lazer=strip_html(m.get('la_description')), titulo_localizacao=m.get('l_headline'),
        texto_localizacao=strip_html(m.get('l_description')), endereco=strip_html(m.get('endereco_escrito')) or m.get('endereco'),
        estagio=estagio, pais=pais, dormitorios=m.get('dorms'), vagas=m.get('vagas'), metragem=m.get('metragem'),
        previsao_entrega=entrega, capa_url=capa, logo_url=midia(m.get('a_logo')), perspectiva_url=midia(m.get('prespectiva')),
        tour_virtual_url=tour, waze_url=m.get('waze'), videos=[video] if video else [],
        destaque_home=(m.get('mostrar_na_home') == 'true'), mostrar_no_portfolio=(m.get('nao_mostrar_em_portfolio') != 'true'),
        aceita_fgts=('fgts' in (m.get('h_tagline') or '').lower()),
        publicado=(st == 'publish'), ordem=int(m.get('ordem_de_aparicao') or 0),
    )
    k = ', '.join(cols); v = ', '.join(lit(x) for x in cols.values())
    out.append(f"insert into public.empreendimentos ({k}) values ({v}) on conflict (wp_id) do update set " +
               ', '.join(f"{c}=excluded.{c}" for c in cols if c != 'wp_id') + ';')
    ref = f"(select id from public.empreendimentos where wp_id={pid})"
    out.append(f"delete from public.empreendimento_lazer where empreendimento_id={ref};")
    out.append(f"delete from public.empreendimento_ficha where empreendimento_id={ref};")
    out.append(f"delete from public.empreendimento_proximidades where empreendimento_id={ref};")
    out.append(f"delete from public.empreendimento_midias where empreendimento_id={ref};")
    for n, it in enumerate((php_unserialize(m.get('itens_de_lazer') or '') or {}).values()):
        if it and it.get('l_nome'):
            out.append(f"insert into public.empreendimento_lazer (empreendimento_id,titulo,descricao,icone,ordem) values ({ref},{lit(it['l_nome'].strip().title())},{lit(it.get('l_descricao'))},{lit(midia(it.get('icone')))},{n});")
    for n, it in enumerate((php_unserialize(m.get('itens_do_ficha_tecnica') or '') or {}).values()):
        if it and it.get('iten_ficha'):
            out.append(f"insert into public.empreendimento_ficha (empreendimento_id,titulo,descricao,icone_url,ordem) values ({ref},{lit(it['iten_ficha'].strip())},{lit(it.get('descricao_item_ficha'))},{lit(midia(it.get('icone_ficha')))},{n});")
    for n, it in enumerate((php_unserialize(m.get('locais_proximo_empreendimento') or '') or {}).values()):
        if it and it.get('local_proximo_titulo'):
            dist = it.get('local_proximo_distancia'); dist = None if dist == it['local_proximo_titulo'] else dist
            out.append("insert into public.empreendimento_proximidades (empreendimento_id,nome,distancia,tempo_pe,tempo_carro,tempo_transporte,tempo_bike,foto_url,ordem) values "
                       f"({ref},{lit(it['local_proximo_titulo'])},{lit(dist)},{lit(it.get('local_proximo_a_pe'))},{lit(it.get('local_proximo_carro'))},{lit(it.get('local_proximo_trans_publi'))},{lit(it.get('local_proximo_bike'))},{lit(midia(it.get('foto_do_local')))},{n});")
    n = 0
    for g in (php_unserialize(m.get('imagens') or '') or {}).values():
        if not g: continue
        tipo = TIPO_GAL(g.get('nome_da_galeria') or '')
        for aid in (g.get('imagens_da_galeria') or '').split(','):
            p = att(aid.strip())
            if p:
                out.append(f"insert into public.empreendimento_midias (empreendimento_id,tipo,url,legenda,ordem) values ({ref},'{tipo}',{lit(p)},{lit((g.get('nome_da_galeria') or '').title())},{n});"); n += 1

# Clientes do portal: o dump só tem 2 registros de teste no Formidable; dados reais estão no Notion.
clientes=[]
out.append('commit;')
open('/home/claude/arken/etl/seed_wordpress.sql','w').write('\n'.join(out) + '\n')
print(len(posts), 'empreendimentos;', len(clientes), 'clientes;', len(out), 'linhas')
