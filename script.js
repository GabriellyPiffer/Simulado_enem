const BASE = 'https://api.enem.dev/v1';
const AREAS = [
  { v: 'linguagens', l: 'Linguagens, Códigos e suas Tecnologias', ic: 'book-open', subs: ['Língua Portuguesa', 'Literatura', 'Língua Estrangeira', 'Artes', 'Educação Física'], d: 'Interpretação de textos, linguagens e comunicação.' },
  { v: 'ciencias-humanas', l: 'Ciências Humanas e suas Tecnologias', ic: 'landmark', subs: ['História', 'Geografia', 'Filosofia', 'Sociologia'], d: 'Sociedade, cultura, política e território.' },
  { v: 'ciencias-natureza', l: 'Ciências da Natureza e suas Tecnologias', ic: 'flask-conical', subs: ['Biologia', 'Física', 'Química'], d: 'Fenômenos naturais, matéria e vida.' },
  { v: 'matematica', l: 'Matemática e suas Tecnologias', ic: 'calculator', subs: ['Matemática'], d: 'Raciocínio lógico, funções, geometria e estatística.' }
];
const short = (l) => l.split(' e suas')[0];
const areaLabel = (v) => (AREAS.find((a) => a.v === v) || { l: 'Outras' }).l;
const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s) => document.querySelector(s);
const app = $('#app');

/* ---------- API (fila de 1 req/s + cache) ---------- */
const cache = new Map(); let chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function request(path) {
  if (cache.has(path)) return cache.get(path);
  const job = chain.then(async () => {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(BASE + path);
      if (res.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error('Erro ' + res.status + ' ao consultar a API.');
      await sleep(1100);
      return res.json();
    }
    throw new Error('Muitas requisições. Tente novamente em instantes.');
  });
  chain = job.catch(() => {});
  cache.set(path, job); job.catch(() => cache.delete(path));
  return job;
}
const getExams = () => request('/exams');
function getAll(year, lang) {
  const key = 'all:' + year + ':' + (lang || '');
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    let offset = 0, all = [], more = true;
    while (more) {
      const q = new URLSearchParams({ limit: 50, offset }); if (lang) q.set('language', lang);
      const d = await request(`/exams/${year}/questions?${q}`);
      all = all.concat(d.questions); offset += d.metadata.limit; more = d.metadata.hasMore;
    }
    return all;
  })();
  cache.set(key, job); job.catch(() => cache.delete(key));
  return job;
}

/* ---------- localStorage ---------- */
const KEY = 'simulado-enem:v1';
const load = () => { try { return Object.assign({ answers: [], simulados: [] }, JSON.parse(localStorage.getItem(KEY))); } catch { return { answers: [], simulados: [] }; } };
const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const addAnswers = (l) => { const d = load(); d.answers.push(...l.map((a) => ({ ...a, ts: Date.now() }))); save(d); };
const addSim = (s) => { const d = load(); d.simulados.push({ ...s, ts: Date.now() }); save(d); };
function summary() {
  const d = load(), total = d.answers.length, hits = d.answers.filter((a) => a.correct).length, by = {};
  d.answers.forEach((a) => { const k = a.discipline || 'outras'; (by[k] = by[k] || { total: 0, hits: 0 }); by[k].total++; if (a.correct) by[k].hits++; });
  return { d, total, hits, errors: total - hits, pct: total ? Math.round(hits / total * 100) : 0, by };
}

/* ---------- componentes ---------- */
const loading = (t = 'Carregando...') => `<div role="status"><div class="spin"></div><p class="muted" style="text-align:center">${t}</p></div>`;
const errBox = (m) => `<div class="notice err" role="alert">${esc(m)}</div>`;
const empty = (m) => `<div class="notice">${m}</div>`;
const bar = (p, rosa) => `<div class="bar ${rosa ? 'rosa' : ''}"><i style="width:${p}%"></i></div>`;
const icons = () => window.lucide && lucide.createIcons();
function md(text) {
  if (!text) return '';
  return '<div class="ctx">' + text.split(/(!\[[^\]]*\]\([^)]+\))/g).map((p) => {
    const m = p.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    return m ? `<img src="${esc(m[2])}" alt="${esc(m[1] || 'Imagem da questão')}" loading="lazy">` : p.trim() ? `<p>${esc(p.trim())}</p>` : '';
  }).join('') + '</div>';
}
function questionHTML(q, sel, revealed) {
  const extra = (q.files || []).filter((f) => !(q.context || '').includes(f)).map((f) => `<img src="${esc(f)}" alt="Imagem da questão" style="max-width:100%;border-radius:8px" loading="lazy">`).join('');
  const alts = q.alternatives.map((a) => {
    let c = 'alt';
    if (revealed) c += a.isCorrect ? ' ok' : a.letter === sel ? ' bad' : ''; else if (a.letter === sel) c += ' sel';
    return `<button class="${c}" data-alt="${a.letter}" ${revealed ? 'disabled' : ''}><b>${a.letter}</b><span>${a.text ? md(a.text) : ''}${a.file ? `<img src="${esc(a.file)}" alt="Alternativa ${a.letter}" loading="lazy">` : ''}</span></button>`;
  }).join('');
  return `<article><div class="chips"><span class="chip">${esc(q.title)}</span><span class="chip">${esc(areaLabel(q.discipline))}</span>${q.language ? `<span class="chip">${esc(q.language)}</span>` : ''}</div>${md(q.context)}${extra}${q.alternativesIntroduction ? `<p><b>${esc(q.alternativesIntroduction)}</b></p>` : ''}${alts}</article>`;
}
const yearOpts = (exams, sel) => exams.map((e) => `<option ${String(e.year) === String(sel) ? 'selected' : ''}>${e.year}</option>`).join('');
const areaOpts = (sel) => '<option value="">Todas</option>' + AREAS.map((a) => `<option value="${a.v}" ${a.v === sel ? 'selected' : ''}>${short(a.l)}</option>`).join('');
const langOpts = (langs, sel) => '<option value="">Padrão</option>' + langs.map((l) => `<option value="${l.value}" ${l.value === sel ? 'selected' : ''}>${l.label}</option>`).join('');
let examsCache = null;
async function exams() { if (!examsCache) examsCache = await getExams(); return examsCache; }

/* ---------- páginas ---------- */
function home() {
  const s = summary(), recent = s.d.simulados.slice(-3).reverse();
  const quick = [['#/simulados', 'Iniciar simulado', 'Monte um simulado com questões reais.', 'clipboard-list'], ['#/questoes', 'Resolver questões', 'Pratique com o gabarito oficial.', 'help-circle'], ['#/provas', 'Provas anteriores', 'Consulte provas e gabaritos de 2009 a 2023.', 'history']];
  app.innerHTML = `<h1>Olá, estudante! Vamos continuar seus estudos?</h1>
  <p class="muted">Constância vence talento: algumas questões por dia já fazem diferença na prova.</p>
  <div class="grid g3" style="margin:24px 0">${quick.map(([h, t, p, i]) => `<a href="${h}" class="card link"><div class="icon-bubble"><i data-lucide="${i}"></i></div><h3>${t}</h3><p class="muted">${p}</p></a>`).join('')}</div>
  <div class="grid g3">
    <div class="card"><p class="muted">Questões respondidas</p><div class="stat">${s.total}</div></div>
    <div class="card"><p class="muted">Aproveitamento</p><div class="stat">${s.pct}%</div>${bar(s.pct)}</div>
    <div class="card"><p class="muted">Acertos / erros</p><div class="stat">${s.hits} / ${s.errors}</div></div></div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><h2>Desempenho por área</h2>${s.total === 0 ? empty('Responda questões para ver seu desempenho por área.') : AREAS.map((a) => { const x = s.by[a.v], p = x ? Math.round(x.hits / x.total * 100) : 0; return `<div style="margin:12px 0"><div class="row between"><span>${short(a.l)}</span><span class="muted">${x ? p + '% (' + x.total + ')' : 'sem dados'}</span></div>${bar(p, 1)}</div>`; }).join('')}</div>
    <div class="card"><h2>Atividades recentes</h2>${recent.length === 0 ? empty('Nenhum simulado realizado neste dispositivo ainda.') : recent.map((r) => `<p><b>${esc(r.title)}</b><br><span class="muted">${r.hits}/${r.total} acertos · ${fmt(r.seconds)} · ${new Date(r.ts).toLocaleDateString('pt-BR')}</span></p>`).join('')}</div></div>`;
}

async function questoes(params) {
  app.innerHTML = '<h1>Questões</h1>' + loading();
  let ex; try { ex = await exams(); } catch (e) { app.innerHTML = '<h1>Questões</h1>' + errBox(e.message); return; }
  const st = { year: params.get('year') || String(ex.at(-1).year), area: params.get('area') || '', lang: '', num: '', text: '', pos: 0, sel: {}, done: {}, data: [] };
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const list = () => st.data.filter((q) => (!st.area || q.discipline === st.area) && (!st.num || q.index === +st.num) && (!st.text || norm(q.context + ' ' + q.alternatives.map((a) => a.text).join(' ')).includes(norm(st.text))));
  app.innerHTML = `<h1>Questões</h1><div class="card row" style="margin-bottom:18px">
    <label class="f">Ano<select id="fy">${yearOpts(ex, st.year)}</select></label>
    <label class="f">Área<select id="fa">${areaOpts(st.area)}</select></label>
    <label class="f">Idioma<select id="fl"></select></label>
    <label class="f">Nº da questão<input id="fn" type="number" min="1" style="width:110px"></label>
    <label class="f" style="flex:1">Palavra-chave<input id="ft" placeholder="Buscar no enunciado e alternativas"></label></div><div id="qbox"></div>`;
  const box = $('#qbox');
  const draw = () => {
    const l = list(), q = l[st.pos];
    if (!q) { box.innerHTML = empty('Nenhuma questão encontrada com esses filtros.'); return; }
    const k = q.year + '-' + q.index + '-' + q.language, ok = st.sel[k] === q.correctAlternative;
    box.innerHTML = `<div class="card"><p class="muted">Questão ${st.pos + 1} de ${l.length}</p>${questionHTML(q, st.sel[k], !!st.done[k])}
      ${st.done[k] ? `<div class="notice ${ok ? 'ok' : 'err'}" role="status">${ok ? 'Resposta correta!' : 'Resposta incorreta. A alternativa correta é a ' + q.correctAlternative + '.'}</div>` : ''}
      <div class="row between" style="margin-top:18px"><button class="btn soft" id="pv" ${st.pos === 0 ? 'disabled' : ''}>Anterior</button>
      <button class="btn" id="cf" ${!st.sel[k] || st.done[k] ? 'disabled' : ''}>Confirmar resposta</button>
      <button class="btn soft" id="nx" ${st.pos >= l.length - 1 ? 'disabled' : ''}>Próxima</button></div></div>`;
    box.querySelectorAll('[data-alt]').forEach((b) => b.onclick = () => { st.sel[k] = b.dataset.alt; draw(); });
    $('#pv').onclick = () => { st.pos--; draw(); }; $('#nx').onclick = () => { st.pos++; draw(); };
    $('#cf').onclick = () => { st.done[k] = true; addAnswers([{ year: q.year, index: q.index, discipline: q.discipline, correct: ok, src: 'questao' }]); draw(); };
  };
  const reload = async () => {
    st.pos = 0; box.innerHTML = loading('Carregando a prova (pode levar alguns segundos)...');
    const langs = (ex.find((e) => String(e.year) === st.year) || {}).languages || [];
    $('#fl').innerHTML = langOpts(langs, st.lang);
    try { st.data = await getAll(st.year, st.lang || undefined); draw(); } catch (e) { box.innerHTML = errBox(e.message); }
  };
  $('#fy').onchange = (e) => { st.year = e.target.value; st.lang = ''; reload(); };
  $('#fl').onchange = (e) => { st.lang = e.target.value; reload(); };
  $('#fa').onchange = (e) => { st.area = e.target.value; st.pos = 0; draw(); };
  $('#fn').oninput = (e) => { st.num = e.target.value; st.pos = 0; draw(); };
  $('#ft').oninput = (e) => { st.text = e.target.value; st.pos = 0; draw(); };
  icons(); reload();
}

let timer = null;
async function simulados() {
  clearInterval(timer);
  app.innerHTML = '<h1>Simulados</h1>' + loading();
  let ex; try { ex = await exams(); } catch (e) { app.innerHTML = '<h1>Simulados</h1>' + errBox(e.message); return; }
  const langsOf = (y) => (ex.find((e) => String(e.year) === String(y)) || {}).languages || [];
  app.innerHTML = `<h1>Simulados</h1><p class="muted">Monte um simulado com questões reais do ENEM e confira com o gabarito oficial.</p>
  <div class="card grid g3" style="margin:18px 0">
    <label class="f">Ano da prova<select id="sy">${yearOpts(ex, ex.at(-1).year)}</select></label>
    <label class="f">Área do conhecimento<select id="sa">${areaOpts('')}</select></label>
    <label class="f">Quantidade de questões<input id="sc" type="number" min="1" max="180" value="10"></label>
    <label class="f">Tipo<select id="st"><option value="aleatorio">Aleatório</option><option value="sequencial">Ordem da prova</option></select></label>
    <label class="f">Idioma (Linguagens)<select id="sl"></select></label></div><div id="smsg"></div><button class="btn" id="go">Iniciar simulado</button>`;
  $('#sl').innerHTML = langOpts(langsOf($('#sy').value), '');
  $('#sy').onchange = (e) => { $('#sl').innerHTML = langOpts(langsOf(e.target.value), ''); };
  $('#go').onclick = async () => {
    const year = $('#sy').value, area = $('#sa').value, count = Math.max(1, +$('#sc').value || 10), type = $('#st').value, lang = $('#sl').value;
    $('#smsg').innerHTML = loading('Buscando questões na API...'); $('#go').disabled = true;
    try {
      let all = (await getAll(year, lang || undefined)).filter((q) => !area || q.discipline === area);
      if (!all.length) throw new Error('Não há questões para essa combinação.');
      if (type === 'aleatorio') all = [...all].sort(() => Math.random() - 0.5);
      run(all.slice(0, count), { year, area });
    } catch (e) { $('#smsg').innerHTML = errBox(e.message); $('#go').disabled = false; }
  };
  icons();
}
function run(qs, cfg) {
  const ans = {}; let pos = 0, secs = 0;
  clearInterval(timer); timer = setInterval(() => { secs++; const t = $('#tm'); if (t) t.textContent = fmt(secs); else clearInterval(timer); }, 1000);
  const draw = () => {
    const n = Object.keys(ans).length;
    app.innerHTML = `<div class="row between"><h2>${qs.length} questões</h2><b id="tm">${fmt(secs)}</b></div>${bar(Math.round(n / qs.length * 100))}
    <p class="muted">${n} de ${qs.length} respondidas</p>
    <div class="qnums">${qs.map((_, i) => `<button data-n="${i}" class="${i === pos ? 'cur' : ans[i] ? 'done' : ''}" aria-label="Questão ${i + 1}">${i + 1}</button>`).join('')}</div>
    <div class="card">${questionHTML(qs[pos], ans[pos], false)}
    <div class="row between" style="margin-top:16px"><button class="btn soft" id="pv" ${!pos ? 'disabled' : ''}>Anterior</button><button class="btn" id="fin">Finalizar</button><button class="btn soft" id="nx" ${pos === qs.length - 1 ? 'disabled' : ''}>Próxima</button></div></div>`;
    app.querySelectorAll('[data-alt]').forEach((b) => b.onclick = () => { ans[pos] = b.dataset.alt; draw(); });
    app.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { pos = +b.dataset.n; draw(); });
    $('#pv').onclick = () => { pos--; draw(); }; $('#nx').onclick = () => { pos++; draw(); };
    $('#fin').onclick = () => confirm('Finalizar o simulado agora?') && finish();
  };
  const finish = () => {
    clearInterval(timer);
    const rows = qs.map((q, i) => ({ q, a: ans[i], ok: ans[i] === q.correctAlternative })), hits = rows.filter((r) => r.ok).length, by = {};
    rows.forEach((r) => { const k = r.q.discipline || 'outras'; (by[k] = by[k] || { total: 0, hits: 0 }); by[k].total++; if (r.ok) by[k].hits++; });
    addAnswers(rows.filter((r) => r.a).map((r) => ({ year: r.q.year, index: r.q.index, discipline: r.q.discipline, correct: r.ok, src: 'simulado' })));
    addSim({ title: 'Simulado ' + cfg.year + (cfg.area ? ' · ' + short(areaLabel(cfg.area)) : ''), total: qs.length, hits, seconds: secs, byArea: by });
    const pct = Math.round(hits / qs.length * 100);
    app.innerHTML = `<h1>Resultado</h1><div class="grid g3">${[['Questões', qs.length], ['Acertos', hits], ['Erros', qs.length - hits], ['Aproveitamento', pct + '%'], ['Tempo', fmt(secs)]].map(([l, v]) => `<div class="card"><p class="muted">${l}</p><div class="stat">${v}</div></div>`).join('')}</div>
    <div class="card" style="margin:18px 0"><h2>Desempenho por área</h2>${Object.entries(by).map(([k, x]) => `<div style="margin:10px 0"><div class="row between"><span>${esc(areaLabel(k))}</span><span class="muted">${x.hits}/${x.total}</span></div>${bar(Math.round(x.hits / x.total * 100), 1)}</div>`).join('')}</div>
    <h2>Revisão</h2>${rows.map((r, i) => `<div class="card" style="margin-bottom:14px"><p><b>Questão ${i + 1}</b> — ${r.a ? (r.ok ? 'acertou' : 'marcou ' + r.a + ', correta: ' + r.q.correctAlternative) : 'não respondida, correta: ' + r.q.correctAlternative}</p>${questionHTML(r.q, r.a, true)}</div>`).join('')}
    <a class="btn" href="#/simulados">Novo simulado</a>`;
    scrollTo(0, 0);
  };
  draw();
}

function disciplinas() {
  app.innerHTML = `<h1>Disciplinas</h1><p class="muted">A API organiza as questões pelas quatro áreas do conhecimento; as matérias abaixo indicam o conteúdo de cada área.</p>
  <div class="grid g2" style="margin-top:20px">${AREAS.map((a) => `<div class="card"><div class="icon-bubble"><i data-lucide="${a.ic}"></i></div><h2>${a.l}</h2><p class="muted">${a.d}</p>
  <div class="chips" style="margin:12px 0 16px">${a.subs.map((s) => `<span class="chip">${s}</span>`).join('')}</div><a class="btn" href="#/questoes?area=${a.v}">Ver questões</a></div>`).join('')}</div>`;
}

async function provas() {
  app.innerHTML = '<h1>Provas anteriores</h1>' + loading();
  let ex; try { ex = await exams(); } catch (e) { app.innerHTML = '<h1>Provas anteriores</h1>' + errBox(e.message); return; }
  app.innerHTML = `<h1>Provas anteriores</h1><div class="grid g2">${ex.slice().reverse().map((e) => `<div class="card"><h2>${esc(e.title)}</h2>
  <div class="chips">${e.disciplines.map((d) => `<span class="chip">${short(d.label)}</span>`).join('')}</div>
  <div class="row" style="margin-top:14px"><a class="btn" href="#/questoes?year=${e.year}">Resolver prova</a><button class="btn soft" data-g="${e.year}">Ver gabarito</button></div><div id="g${e.year}"></div></div>`).join('')}</div>`;
  app.querySelectorAll('[data-g]').forEach((b) => b.onclick = async () => {
    const y = b.dataset.g, el = $('#g' + y);
    if (el.innerHTML) { el.innerHTML = ''; b.textContent = 'Ver gabarito'; return; }
    b.textContent = 'Ocultar gabarito'; el.innerHTML = loading('Carregando gabarito...');
    try {
      const all = await getAll(y), g = {}; all.forEach((q) => (g[q.discipline || 'outras'] = g[q.discipline || 'outras'] || []).push(q));
      el.innerHTML = Object.entries(g).map(([k, l]) => `<h3 style="margin-top:14px">${esc(areaLabel(k))}</h3><div class="chips">${l.map((q) => `<span class="chip">${q.index}${q.language ? ' (' + esc(q.language) + ')' : ''}: <b>${q.correctAlternative}</b></span>`).join('')}</div>`).join('');
    } catch (e) { el.innerHTML = errBox(e.message); }
  });
}

let charts = [];
function desempenho() {
  charts.forEach((c) => c.destroy()); charts = [];
  const s = summary(), d = s.d;
  app.innerHTML = `<h1>Meu desempenho</h1><p class="muted">Dados salvos apenas neste navegador, sem sincronização entre dispositivos.</p>
  <div class="grid g3" style="margin:18px 0">${[['Respondidas', s.total], ['Acertos', s.hits], ['Erros', s.errors], ['Aproveitamento', s.pct + '%']].map(([l, v]) => `<div class="card"><p class="muted">${l}</p><div class="stat">${v}</div></div>`).join('')}</div>
  ${s.total === 0 ? empty('Ainda não há dados. Resolva questões ou faça um simulado.') : `<div class="grid g2"><div class="card"><h2>Aproveitamento por área (%)</h2><canvas id="c1" height="200"></canvas></div>
  <div class="card"><h2>Evolução nos simulados (%)</h2>${d.simulados.length ? '<canvas id="c2" height="200"></canvas>' : empty('Conclua um simulado para ver a evolução.')}</div></div>`}
  <div class="card" style="margin-top:18px;overflow-x:auto"><h2>Histórico de simulados</h2>${d.simulados.length === 0 ? empty('Nenhum simulado realizado.') :
  `<table><thead><tr><th>Data</th><th>Simulado</th><th>Acertos</th><th>%</th><th>Tempo</th></tr></thead><tbody>${d.simulados.slice().reverse().map((x) => `<tr><td>${new Date(x.ts).toLocaleDateString('pt-BR')}</td><td>${esc(x.title)}</td><td>${x.hits}/${x.total}</td><td>${Math.round(x.hits / x.total * 100)}%</td><td>${fmt(x.seconds)}</td></tr>`).join('')}</tbody></table>`}</div>`;
  if (!window.Chart) return;
  const opt = { scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } };
  if ($('#c1')) charts.push(new Chart($('#c1'), { type: 'bar', data: { labels: AREAS.map((a) => a.l.split(' ')[0].replace(',', '')), datasets: [{ data: AREAS.map((a) => s.by[a.v] ? Math.round(s.by[a.v].hits / s.by[a.v].total * 100) : 0), backgroundColor: '#DFA1B3', borderRadius: 8 }] }, options: opt }));
  if ($('#c2')) charts.push(new Chart($('#c2'), { type: 'line', data: { labels: d.simulados.map((_, i) => i + 1), datasets: [{ data: d.simulados.map((x) => Math.round(x.hits / x.total * 100)), borderColor: '#85865A', backgroundColor: '#85865A', tension: .3 }] }, options: opt }));
}

function configuracoes() {
  app.innerHTML = `<h1>Configurações</h1><div class="card"><h2>Dados locais</h2><p class="muted">Seu progresso fica salvo somente neste navegador (localStorage).</p><button class="btn soft" id="clr">Apagar meu progresso</button><div id="cm"></div></div>`;
  $('#clr').onclick = () => { if (confirm('Apagar todo o histórico e desempenho?')) { save({ answers: [], simulados: [] }); $('#cm').innerHTML = '<p role="status" class="notice ok" style="margin-top:12px">Progresso apagado.</p>'; } };
}

/* ---------- roteador por hash ---------- */
function route() {
  clearInterval(timer);
  const [path, qs] = (location.hash.slice(1) || '/').split('?'), params = new URLSearchParams(qs || '');
  document.querySelectorAll('.nav').forEach((a) => a.classList.toggle('active', a.dataset.r === path));
  ({ '/': home, '/questoes': () => questoes(params), '/simulados': simulados, '/disciplinas': disciplinas, '/provas': provas, '/desempenho': desempenho, '/configuracoes': configuracoes }[path] || home)();
  icons(); scrollTo(0, 0);
}
addEventListener('hashchange', route);
addEventListener('DOMContentLoaded', route);