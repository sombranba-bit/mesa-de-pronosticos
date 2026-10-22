// ===== Interfaz: Mesa de Pronósticos =====
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayStr = d => new Date(d * 864e5).toISOString().slice(0, 10);
const dayES = d => { const [y, m, dd] = dayStr(d).split('-'); return `${dd}/${m}/${y}`; };
const toDay = s => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
const today = () => Math.floor(Date.now() / 864e5);
const pct = (x, d = 1) => (x * 100).toFixed(d).replace('.', ',') + '%';
const nf = (x, d = 2) => x.toFixed(d).replace('.', ',');
const tick = () => new Promise(r => setTimeout(r, 0));
const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// ---------- CSV ----------
function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const split = l => { const out = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const v = split(l), o = {}; head.forEach((h, i) => o[h] = v[i]); return o; });
}
const fdDate = s => { // dd/mm/yy, dd/mm/yyyy o yyyy-mm-dd
  if (!s) return null; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return toDay(s.slice(0, 10));
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return toDay(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
};
const fnum = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : null; };

// ---------- Datos: incrustados (página única) o ficheros publicados (GitHub Pages) ----------
async function loadJSON(id, url) {
  const t = $(id).textContent.trim();
  if (t && !t.startsWith('/*')) return JSON.parse(t);
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}

// ---------- Tablas ----------
// Mercados en tarjetas (una por grupo) con barra de probabilidad y cuota justa: se leen de un vistazo y aprovechan el ancho
function marketTable(el, groups, extra = '') {
  const card = g => `<section class="mkcard"><h4>${esc(g.title)}</h4><div class="mkhead"><span></span><span>Prob.</span><span>Cuota</span></div>${g.rows.map(r => {
    const fair = r.p > 0 ? (1 - (r.push || 0)) / r.p : Infinity, hi = r.p >= 0.7;
    return `<div class="mkrow${hi ? ' hi' : ''}"><span class="mk-l">${esc(r.label)}${r.push > 0.005 ? `<small>devolución ${pct(r.push, 0)}</small>` : ''}</span>
      <span class="mk-p"><i style="width:${Math.min(100, r.p * 100).toFixed(1)}%"></i><b>${pct(r.p)}</b></span><span class="mk-o">${isFinite(fair) && fair < 1000 ? nf(fair) : '—'}</span></div>`; }).join('')}</section>`;
  el.innerHTML = `<h3 class="sect">Todos los mercados <span class="note">· cuota = cuota justa · en verde, 70% o más</span></h3><div class="mkgrid">${groups.map(card).join('')}${extra}</div>`;
}
const emptyPick = (ico, t, sub) => `<div class="empty"><span class="empty-ico" aria-hidden="true">${ico}</span><b>${t}</b><span>${sub}</span></div>`;
const statBox = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
// Calibración: agrupa pronósticos {p, hit} por confianza
const BANDS = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]];
function calibTable(preds) {
  const rows = BANDS.map(([lo, hi]) => { const s = preds.filter(x => x.p >= lo && x.p < hi), n = s.length;
    return { lo, hi, n, p: n ? s.reduce((t, x) => t + x.p, 0) / n : 0, hit: n ? s.filter(x => x.hit).length / n : 0 }; });
  return `<div class="tablewrap"><table><thead><tr><th>Confianza</th><th class="num">Pronósticos</th><th class="num">Prob. media</th><th class="num">Se cumplieron</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${pct(r.lo, 0)}–${r.hi > 1 ? '100%' : pct(r.hi, 0)}</td><td class="num">${r.n}</td><td class="num">${r.n ? pct(r.p) : '—'}</td>
      <td class="num">${r.n ? `<span class="chip ${Math.abs(r.hit - r.p) < 0.05 ? 'pos' : 'warn'}">${pct(r.hit)}</span>` : '—'}</td></tr>`).join('')}
  </tbody></table></div><p class="note">Verde: lo que se cumplió está a menos de 5 puntos de lo pronosticado.</p>`;
}
const progress = (id, f) => { const el = $(id); el.hidden = f >= 1; el.firstElementChild.style.width = (f * 100).toFixed(1) + '%'; };
function fillSelect(sel, items, keep) { const v = keep ?? sel.value; sel.innerHTML = items.map(([val, txt]) => `<option value="${esc(val)}">${esc(txt)}</option>`).join(''); if (items.some(([x]) => String(x) === String(v))) sel.value = v; }

// ============================== FÚTBOL ==============================
let Fd, FB = [], FR = null;
const COUNTRY = { SP1: 'ES', SP2: 'ES', E0: 'EN', E1: 'EN', I1: 'IT', I2: 'IT', D1: 'DE', D2: 'DE', F1: 'FR', F2: 'FR', N1: 'NL', P1: 'PT', SC0: 'SC', SC1: 'SC', B1: 'BE', T1: 'TR', G1: 'GR' };
const FB_FIELDS = ['hth', 'hta', 'hc', 'ac', 'hy', 'ay', 'hr', 'ar', 'oH', 'oD', 'oA', 'oO', 'oU', 'hxg', 'axg', 'ref', 'hst', 'ast', 'il', 'im'];
let CE = null, IJ = null, NW = null, OD = null, CR = null;   // CR: escudos {equipo: url}
// ---- elementos gráficos: escudos (o iniciales), banderas por liga y emoji por deporte ----
const FLAG = { SP1: 'es', SP2: 'es', SP3: 'es', E0: 'gb-eng', E1: 'gb-eng', I1: 'it', I2: 'it', D1: 'de', D2: 'de', F1: 'fr', F2: 'fr', N1: 'nl', P1: 'pt',
  SC0: 'gb-sct', SC1: 'gb-sct', B1: 'be', T1: 'tr', G1: 'gr', UEFA: 'eu', nba: 'us', euroliga: 'eu', eurocup: 'eu', acb: 'es', lega: 'it', bbl: 'de', lnb: 'fr', gbl: 'gr', bsl: 'tr' };
// bandera a partir del nombre de competición de la fuente de cuotas («La Liga - Spain», «EPL», «NBA»…)
const flagOf = t => { const x = String(t || '').toLowerCase(); const c = [[/spain|la liga|segunda/, 'es'], [/epl|premier league|championship|england/, 'gb-eng'], [/scot/, 'gb-sct'], [/italy|serie a/, 'it'],
  [/germany|bundesliga/, 'de'], [/france|ligue/, 'fr'], [/netherlands|eredivisie/, 'nl'], [/portugal|primeira/, 'pt'], [/belgium/, 'be'], [/turkey|super lig/, 'tr'], [/greece/, 'gr'],
  [/champions|europa|conference|euroleague|uefa/, 'eu'], [/nba/, 'us']].find(([r]) => r.test(x)); return c ? `<img class="flag" src="https://flagcdn.com/w40/${c[1]}.png" alt="" loading="lazy" onerror="this.remove()">` : ''; };
const flag = (lg, size = '') => FLAG[lg] ? `<img class="flag ${size}" src="https://flagcdn.com/w40/${FLAG[lg]}.png" alt="" loading="lazy" onerror="this.remove()">` : '';
const sportIcon = sp => sp === 'futbol' ? '⚽' : sp === 'tenis' ? '🎾' : '🏀';
const initials = n => { const w = String(n).replace(/[.'’]/g, ' ').split(/\s+/).filter(x => x && !/^(c|f|cf|fc|cd|sd|ud|ad|ce|ue|rc|club|de|la|el|the|afc)$/i.test(x));
  return (w.length ? (w.length === 1 ? w[0].slice(0, 3) : w[0][0] + w[1][0]) : String(n).slice(0, 3)).toUpperCase(); };
const hue = n => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// el mismo club se escribe distinto según la fuente («Bayern» / «Bayern Munich», «Barça» / «FC Barcelona»): búsqueda tolerante
const normT = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ç/g, 'c').replace(/[.'’]/g, ' ')
  .split(/\s+/).filter(w => w && !/^(fc|cf|cd|sd|ud|ad|ac|as|sc|bc|kk|bk|club|de|la|the|afc|basket|basketball|baloncesto)$/.test(w)).join(' ').replace(/\bbarca\b/, 'barcelona');
// escudos separados por deporte (claves «b:» para baloncesto): así «Casademont Zaragoza» no coge el escudo del Real Zaragoza
const CRI = {};
const GENERIC = /^(real|city|united|sporting|athletic|atletico|olympique|racing|deportivo|union|dynamo|inter|stade|club|calcio|sport|basket|team)$/;
const crestUrl = (n, b) => {
  if (!CR) return null;
  const pre = b ? 'b:' : '';
  if (CR[pre + n]) return CR[pre + n];
  if (b && CR[n] && /\/nba\/|cortextech|euroleague/.test(CR[n])) return CR[n];   // escudos de baloncesto guardados por versiones antiguas
  if (!CRI[pre]) CRI[pre] = Object.entries(CR).filter(([k]) => b ? k.startsWith('b:') : !k.startsWith('b:')).map(([k, v]) => [normT(k.replace(/^b:/, '')), v]);
  const idx = CRI[pre], t = normT(n); if (!t) return null;
  const exact = idx.find(([k]) => k === t); if (exact) return exact[1];
  const inside = idx.filter(([k]) => k.length >= 4 && t.length >= 4 && (k.includes(t) || t.includes(k)));
  if (inside.length === 1) return inside[0][1];
  const tok = t.split(' ').filter(w => w.length >= 4 && !/^\d+$/.test(w) && !GENERIC.test(w));   // una palabra distintiva en común (la ciudad, p. ej.)
  const share = idx.filter(([k]) => k.split(' ').some(w => tok.includes(w)));
  return share.length === 1 ? share[0][1] : null;
};
const isB = sp => !!sp && (/^(b|nba|euroliga|eurocup|acb|lega|bbl|lnb|gbl|bsl)$/i.test(sp) || /nba|basket|euroleague|eurocup/i.test(sp));
const twoLines = (h, a, sp) => `<div class="tline">${crest(h, sp, 'md')}<span>${esc(h)}</span></div><div class="tline">${crest(a, sp, 'md')}<span>${esc(a)}</span></div>`;
const openAttr = m => `data-open="${esc(JSON.stringify([m.sport, m.league, m.home, m.away, m.ref || '']))}" role="button" tabindex="0"`;
const hhmm = m => m.noTime ? '—' : new Date(m.kickoff).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
// tarjeta compacta de un pronóstico (selección recomendada)
const bestLine = m => m.best ? `<div class="best">Mejor cuota <b>${nf(m.best.odds)}</b> en ${esc(m.best.book)} <span>· justa ${nf(1 / m.pick.p)}</span></div>` : '';
const pcard = (m, res) => `<div class="pcard" ${openAttr(m)}>
  <div class="pc-head">${flag(m.league)}<span>${esc(m.leagueName)}</span><span class="pc-time">${sportIcon(m.sport)} ${esc(hhmm(m))}</span></div>
  <div class="pc-body"><div class="pc-teams">${twoLines(m.home, m.away, m.sport)}</div><div class="pc-p"><b>${pct(m.pick.p, 0)}</b></div></div>
  <div class="pc-pick">${esc(m.pick.label)}${res(m)}</div>${bestLine(m)}
  ${m.why && m.why.length ? `<div class="pc-why">${esc(m.why.join(' · '))}</div>` : ''}</div>`;
const bindOpen = root => root.querySelectorAll('[data-open]').forEach(x => { const go = () => openMatch(...JSON.parse(x.dataset.open)); x.addEventListener('click', e => { if (e.target.closest('a')) return; go(); }); x.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); });
const vs = (h, a, sp) => `${crest(h, sp, 'md')}${esc(h)} – ${crest(a, sp, 'md')}${esc(a)}`, vsText = (m, sp) => { const p = String(m).split(' – '); return p.length === 2 ? vs(p[0], p[1], sp) : esc(m); };
const crest = (n, sp, size = '') => { const u = crestUrl(n, isB(sp)); return `<span class="crest ${size}" style="--h:${hue(n)}" aria-hidden="true"><b>${esc(initials(n))}</b>${u ? `<img src="${esc(u)}" alt="" loading="lazy" onload="this.parentNode.classList.add('ok')" onerror="this.remove()">` : ''}</span>`; };   // ratings de ClubElo, bajas, noticias y cuotas del día
function buildFB() {
  FB = Fd.date.map((d, k) => { const r = { d, div: Fd.divs[Fd.div[k]], h: Fd.teams[Fd.h[k]], a: Fd.teams[Fd.a[k]], hg: Fd.hg[k], ag: Fd.ag[k] };
    for (const f of FB_FIELDS) r[f] = Fd[f] ? Fd[f][k] : null; return r; });
  const seen = new Set(FB.map(r => r.d + '|' + r.h + '|' + r.a));
  for (const r of store.get('mc_fb_extra', [])) if (!seen.has(r.d + '|' + r.h + '|' + r.a)) { FB.push(r); seen.add(r.d + '|' + r.h + '|' + r.a); }
  FB.sort((a, b) => a.d - b.d);
  FR = M.footballRatings(FB); fbModelCache.clear();
}
const fbLast = div => { let m = 0; for (const r of FB) if (r.div === div && r.d > m) m = r.d; return m; };
const fbModelCache = new Map();
function fbModel(country, xi) {
  const rows = FB.filter(r => COUNTRY[r.div] === country), last = rows.length ? rows[rows.length - 1].d : 0, key = country + xi + last + rows.length;
  if (!fbModelCache.has(key)) fbModelCache.set(key, M.fitFootballSet(rows.filter(r => r.d >= last - 3 * 365), Math.max(last + 1, today()), xi));
  return fbModelCache.get(key);
}
function fbTeams(div) { // equipos cuyo último partido en su país fue en esta división
  const latest = new Map(); for (const r of FB) if (COUNTRY[r.div] === COUNTRY[div]) { latest.set(r.h, r); latest.set(r.a, r); }
  const cut = fbLast(div) - 400;
  return [...latest].filter(([, r]) => r.div === div && r.d >= cut).map(([t]) => t).sort((a, b) => a.localeCompare(b, 'es'));
}
function fbInitControls() {
  const divs = Fd.divs.map((d, i) => [d, Fd.divNames[i]]);
  fillSelect($('fbLeague'), [['', 'Elige una liga'], ...divs, ...(CE ? [['UEFA', 'Competiciones europeas (cualquier club, ClubElo)']] : [])], '');
  fillSelect($('stLeague'), divs, 'SP1');
  fillSelect($('btFbLeague'), [['ALL1', 'Todas las primeras divisiones'], ...divs], 'SP1');
  fbTeamsFill();
}
const CE_COUNTRY = { ESP: 'España', ENG: 'Inglaterra', ITA: 'Italia', GER: 'Alemania', FRA: 'Francia', POR: 'Portugal', NED: 'Países Bajos', BEL: 'Bélgica', TUR: 'Turquía', GRE: 'Grecia', SCO: 'Escocia' };
function fbTeamsFill(h, a) {
  const lgv = $('fbLeague').value, t = !lgv ? [] : lgv === 'UEFA'
    ? CE.clubs.slice().sort((x, y) => y[2] - x[2]).slice(0, 500).map(c => [c[0], `${c[0]} (${CE_COUNTRY[c[1]] || c[1]})`])
    : fbTeams($('fbLeague').value).map(x => [x, x]);
  const ph = [['', lgv ? 'Elige equipo' : 'Primero elige liga']];
  fillSelect($('fbHome'), [...ph, ...t], h ?? ''); fillSelect($('fbAway'), [...ph, ...t], a ?? '');
  $('fbHome').disabled = $('fbAway').disabled = !lgv;
  fbPredict();
}
// Bajas: multiplicadores aproximados de goles (ataque propio y goles que recibe el equipo)
const INJ_ATT = [[1, 'Sin bajas'], [0.95, 'Un titular (−5%)'], [0.9, 'Titular importante (−10%)'], [0.85, 'Máximo goleador (−15%)'], [0.78, 'Varias bajas clave (−22%)']];
const INJ_DEF = [[1, 'Sin bajas'], [1.05, 'Un titular (+5% en contra)'], [1.1, 'Portero o central clave (+10%)'], [1.18, 'Varias bajas clave (+18%)']];
let injKey = '';
function injReset(div, h, a) { // al cambiar de partido: propuesta automática según las bajas del día
  const key = `${div}|${h}|${a}`; if (key === injKey) return; injKey = key;
  const near = (v, opts) => opts.reduce((b, o) => Math.abs(o[0] - v) < Math.abs(b[0] - v) ? o : b)[0];
  const th = IJ && IJ.teams ? IJ.teams[`${div}|${h}`] : null, ta = IJ && IJ.teams ? IJ.teams[`${div}|${a}`] : null;
  fillSelect($('injAttH'), INJ_ATT.map(([v, l]) => [v, l]), near(th?.att ?? 1, INJ_ATT)); fillSelect($('injAttA'), INJ_ATT.map(([v, l]) => [v, l]), near(ta?.att ?? 1, INJ_ATT));
  fillSelect($('injDefH'), INJ_DEF.map(([v, l]) => [v, l]), 1); fillSelect($('injDefA'), INJ_DEF.map(([v, l]) => [v, l]), 1);
  const list = [[h, th], [a, ta]].filter(([, t]) => t && t.players.length);
  const nTot = list.reduce((s, [, t]) => s + t.players.length, 0);
  $('injCount').innerHTML = nTot ? `<span class="chip neg">${nTot} ${nTot === 1 ? 'baja' : 'bajas'}</span>` : '';
  $('injList').innerHTML = list.length ? `<div class="injgrid">${list.map(([n, t]) => `<div class="injteam"><div class="teamhead">${crest(n, 'futbol', 'md')}<b>${esc(n)}</b><span class="note">${t.players.length} ${t.players.length === 1 ? 'baja' : 'bajas'}</span></div>
      <ul class="injlist">${t.players.map(p => { const k = injType(p.type); return `<li><div class="inj-top"><b>${esc(p.name)}</b>${k ? `<span class="chip ${k[1]}">${k[0]}</span>` : ''}</div>${p.reason ? `<span class="inj-why">${esc(p.reason)}</span>` : ''}${p.share >= 0.05 ? `<span class="inj-why">${pct(p.share, 0)} de los goles y asistencias del equipo</span>` : ''}</li>`; }).join('')}</ul></div>`).join('')}</div>
      <p class="note">El ajuste de arriba es una propuesta automática según el peso de cada baja en goles y asistencias. Cámbialo si sabes más.</p>`
    : `<p class="note">${IJ && IJ.teams ? 'Sin bajas registradas para estos equipos.' : 'Sin datos automáticos de bajas: ajústalas a mano si las conoces.'}</p>`;
  if (list.length) $('fbInjBox').open = true;
}
function injType(t) {
  if (!t) return null;
  if (/sanci|suspend/i.test(t)) return ['Sancionado', 'warn'];
  if (/duda|questionable|doubt/i.test(t)) return [t.startsWith('Duda') ? esc(t) : 'Duda', 'warn'];
  return ['Baja', 'neg'];
}
function injAdj() {
  const v = id => +$(id).value || 1, adj = { h: v('injAttH') * v('injDefA'), a: v('injAttA') * v('injDefH') };
  return adj.h === 1 && adj.a === 1 ? null : adj;
}
function fbPredict() {
  const div = $('fbLeague').value, h = $('fbHome').value, a = $('fbAway').value, out = $('fbOut');
  $('fbInjBox').hidden = !(div && h && a && h !== a);
  if (!div || !h || !a) { out.innerHTML = emptyPick('⚽', 'Elige liga, equipo local y visitante', 'También puedes abrir cualquier partido desde «Próximos partidos» o desde la apuesta del día: se rellena solo.'); return; }
  if (h === a) { out.innerHTML = '<p class="note">Elige dos equipos distintos.</p>'; return; }
  injReset(div, h, a);
  const adj = injAdj(), uefa = div === 'UEFA';
  let P;
  if (uefa) { const elo = new Map(CE.clubs.map(c => [c[0], c[2]])); P = M.eloPredict(elo.get(h), elo.get(a), h, a, false, adj); }
  else P = M.footballPredict(fbModel(COUNTRY[div], +$('fbXi').value), FR.feat(h, a), h, a, adj);
  if (!P) { out.innerHTML = '<p class="note">No hay datos suficientes de uno de los equipos.</p>'; return; }
  const s = P.summary, last = uefa ? toDay(CE.date) : fbLast(div), stale = today() - last, pick = M.footballPick(s, h, a), mx = P.k.scores[0].p;
  let heat = '<div class="tablewrap"><table class="heat"><tr><td></td>' + [0, 1, 2, 3, 4, 5].map(y => `<td><b>${y}</b></td>`).join('') + '</tr>';
  for (let x = 0; x <= 5; x++) { heat += `<tr><td><b>${x}</b></td>`; for (let y = 0; y <= 5; y++) { const v = P.G.g[x][y]; heat += `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(v / mx * 45)}%, transparent)">${pct(v, 1)}</td>`; } heat += '</tr>'; }
  heat += '</table></div><p class="note">Filas: goles del local. Columnas: goles del visitante.</p>';
  out.innerHTML = `${uefa ? `<p class="note">Modelo europeo: Elo de ClubElo del ${dayES(last)} traducido a goles. Sin córners, tarjetas ni descanso.</p>` : ''}${adj ? '<p class="note"><span class="chip warn">Ajustado por bajas</span></p>' : ''}${stale > 21 ? `<p class="verdict">Datos ${uefa ? 'de ClubElo' : 'de esta liga'} hasta el ${dayES(last)}. Los pronósticos no tienen en cuenta lo jugado después.</p>` : ''}
    <div class="scoreline"><div class="team">${crest(h, 'futbol', 'xl')}<span>${esc(h)}</span></div><div class="mid">${nf(s.lam)} – ${nf(s.mu)}<small>goles esperados</small></div><div class="team">${crest(a, 'futbol', 'xl')}<span>${esc(a)}</span></div></div>
    <div class="stats">${statBox(`${pct(s.H, 0)} · ${pct(s.D, 0)} · ${pct(s.A, 0)}`, '1 · X · 2')}${statBox(pct(pick.p, 0), 'Pronóstico: ' + esc(pick.label))}${statBox(`${s.score.x}-${s.score.y}`, `marcador más probable (${pct(s.score.p, 0)})`)}${s.corners ? statBox(nf(s.corners, 1), 'córners esperados') : ''}${s.cards ? statBox(nf(s.cards, 1), 'tarjetas esperadas') : ''}</div>
    ${uefa ? '' : fbFicha(div, h, a)}${uefa ? '' : '<section class="block"><h3 class="sect">Árbitro</h3><div id="refBox"></div></section>'}
    <section class="block" id="fbMk"></section>`;
  marketTable($('fbMk'), P.groups, `<section class="mkcard"><h4>Marcador exacto</h4>${heat}</section>`);
  if (!uefa) refRender(div);
}

// ---------- Ficha de partido ----------
const resChip = (gf, ga) => gf > ga ? '<span class="chip pos">G</span>' : gf === ga ? '<span class="chip warn">E</span>' : '<span class="chip neg">P</span>';
const signed = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d).replace('.', ',');
function lastGames(rows, t, n, keyH = 'hg', keyA = 'ag') {
  const out = []; for (let k = rows.length - 1; k >= 0 && out.length < n; k--) { const r = rows[k]; if (r.h === t || r.a === t) out.push(r); }
  return out.map(r => { const home = r.h === t, gf = home ? r[keyH] : r[keyA], ga = home ? r[keyA] : r[keyH]; return { r, home, gf, ga, opp: home ? r.a : r.h }; });
}
function formTable(title, games, sp) {
  const pts = games.reduce((s, g) => s + (g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0), 0);
  return `<div style="min-width:0"><div class="teamhead">${crest(title, sp || 'futbol', 'md')}<b>${esc(title)}</b>${sp === 'b' ? '' : `<span class="note">${pts} de ${games.length * 3} puntos</span>`}</div><div class="tablewrap"><table><tbody>
    ${games.map(g => `<tr><td>${dayES(g.r.d)}</td><td>${g.home ? 'vs' : 'en'} ${crest(g.opp, sp, 'md')}${esc(g.opp)}</td><td class="num">${g.gf}-${g.ga}</td><td>${resChip(g.gf, g.ga)}</td></tr>`).join('') || '<tr><td>Sin partidos</td></tr>'}
  </tbody></table></div></div>`;
}
function h2hTable(rows, h, a, keyH = 'hg', keyA = 'ag', sp) {
  const m = rows.filter(r => (r.h === h && r.a === a) || (r.h === a && r.a === h)).slice(-6).reverse();
  if (!m.length) return '<p class="note">No se han enfrentado en los datos disponibles.</p>';
  const w = m.filter(r => (r.h === h ? r[keyH] > r[keyA] : r[keyA] > r[keyH])).length, l = m.filter(r => (r.h === a ? r[keyH] > r[keyA] : r[keyA] > r[keyH])).length;
  return `<p class="note">${esc(h)} ${w} · empates ${m.length - w - l} · ${esc(a)} ${l}</p><div class="tablewrap"><table><tbody>
    ${m.map(r => `<tr><td>${dayES(r.d)}</td><td style="width:100%"><div style="max-width:420px">${[[r.h, r[keyH], r[keyA]], [r.a, r[keyA], r[keyH]]].map(([t, g, o]) => `<div class="tline">${crest(t, sp, 'md')}<span${g > o ? '' : ' style="font-weight:400"'}>${esc(t)}</span><b class="sc">${g}</b></div>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function fbFicha(div, h, a) {
  const set = fbModel(COUNTRY[div], +$('fbXi').value), m = set.ft, ix = m.ix;
  const lg = FB.filter(r => COUNTRY[r.div] === COUNTRY[div]);
  // referencia: la media (geométrica) de los equipos de esta división, no la de todo el país
  const peers = fbTeams(div).filter(t => ix.has(t)), gm = k => Math.exp(peers.reduce((s, t) => s + Math.log(m[k][ix.get(t)]), 0) / peers.length);
  const ga = gm('att'), gd = gm('def');
  const rate = t => { const i = ix.get(t); return { att: m.att[i] / ga, def: m.def[i] / gd }; };
  const pctTxt = x => signed((x - 1) * 100) + '%';
  const xgAvg = t => { const g = lastGames(lg.filter(r => r.hxg != null), t, 8, 'hxg', 'axg'); return g.length >= 4 ? { f: g.reduce((s, x) => s + x.gf, 0) / g.length, c: g.reduce((s, x) => s + x.ga, 0) / g.length } : null; };
  const R = [rate(h), rate(a)], X = [xgAvg(h), xgAvg(a)], E = [FR.elo.get(h), FR.elo.get(a)];
  const tone = (x, good) => `<span class="chip ${Math.abs(x - 1) < 0.05 ? 'warn' : (x > 1) === good ? 'pos' : 'neg'}">${pctTxt(x)}</span>`;
  const row = (l, f, help) => `<tr><th scope="row">${l}${help ? `<small>${help}</small>` : ''}</th><td class="num">${f(0)}</td><td class="num">${f(1)}</td></tr>`;
  return `<section class="block"><h3 class="sect">Ficha del partido</h3>
      <div class="tablewrap"><table class="cmp"><thead><tr><th></th><th class="num">${crest(h, 'futbol', 'md')}<span class="tn">${esc(h)}</span></th><th class="num">${crest(a, 'futbol', 'md')}<span class="tn">${esc(a)}</span></th></tr></thead><tbody>
        ${row('Ataque', i => tone(R[i].att, true), 'goles marcados frente a un equipo medio de su liga')}
        ${row('Goles encajados', i => tone(R[i].def, false), 'menos es mejor')}
        ${E[0] && E[1] ? row('Elo', i => Math.round(E[i])) : ''}
        ${X[0] || X[1] ? row('xG a favor', i => X[i] ? nf(X[i].f, 1) : '—', 'media de los últimos partidos') + row('xG en contra', i => X[i] ? nf(X[i].c, 1) : '—') : ''}
      </tbody></table></div>
      <p class="note">Ventaja de jugar en casa en esta liga: <b>${pctTxt(m.home)}</b> de goles.</p></section>
    <section class="block"><h3 class="sect">Forma reciente <span class="note">últimos 5 partidos</span></h3>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${formTable(h, lastGames(lg, h, 5))}${formTable(a, lastGames(lg, a, 5))}</div></section>
    <section class="block"><h3 class="sect">Enfrentamientos directos</h3>${h2hTable(lg, h, a)}</section>${newsBlock(div, h, a)}`;
}
function ago(iso) {
  const m = (Date.now() - Date.parse(iso)) / 60000; if (!isFinite(m)) return '';
  return m < 60 ? `hace ${Math.max(1, Math.round(m))} min` : m < 48 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}
function newsBlock(div, h, a) {
  const items = [[h, NW?.teams?.[`${div}|${h}`]], [a, NW?.teams?.[`${div}|${a}`]]].filter(([, v]) => v && v.length);
  const head = '<h3 class="sect">Noticias <span class="note">últimas 48 horas</span></h3>';
  if (!items.length) return NW ? `<section class="block">${head}<p class="note">Sin titulares relevantes de estos equipos.</p></section>` : '';
  return `<section class="block">${head}<div class="injgrid">${items.map(([t, v]) => `<div class="injteam"><div class="teamhead">${crest(t, 'futbol', 'md')}<b>${esc(t)}</b></div><ul class="newslist">${v.map(n =>
    `<li>${n.tags && n.tags.length ? `<div class="nw-tags">${n.tags.map(x => `<span class="chip warn">${esc(x)}</span>`).join('')}</div>` : ''}<a class="nw-title" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><span class="nw-meta">${[n.source && esc(n.source), n.date && ago(n.date)].filter(Boolean).join(' · ')}</span></li>`).join('')}</ul></div>`).join('')}</div></section>`;
}

// ---------- Árbitro: ¿es tarjetero? (informativo; no cambia el pronóstico) ----------
let refSel = '', refFor = '', refHint = '', refDesig = '';
const cardsOf = r => r.hy != null ? r.hy + r.ay + (r.hr || 0) + (r.ar || 0) : null;
function refRender(div) {
  const box = $('refBox'); if (!box) return;
  const since = today() - 2 * 365, lg = FB.filter(r => COUNTRY[r.div] === COUNTRY[div] && r.d >= since && cardsOf(r) != null);
  const refs = new Map(); for (const r of lg) if (r.ref) refs.set(r.ref, (refs.get(r.ref) || 0) + 1);
  const mk = `${div}|${$('fbHome').value}|${$('fbAway').value}`;
  if (mk !== refFor) {   // partido nuevo: árbitro designado si ya se conoce
    refFor = mk; const m = PR && PR.matches ? PR.matches.find(m => m.sport === 'futbol' && m.home === $('fbHome').value && m.away === $('fbAway').value && m.ref) : null;
    refSel = m ? m.ref : refSel && refHint === mk ? refSel : ''; refDesig = m ? m.ref : refHint === mk ? refSel : '';
  }
  const known = refSel && refs.has(refSel) && refs.get(refSel) >= 5;
  if (!refs.size || (refSel && !known)) {
    box.innerHTML = (refSel ? `<p class="note">Árbitro designado: <b>${esc(refSel)}</b>. Todavía no hay suficientes partidos suyos en los datos para saber si es tarjetero.</p>` : '')
      + (refs.size ? '' : '<p class="note">Todavía no hay historial de árbitros para esta liga. Se va llenando solo con football-data.org (cada partido jugado guarda su árbitro); Inglaterra y Escocia lo traen de serie.</p>');
    if (!refs.size) return;
  }
  const list = [...refs].filter(([, n]) => n >= 5).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  let html = `<div class="row"><div class="field" style="max-width:280px"><label for="fbRef">Árbitro</label><select id="fbRef"><option value="">Elige árbitro</option>${list.map(([r, n]) => `<option value="${esc(r)}"${r === refSel ? ' selected' : ''}>${esc(r)} (${n})</option>`).join('')}</select></div></div>`;
  if (refDesig && refDesig === refSel && known) html = `<p class="note">Árbitro designado: <b>${esc(refDesig)}</b></p>` + html;
  if (refSel && refs.has(refSel)) {
    const mine = lg.filter(r => r.ref === refSel), avgL = lg.reduce((s, r) => s + cardsOf(r), 0) / lg.length, avgR = mine.reduce((s, r) => s + cardsOf(r), 0) / mine.length;
    const diff = avgR / avgL - 1, kind = diff >= 0.1 ? ['neg', 'Tarjetero'] : diff <= -0.1 ? ['pos', 'Permisivo'] : ['warn', 'En la media'];
    html += `<p class="note"><span class="chip ${kind[0]}">${kind[1]}</span> ${nf(avgR, 1)} tarjetas por partido en ${mine.length} partidos de los dos últimos años, frente a ${nf(avgL, 1)} de media en la liga (${signed(diff * 100)}%).</p>
      <div class="tablewrap"><table><tbody>${mine.slice(-5).reverse().map(r => `<tr><td>${dayES(r.d)}</td><td>${vs(r.h, r.a)}</td><td class="num">${cardsOf(r)} tarjetas</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Solo informativo: en la validación, ajustar las tarjetas por el árbitro no mejoraba el pronóstico.</p>`;
  }
  box.innerHTML = (refSel && !known ? box.innerHTML : '') + html;
  $('fbRef').addEventListener('change', e => { refSel = e.target.value; refRender(div); });
}

// Estadísticas por equipo (tendencias de los últimos partidos)
let stSort = { k: 'o25', dir: -1 };
function fbStats() {
  const div = $('stLeague').value, N = +$('stN').value, side = $('stSide').value, teams = fbTeams(div), rows = [];
  for (const t of teams) {
    const ms = FB.filter(r => r.div === div && ((side !== 'away' && r.h === t) || (side !== 'home' && r.a === t))).slice(-N);
    if (!ms.length) continue;
    const gf = ms.map(r => r.h === t ? r.hg : r.ag), ga = ms.map(r => r.h === t ? r.ag : r.hg), n = ms.length;
    const avg = (f, list = ms) => { const v = list.map(f).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    rows.push({ t, n, gf: avg((_, i) => gf[i]), ga: avg((_, i) => ga[i]), o25: ms.filter(r => r.hg + r.ag > 2.5).length / n, btts: ms.filter(r => r.hg > 0 && r.ag > 0).length / n,
      cs: ga.filter(x => x === 0).length / n, win: ms.filter((r, i) => gf[i] > ga[i]).length / n,
      co: avg(r => r.hc != null ? r.hc + r.ac : null), ca: avg(r => r.hy != null ? r.hy + r.ay + (r.hr || 0) + (r.ar || 0) : null) });
  }
  rows.sort((a, b) => stSort.dir * ((a[stSort.k] ?? -1) - (b[stSort.k] ?? -1)));
  const cols = [['t', 'Equipo'], ['n', 'PJ'], ['win', 'Victorias'], ['gf', 'Goles a favor'], ['ga', 'Goles en contra'], ['o25', 'Más de 2,5'], ['btts', 'Ambos marcan'], ['cs', 'Portería a cero'], ['co', 'Córners'], ['ca', 'Tarjetas']];
  const f = (k, v) => v == null ? '—' : ['win', 'o25', 'btts', 'cs'].includes(k) ? pct(v, 0) : ['gf', 'ga', 'co', 'ca'].includes(k) ? nf(v, 1) : v;
  $('stOut').innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map(([k, l]) => `<th class="sortable ${k === 't' ? '' : 'num'}" data-k="${k}">${l}${stSort.k === k ? (stSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr>${cols.map(([k]) => `<td class="${k === 't' ? '' : 'num'}">${k === 't' ? esc(r.t) : f(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="note">Medias por partido de los últimos ${N} partidos de liga de cada equipo. Pulsa una columna para ordenar. Córners y tarjetas suman los de ambos equipos.</p>`;
  $('stOut').querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; stSort = { k, dir: stSort.k === k ? -stSort.dir : (k === 't' ? 1 : -1) }; fbStats(); }));
}

async function fbBacktest() {
  const sel = $('btFbLeague').value, from = toDay($('btFbFrom').value), xi = +$('fbXi').value;
  const divs = sel === 'ALL1' ? ['SP1', 'E0', 'I1', 'D1', 'F1', 'N1', 'P1'] : [sel];
  const idx = new Map(FB.map((r, k) => [r, k])), res = []; $('btFbRun').disabled = true;
  let total = 0, done = 0; const plan = [];
  for (const div of divs) {
    const weeks = new Map();
    for (const r of FB) if (r.div === div && r.d >= from) { const w = Math.floor((r.d - 4) / 7); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(r); }
    plan.push({ div, weeks }); total += weeks.size;
  }
  for (const { div, weeks } of plan) {
    const crow = FB.filter(r => COUNTRY[r.div] === COUNTRY[div]);
    for (const block of weeks.values()) {
      const ref = Math.min(...block.map(r => r.d)), m = M.fitDC(crow.filter(r => r.d < ref && r.d >= ref - 3 * 365), ref, xi);
      for (const r of block) { const G0 = M.dcGrid(m, r.h, r.a); if (!G0) continue;
        const k0 = M.footballMarkets(G0), e = M.ensemble1x2([k0.H, k0.D, k0.A], FR.pre[idx.get(r)]), k = M.footballMarkets(M.rescaleGrid(G0, e));
        res.push({ r, p: e, o25: k.over(2.5), btts: k.btts }); }
      if (++done % 4 === 0) { progress('btFbProg', done / total); await tick(); }
    }
  }
  progress('btFbProg', 1); $('btFbRun').disabled = false;
  if (!res.length) { $('btFbOut').innerHTML = '<p class="note">No hay partidos en ese periodo.</p>'; return; }
  const fav = [], ou = [], bt = [], picks = []; let ll = 0, nm = 0, mkHit = 0, mkLL = 0;
  for (const { r, p, o25, btts } of res) {
    const y = r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2, i = p.indexOf(Math.max(...p)), go = r.hg + r.ag > 2.5, bb = r.hg > 0 && r.ag > 0;
    fav.push({ p: p[i], hit: i === y }); ll -= Math.log(p[y]);
    ou.push({ p: Math.max(o25, 1 - o25), hit: (o25 > 0.5) === go }); bt.push({ p: Math.max(btts, 1 - btts), hit: (btts > 0.5) === bb });
    const pk = [[p[0], y === 0], [p[1], y === 1], [p[2], y === 2], [o25, go], [1 - o25, !go], [btts, bb], [1 - btts, !bb]].reduce((b, x) => x[0] > b[0] ? x : b);
    picks.push({ p: pk[0], hit: pk[1] });
    if (r.oH && r.oD && r.oA) { const q = M.fairProbs([r.oH, r.oD, r.oA]); mkHit += q.indexOf(Math.max(...q)) === y; mkLL -= Math.log(q[y]); nm++; }
  }
  const rate = a => a.filter(x => x.hit).length / a.length, n = res.length;
  const hiConf = picks.filter(x => x.p >= 0.65);
  $('btFbOut').innerHTML = `
    <div class="stats">${statBox(n, 'partidos pronosticados')}${statBox(pct(rate(fav)), 'acierto 1X2 (favorito del modelo)')}${nm ? statBox(pct(mkHit / nm), 'acierto 1X2 del favorito de las casas') : ''}${statBox(pct(rate(ou)), 'acierto más/menos 2,5')}${statBox(pct(rate(bt)), 'acierto ambos marcan')}${statBox(hiConf.length ? pct(rate(hiConf)) : '—', `pronósticos de 65% o más (${hiConf.length})`)}</div>
    ${nm ? `<p class="note">Log-loss 1X2 (cuanto más bajo, mejor): modelo ${nf(ll / n, 4)}, casas de apuestas ${nf(mkLL / nm, 4)}. Las casas siguen pronosticando algo mejor.</p>` : ''}
    <h3>¿Se cumple lo que dice el modelo? (pronóstico principal de cada partido)</h3>${calibTable(picks)}
    <h3>Favorito 1X2</h3>${calibTable(fav)}`;
}

$('fbFile').addEventListener('change', async e => {
  const extra = store.get('mc_fb_extra', []), have = new Set(FB.map(r => r.d + '|' + r.h + '|' + r.a)); let added = 0, skipped = 0;
  for (const f of e.target.files) {
    for (const o of parseCSV(await f.text())) {
      const div = o.Div, d = fdDate(o.Date), hg = fnum(o.FTHG), ag = fnum(o.FTAG);
      if (!COUNTRY[div] || d == null || hg == null || ag == null || !o.HomeTeam) { skipped++; continue; }
      const r = { d, div, h: o.HomeTeam, a: o.AwayTeam, hg, ag, hth: fnum(o.HTHG), hta: fnum(o.HTAG), hc: fnum(o.HC), ac: fnum(o.AC), hy: fnum(o.HY), ay: fnum(o.AY), hr: fnum(o.HR), ar: fnum(o.AR),
        oH: fnum(o.B365H), oD: fnum(o.B365D), oA: fnum(o.B365A), oO: fnum(o['B365>2.5']), oU: fnum(o['B365<2.5']) };
      const key = r.d + '|' + r.h + '|' + r.a; if (have.has(key)) continue;
      have.add(key); extra.push(r); added++;
    }
  }
  const saved = store.set('mc_fb_extra', extra); buildFB(); fbTeamsFill(); headerInfo();
  $('fbFileOut').textContent = `${added} partidos nuevos añadidos${skipped ? `, ${skipped} filas ignoradas` : ''}.${saved ? '' : ' Este navegador no permite guardarlos: se perderán al cerrar la página.'}`;
});

// ============================== BALONCESTO (NBA y Euroliga) ==============================
const BK = { nba: { raw: null, rows: [], name: 'NBA' }, euroliga: { raw: null, rows: [], name: 'Euroliga' } };
function bkCompsFill() {
  fillSelect($('nbComp'), Object.entries(BK).map(([k, v]) => [k, v.rows.length ? v.name : `${v.name} (sin datos todavía)`]), $('nbComp').value || 'nba');
}
const BK_XI = 0.01;
function buildBK(c) {
  const D = BK[c].raw; if (!D) { BK[c].rows = []; return; }
  const rows = D.date.map((d, k) => ({ d, h: D.teams[D.h[k]], a: D.teams[D.a[k]], hp: D.hp[k], ap: D.ap[k], ou: D.ou ? D.ou[k] : null }));
  const seen = new Set(rows.map(r => r.d + '|' + r.h + '|' + r.a));
  for (const r of store.get('mc_bk_extra_' + c, [])) if (!seen.has(r.d + '|' + r.h + '|' + r.a)) rows.push(r);
  BK[c].rows = rows.sort((a, b) => a.d - b.d); BK[c].cache = null;
}
function bkModel(c) {
  const B = BK[c], rows = B.rows, last = rows[rows.length - 1].d, key = last + '|' + rows.length;
  if (!B.cache || B.cache.key !== key) {
    const m = M.fitPts(rows.filter(r => r.d >= last - 500), Math.max(last + 1, today()), BK_XI);
    B.cache = { key, m, last, sd: c === 'nba' ? M.NBA_SD : M.ptsSD(m, rows) };
  }
  return B.cache;
}
function bkInit(h, a) {
  const c = $('nbComp').value, rows = BK[c].rows;
  if (!rows.length) { fillSelect($('nbHome'), []); fillSelect($('nbAway'), []); $('nbOut').innerHTML = '<p class="note">Todavía no hay datos de esta competición. La versión de GitHub los descarga sola.</p>'; return; }
  const t = [...new Set(rows.filter(r => r.d >= rows[rows.length - 1].d - 400).flatMap(r => [r.h, r.a]))].sort().map(x => [x, x]);
  fillSelect($('nbHome'), [['', 'Elige equipo'], ...t], h ?? ''); fillSelect($('nbAway'), [['', 'Elige equipo'], ...t], a ?? '');
  $('nbSpread').value = ''; $('nbTotal').value = '';
  bkPredict();
}
function bkPredict() {
  const c = $('nbComp').value, h = $('nbHome').value, a = $('nbAway').value, out = $('nbOut');
  if (!h || !a) { out.innerHTML = emptyPick('🏀', 'Elige equipo local y visitante', 'O abre un partido desde «Próximos partidos»: se rellena solo.'); return; }
  if (h === a) { out.innerHTML = '<p class="note">Elige dos equipos distintos.</p>'; return; }
  const { m, last, sd } = bkModel(c), L = fnum($('nbSpread').value), T = fnum($('nbTotal').value);
  const fat = c === 'nba' ? M.nbaFatigue(BK[c].rows, h, a, today()) : { adj: 0 };
  const P = M.basketPredict(m, sd, h, a, L, T, fat.adj); if (!P) { out.innerHTML = '<p class="note">No hay datos suficientes de uno de los equipos.</p>'; return; }
  const fatNote = fat.home && (fat.adj !== 0) ? `<p class="note"><span class="chip warn">Cansancio ${fat.adj > 0 ? '+' : '−'}${nf(Math.abs(fat.adj), 1)} pts para ${esc(h)}</span> ${esc(h)}: ${fat.home.rest === 1 ? 'segunda noche seguida' : fat.home.rest + ' días de descanso'}${fat.home.km > 100 ? `, ${Math.round(fat.home.km)} km de viaje` : ''} · ${esc(a)}: ${fat.away.rest === 1 ? 'segunda noche seguida' : fat.away.rest + ' días de descanso'}${fat.away.km > 100 ? `, ${Math.round(fat.away.km)} km de viaje` : ''}</p>` : '';
  $('nbSpread').placeholder = nf(P.line, 1); $('nbTotal').placeholder = nf(P.total, 1);
  const stale = today() - last;
  const rk = t => { const i = m.ix.get(t); return { off: m.off[i], de: m.de[i] }; }, rows = BK[c].rows;
  const rank = (t, f) => [...m.ix.keys()].filter(x => rows.some(r => r.d >= last - 200 && (r.h === x || r.a === x))).sort((x, y) => f(rk(y)) - f(rk(x))).indexOf(t) + 1;
  const tone = (x, rk) => `<span class="chip ${Math.abs(x) < 1 ? 'warn' : x > 0 ? 'pos' : 'neg'}" style="white-space:nowrap">${signed(x, 1)} · ${rk}</span>`;
  const row = (l, f, help) => `<tr><th scope="row">${l}${help ? `<small>${help}</small>` : ''}</th><td class="num">${f(h)}</td><td class="num">${f(a)}</td></tr>`;
  const ficha = `<section class="block"><h3 class="sect">Ficha del partido</h3>
      <div class="tablewrap"><table class="cmp"><thead><tr><th></th><th class="num">${crest(h, 'b', 'md')}<span class="tn">${esc(h)}</span></th><th class="num">${crest(a, 'b', 'md')}<span class="tn">${esc(a)}</span></th></tr></thead><tbody>
        ${row('Ataque', t => tone(rk(t).off, `${rank(t, r => r.off)}º`), 'puntos sobre la media de la liga')}
        ${row('Defensa', t => tone(rk(t).de, `${rank(t, r => r.de)}º`), 'positivo = encaja menos que la media')}
      </tbody></table></div>
      <p class="note">Ventaja de jugar en casa: <b>${signed(2 * m.hca, 1)} puntos</b>.</p></section>
    <section class="block"><h3 class="sect">Forma reciente <span class="note">últimos 5 partidos</span></h3>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${formTable(h, lastGames(rows, h, 5, 'hp', 'ap'), 'b')}${formTable(a, lastGames(rows, a, 5, 'hp', 'ap'), 'b')}</div></section>
    <section class="block"><h3 class="sect">Enfrentamientos directos</h3>${h2hTable(rows, h, a, 'hp', 'ap', 'b')}</section>`;
  out.innerHTML = `${stale > 30 ? `<p class="verdict">Resultados de ${BK[c].name} hasta el ${dayES(last)}. Los cambios de plantilla posteriores no están en el modelo.</p>` : ''}
    <div class="scoreline"><div class="team">${crest(h, 'b', 'xl')}<span>${esc(h)}</span></div><div class="mid">${Math.round(P.P.ph)} – ${Math.round(P.P.pa)}<small>puntos esperados</small></div><div class="team">${crest(a, 'b', 'xl')}<span>${esc(a)}</span></div></div>
    <div class="stats">${statBox(pct(Math.max(P.pw, 1 - P.pw), 0), 'Pronóstico: gana ' + esc(P.pw >= 0.5 ? h : a))}${statBox(nf(-P.P.margin, 1), `hándicap justo de ${esc(h)}`)}${statBox(nf(P.P.total, 1), 'puntos totales esperados')}${statBox('±' + nf(sd.margin, 1), 'dispersión típica del margen')}</div>
    ${fatNote}${ficha}<p class="note">Deja vacíos el hándicap y el total para usar las líneas justas del modelo, o escribe las que veas publicadas.</p>
    <section class="block" id="nbMk"></section>`;
  marketTable($('nbMk'), P.groups);
}
async function bkBacktest() {
  const c = $('nbComp').value, rows = BK[c].rows, from = toDay($('btNbFrom').value);
  if (!rows.length) { $('btNbOut').innerHTML = '<p class="note">No hay datos de esta competición.</p>'; return; }
  const days = [...new Set(rows.filter(r => r.d >= from).map(r => r.d))]; $('btNbRun').disabled = true;
  const res = [], sd = c === 'nba' ? M.NBA_SD : bkModel(c).sd;
  for (let i = 0; i < days.length; i++) {
    const d = days[i], m = M.fitPts(rows.filter(r => r.d < d && r.d >= d - 500), d, BK_XI);
    for (const r of rows) if (r.d === d) { const P = M.ptsPredict(m, r.h, r.a); if (!P) continue;
      if (c === 'nba') P.margin += M.nbaFatigue(rows, r.h, r.a, d).adj;   // mismo ajuste por cansancio que en los pronósticos
      res.push({ r, P }); }
    if (i % 10 === 0) { progress('btNbProg', i / days.length); await tick(); }
  }
  progress('btNbProg', 1); $('btNbRun').disabled = false;
  if (!res.length) { $('btNbOut').innerHTML = '<p class="note">No hay partidos en ese periodo.</p>'; return; }
  const fav = []; let maeM = 0, maeT = 0, maeL = 0, nl = 0, ouHit = 0, ouN = 0;
  for (const { r, P } of res) {
    const pw = 1 - M.normCdf(-P.margin / sd.margin), y = r.hp > r.ap; fav.push({ p: Math.max(pw, 1 - pw), hit: (pw > 0.5) === y });
    maeM += Math.abs(r.hp - r.ap - P.margin); maeT += Math.abs(r.hp + r.ap - P.total);
    if (r.ou) { const t = r.hp + r.ap; nl++; maeL += Math.abs(t - r.ou); if (t !== r.ou && Math.abs(P.total - r.ou) >= 1) { ouN++; ouHit += (P.total > r.ou) === (t > r.ou); } }
  }
  const n = res.length;
  $('btNbOut').innerHTML = `
    <div class="stats">${statBox(n, 'partidos pronosticados')}${statBox(pct(fav.filter(x => x.hit).length / n), 'acierto del ganador')}${statBox(nf(maeM / n, 1), 'error medio del margen (puntos)')}${statBox(nf(maeT / n, 1), 'error medio del total (puntos)')}${nl ? statBox(nf(maeL / nl, 1), 'error medio de la línea de las casas') : ''}${ouN ? statBox(pct(ouHit / ouN), 'acierto más/menos frente a la línea') : ''}</div>
    ${nl ? `<p class="note">Con cuotas habituales de 1,91 hace falta acertar más del 52,4% en más/menos para no perder dinero.</p>` : ''}
    <h3>¿Se cumple lo que dice el modelo? (ganador)</h3>${calibTable(fav)}`;
}
$('nbFile').addEventListener('change', async e => {
  const c = $('nbComp').value, extra = store.get('mc_bk_extra_' + c, []), have = new Set(BK[c].rows.map(r => r.d + '|' + r.h + '|' + r.a)); let added = 0, skipped = 0;
  for (const o of parseCSV(await e.target.files[0].text())) {
    const d = fdDate(o.fecha), hp = fnum(o.pts_local), ap = fnum(o.pts_visitante);
    if (d == null || hp == null || ap == null || !o.local || !o.visitante) { skipped++; continue; }
    const r = { d, h: o.local, a: o.visitante, hp, ap, ou: null }, key = r.d + '|' + r.h + '|' + r.a;
    if (have.has(key)) continue; have.add(key); extra.push(r); added++;
  }
  if (!BK[c].raw) BK[c].raw = { date: [], teams: [], h: [], a: [], hp: [], ap: [] };
  const saved = store.set('mc_bk_extra_' + c, extra); buildBK(c); bkInit(); headerInfo();
  $('nbFileOut').textContent = `${added} partidos añadidos a ${BK[c].name}${skipped ? `, ${skipped} filas ignoradas` : ''}.${saved ? '' : ' Este navegador no permite guardarlos.'}`;
});

// ============================== TENIS ==============================
let Td, ELO = null;
function appendTennis(rows) { // filas importadas -> columnas
  const pix = new Map(Td.players.map((p, i) => [p, i])), last = Td.date[Td.date.length - 1];
  const have = new Set(Td.date.map((d, k) => d + '|' + Td.w[k] + '|' + Td.l[k]).filter((_, k) => Td.date[k] >= last - 30));
  let added = 0;
  for (const r of rows.sort((a, b) => a.d - b.d)) {
    if (r.d < last - 30) continue;
    for (const n of [r.w, r.l]) if (!pix.has(n)) { pix.set(n, Td.players.length); Td.players.push(n); }
    const key = r.d + '|' + pix.get(r.w) + '|' + pix.get(r.l); if (have.has(key)) continue; have.add(key);
    Td.date.push(r.d); Td.tour.push(r.tour); Td.surf.push(r.surf); Td.bo.push(r.bo); Td.completed.push(r.completed);
    Td.w.push(pix.get(r.w)); Td.l.push(pix.get(r.l)); Td.tourn.push(0);
    ['W1', 'L1', 'W2', 'L2', 'W3', 'L3', 'W4', 'L4', 'W5', 'L5'].forEach(c => Td[c].push(r[c] ?? null));
    for (const c of ['bW', 'bL', 'pW', 'pL', 'mW', 'mL']) Td[c].push(r[c] ?? null);
    added++;
  }
  return added;
}
const BASE_SERVE = [[0.64, 0.61, 0.67, 0.65], [0.56, 0.54, 0.58, 0.57]]; // circuito x superficie (pista, tierra, hierba, moqueta)
function tnRefresh() {
  ELO = M.runElo(Td, { from: Infinity });
  const tour = +$('tnTour').value, lastDay = Td.date[Td.date.length - 1], recent = new Set();
  for (let k = Td.date.length - 1; k >= 0 && Td.date[k] >= lastDay - 540; k--) if (Td.tour[k] === tour) { recent.add(Td.w[k]); recent.add(Td.l[k]); }
  const list = [...recent].filter(i => ELO.N[i] >= 10).sort((a, b) => ELO.R[b] - ELO.R[a]);
  $('tnList').innerHTML = list.map(i => `<option value="${esc(Td.players[i])}">`).join('');
  if (!list.map(i => Td.players[i]).includes($('tnA').value)) { $('tnA').value = Td.players[list[0]] || ''; $('tnB').value = Td.players[list[1]] || ''; }
  tnPredict();
}
function tnPredict() {
  const out = $('tnOut'), ia = Td.players.indexOf($('tnA').value.trim()), ib = Td.players.indexOf($('tnB').value.trim());
  if (ia < 0 || ib < 0) { out.innerHTML = '<p class="note">Escribe dos jugadores de la lista (formato «Apellido N.»).</p>'; return; }
  if (ia === ib) { out.innerHTML = '<p class="note">Elige dos jugadores distintos.</p>'; return; }
  const s = +$('tnSurf').value, bo = +$('tnBo').value, tour = +$('tnTour').value, A = Td.players[ia], B = Td.players[ib];
  const p3 = M.eloProb(ELO, ia, ib, s), p = bo === 5 ? M.bo3to5(p3) : p3;
  const T = M.tennisFromProb(p, bo, BASE_SERVE[tour][s]), dist = T.dist, X = M.tennisExtras(T.pa, T.pb, dist);
  const P = f => M.sum(dist.filter(f).map(x => x.p));
  const need = bo === 5 ? 3 : 2, setRows = [];
  for (let l = 0; l < need; l++) setRows.push({ key: `s${need}${l}`, label: `${A} ${need}-${l}`, p: P(x => x.sa === need && x.sb === l) });
  for (let w = need - 1; w >= 0; w--) setRows.push({ key: `s${w}${need}`, label: `${B} ${need}-${w}`, p: P(x => x.sb === need && x.sa === w) });
  const tg = dist.map(x => ({ t: x.ga + x.gb, df: x.ga - x.gb, p: x.p }));
  const median = arr => { const s2 = [...arr].sort((a, b) => a.v - b.v); let c = 0; for (const x of s2) { c += x.p; if (c >= 0.5) return x.v; } return 0; };
  const mt = median(tg.map(x => ({ v: x.t, p: x.p }))), md = median(tg.map(x => ({ v: x.df, p: x.p })));
  const gRows = [], hRows = [];
  for (let l = Math.floor(mt) - 2.5; l <= mt + 2.5; l++) { const o = M.sum(tg.filter(x => x.t > l).map(x => x.p)); gRows.push({ key: 'g' + l, label: `Más de ${nf(l, 1)} juegos`, p: o }, { key: 'gu' + l, label: `Menos de ${nf(l, 1)} juegos`, p: 1 - o }); }
  for (let l = Math.round(-md) - 2.5; l <= Math.round(-md) + 2.5; l++) { const o = M.sum(tg.filter(x => x.df + l > 0).map(x => x.p)); hRows.push({ key: 'h' + l, label: `${A} ${l > 0 ? '+' : ''}${nf(l, 1)} juegos`, p: o }, { key: 'hb' + l, label: `${B} ${-l > 0 ? '+' : ''}${nf(-l, 1)} juegos`, p: 1 - o }); }
  const setH = [{ label: `${A} −1,5 sets`, p: P(x => x.sa - x.sb >= 2) }, { label: `${B} +1,5 sets`, p: 1 - P(x => x.sa - x.sb >= 2) },
    { label: `${B} −1,5 sets`, p: P(x => x.sb - x.sa >= 2) }, { label: `${A} +1,5 sets`, p: 1 - P(x => x.sb - x.sa >= 2) }];
  const totSets = bo === 5 ? [3.5, 4.5] : [2.5];
  const eg = M.sum(tg.map(x => x.t * x.p)), few = Math.min(ELO.NS[s][ia], ELO.NS[s][ib]);
  out.innerHTML = `<div class="scoreline"><div class="team">${esc(A)}</div><div class="mid">${pct(p, 0)} – ${pct(1 - p, 0)}<small>probabilidad de ganar</small></div><div class="team">${esc(B)}</div></div>
    <p class="note">Elo ${Math.round(ELO.R[ia])} / ${Math.round(ELO.R[ib])} · en ${['pista dura', 'tierra', 'hierba', 'moqueta'][s]} ${Math.round(ELO.S[s][ia])} / ${Math.round(ELO.S[s][ib])} · puntos ganados al saque ${pct(T.pa, 0)} / ${pct(T.pb, 0)} · ${nf(eg, 1)} juegos esperados${few < 15 ? ' · <span class="chip warn">pocos partidos en esta superficie</span>' : ''}</p>
    <div id="tnMk"></div>`;
  marketTable($('tnMk'), [
    { title: 'Ganador', rows: [{ label: A, p }, { label: B, p: 1 - p }] },
    { title: 'Primer set', rows: [{ label: `${A} gana el 1er set`, p: X.firstSetA }, { label: `${B} gana el 1er set`, p: 1 - X.firstSetA }, ...[8.5, 9.5, 10.5].flatMap(l => [{ label: `1er set: más de ${nf(l, 1)} juegos`, p: X.set1Over(l) }, { label: `1er set: menos de ${nf(l, 1)} juegos`, p: 1 - X.set1Over(l) }])] },
    { title: 'Resultado en sets', rows: setRows },
    { title: 'Hándicap de sets', rows: setH },
    { title: 'Total de sets', rows: totSets.flatMap(l => [{ label: `Más de ${nf(l, 1)} sets`, p: P(x => x.sa + x.sb > l) }, { label: `Menos de ${nf(l, 1)} sets`, p: P(x => x.sa + x.sb < l) }]) },
    { title: 'Tie-break', rows: [{ label: 'Habrá al menos un tie-break', p: X.tieBreak }, { label: 'No habrá tie-break', p: 1 - X.tieBreak }] },
    { title: 'Total de juegos', rows: gRows }, { title: 'Hándicap de juegos', rows: hRows }]);
}
function tnBacktest() {
  const tour = +$('btTnTour').value, from = toDay($('btTnFrom').value), E = M.runElo(Td, { from });
  const fav = []; let mk = 0, nm = 0;
  for (const { k, p } of E.preds) {
    if (tour >= 0 && Td.tour[k] !== tour) continue;
    fav.push({ p: Math.max(p, 1 - p), hit: p > 0.5 });   // el ganador real siempre es el jugador «w»
    if (Td.pW[k] > 1 && Td.pL[k] > 1) { nm++; mk += Td.pW[k] < Td.pL[k]; }
  }
  if (!fav.length) { $('btTnOut').innerHTML = '<p class="note">No hay partidos en ese periodo.</p>'; return; }
  const n = fav.length, hi = fav.filter(x => x.p >= 0.7);
  $('btTnOut').innerHTML = `
    <div class="stats">${statBox(n, 'partidos pronosticados')}${statBox(pct(fav.filter(x => x.hit).length / n), 'acierto del Elo')}${nm ? statBox(pct(mk / nm), 'acierto del favorito de las casas') : ''}${statBox(hi.length ? pct(hi.filter(x => x.hit).length / hi.length) : '—', `pronósticos de 70% o más (${hi.length})`)}</div>
    <h3>¿Se cumple lo que dice el modelo?</h3>${calibTable(fav)}`;
}
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel')); document.head.appendChild(s); });
}
$('tnFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return; let rows;
  try {
    if (/\.xlsx?$/i.test(f.name)) { await loadXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true }); }
    else rows = parseCSV(await f.text());
  } catch (err) { $('tnFileOut').textContent = `No se pudo leer el fichero: ${err.message}. Prueba a guardarlo como CSV.`; return; }
  const surf = { Hard: 0, Clay: 1, Grass: 2, Carpet: 3 }, out = [];
  for (const o of rows) {
    const d = o.Date instanceof Date ? Math.round(o.Date.getTime() / 864e5) : typeof o.Date === 'number' ? Math.round(o.Date - 25569) : fdDate(String(o.Date || ''));
    if (d == null || !o.Winner || !o.Loser) continue;
    const r = { d, tour: 'WTA' in o ? 1 : 0, surf: surf[o.Surface] ?? 0, bo: String(o['Best of']).startsWith('5') ? 5 : 3, completed: o.Comment === 'Completed' ? 1 : 0, w: String(o.Winner).trim(), l: String(o.Loser).trim(),
      bW: fnum(o.B365W), bL: fnum(o.B365L), pW: fnum(o.PSW), pL: fnum(o.PSL), mW: fnum(o.MaxW), mL: fnum(o.MaxL) };
    for (const c of ['W1', 'L1', 'W2', 'L2', 'W3', 'L3', 'W4', 'L4', 'W5', 'L5']) r[c] = fnum(o[c]);
    out.push(r);
  }
  const added = appendTennis(out.map(r => ({ ...r })));
  const saved = store.set('mc_tn_extra', store.get('mc_tn_extra', []).concat(out).slice(-20000));
  tnRefresh(); headerInfo();
  $('tnFileOut').textContent = `${added} partidos nuevos añadidos de ${out.length} leídos.${saved ? '' : ' Este navegador no permite guardarlos.'}`;
});

// ============================== PRONÓSTICOS AUTOMÁTICOS ==============================
let PR = null, PF = null;
const SPORT_NAME = { futbol: 'Fútbol', nba: 'NBA', euroliga: 'Euroliga', eurocup: 'EuroCup', acb: 'Liga ACB', lega: 'Lega A', bbl: 'BBL', lnb: 'Betclic Élite', gbl: 'Liga griega', bsl: 'Liga turca' };
// Apuesta del día y selección recomendada: las elige el proceso automático (pipeline/predict.mjs, dailyPicks)
function dailyRender() {
  const box = $('prDaily'), D = PR && PR.daily;
  if (!D || !D.bet) { box.innerHTML = '<h2>Apuesta del día</h2><p class="verdict">Aparece cuando la mesa funciona desde GitHub: cada hora elige el pronóstico más probable del día entre todos los deportes, y una selección con los más seguros.</p>'; return; }
  const dayTxt = new Date(D.day + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const when = m => m.noTime ? 'hora por confirmar' : new Date(m.kickoff).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const res = m => m.hit === undefined ? '' : ` <span class="chip ${m.hit ? 'pos' : 'neg'}">${m.hit ? 'Acierto' : 'Fallo'}</span>`;
  const open = m => `<button class="linkbtn" data-open="${esc(JSON.stringify([m.sport, m.league, m.home, m.away, m.ref || '']))}">Ver partido</button>`;
  const rate = o => o && o.n ? `${o.hits} de ${o.n} (${pct(o.hits / o.n, 0)})` : 'aún sin datos';
  const T = PF && PF.daily, b = D.bet, P = D.picks || [];
  let h = `<h2>Apuesta del día</h2><p class="note" style="margin:-8px 0 0">${esc(dayTxt)} · el pronóstico con más probabilidad de todos los deportes</p>
    <div class="mc" ${openAttr(b)}><div class="mc-head">${flag(b.league, 'lg')}<span>${esc(b.leagueName)}</span><span class="mc-sp">${sportIcon(b.sport)} ${esc(when(b))}</span></div>
      <div class="mc-body"><div class="mc-team">${crest(b.home, b.sport, 'xl')}<span>${esc(b.home)}</span></div>
        <div class="mc-mid"><div class="mc-p">${pct(b.pick.p, 0)}</div><div class="mc-pick">${esc(b.pick.label)}</div>${res(b)}${bestLine(b)}</div>
        <div class="mc-team">${crest(b.away, b.sport, 'xl')}<span>${esc(b.away)}</span></div></div>
      <div class="mc-foot">Toca para ver todos los mercados ›</div></div>
    ${b.why && b.why.length ? `<div class="whybox"><b>Por qué</b><ul class="why">${b.why.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
  if (P.length >= 2) {
    const all = P.reduce((x, m) => x * m.pick.p, 1);
    h += `<h3>Selección recomendada</h3><div class="pcards">${P.map(m => pcard(m, res)).join('')}</div>
      <div class="stats">${statBox(pct(all, 0), `acertar las ${P.length} juntas`)}${statBox(nf(1 / all, 2), 'cuota justa de la combinada')}</div>`;
  } else h += `<p class="note">Hoy no hay más pronósticos con un ${pct(0.65, 0)} o más para formar una selección.</p>`;
  h += `<p class="note">Seguimiento: apuesta del día ${rate(T && T.bet)} · selección ${rate(T && T.picks)} (detalle en «Aciertos»). Más probabilidad no significa más valor: compara la cuota justa con la de tu casa.</p>`;
  box.innerHTML = h; bindOpen(box);
}
const dayKey = m => { const t = new Date(m.kickoff); return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); };
function prRender() {
  dailyRender();
  const out = $('prOut');
  if (!PR || !PR.matches) { out.innerHTML = `<p class="verdict">Aquí aparecen los pronósticos de los próximos partidos cuando la mesa funciona desde GitHub, que los calcula sola cada hora. Mientras tanto, usa las pestañas de cada deporte para pronosticar el partido que quieras.</p>`; return; }
  // «Deporte» agrupa (fútbol, baloncesto, tenis); las ligas van en «Competición»
  const GROUP_NAME = { futbol: '⚽ Fútbol', baloncesto: '🏀 Baloncesto', tenis: '🎾 Tenis' };
  const group = m => m.sport === 'futbol' ? 'futbol' : m.sport === 'tenis' ? 'tenis' : 'baloncesto';
  fillSelect($('prSport'), [['', 'Todos'], ...Object.keys(GROUP_NAME).filter(g => PR.matches.some(m => group(m) === g)).map(g => [g, GROUP_NAME[g]])]);
  const sp = $('prSport').value, conf = +$('prConf').value, now = Date.now();
  const leagues = [...new Map(PR.matches.filter(m => !sp || group(m) === sp).map(m => [m.league, `${m.leagueName}`])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  fillSelect($('prLeague'), [['', 'Todas'], ...leagues]);
  const list = PR.matches.filter(m => (!sp || group(m) === sp) && (!$('prLeague').value || m.league === $('prLeague').value) && m.pick.p >= conf && Date.parse(m.kickoff) > now - 2 * 3600e3)
    .sort((a, b) => dayKey(a) - dayKey(b) || a.leagueName.localeCompare(b.leagueName, 'es') || Date.parse(a.kickoff) - Date.parse(b.kickoff));
  let html = `<p class="note">Calculados el ${new Date(PR.generated).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}. ${list.length} partidos.</p>`, cur = '', curL = '';
  for (const m of list.slice(0, 300)) {
    const t = new Date(m.kickoff), dkey = t.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    if (dkey !== cur) { cur = dkey; curL = ''; html += `<h3 class="daylabel">${esc(dkey)}</h3>`; }
    if (m.league !== curL) { curL = m.league; html += `<div class="lghead">${flag(m.league, 'lg')}<span>${esc(m.leagueName)}</span><span class="mc-sp">${sportIcon(m.sport)}</span></div>`; }
    const kv = (k, v) => `<span class="kv"><em>${k}</em><b>${v}</b></span>`;
    const probs = m.sport === 'futbol'
      ? `${kv('1 · X · 2', `${pct(m.H, 0)} · ${pct(m.D, 0)} · ${pct(m.A, 0)}`)}${kv('Más de 2,5', pct(m.o25, 0))}${kv('Ambos marcan', pct(m.btts, 0))}${kv('Goles esperados', `${nf(m.lam, 1)} – ${nf(m.mu, 1)}`)}${m.corners ? kv('Córners', nf(m.corners, 1)) : ''}${m.base ? kv('Sin bajas', `${pct(m.base.H, 0)} · ${pct(m.base.D, 0)} · ${pct(m.base.A, 0)}`) : ''}`
      : `${kv('Gana local', pct(m.pw, 0))}${kv('Puntos', `${Math.round(m.ph)} – ${Math.round(m.pa)}`)}${kv('Hándicap justo', nf(-m.margin, 1))}${kv('Total', nf(m.total, 1))}`;
    const bar = m.sport === 'futbol' ? `<div class="tribar" aria-hidden="true"><i style="width:${m.H * 100}%"></i><i style="width:${m.D * 100}%"></i><i style="width:${m.A * 100}%"></i></div>` : '';
    const nn = (NW?.teams?.[`${m.league}|${m.home}`]?.length || 0) + (NW?.teams?.[`${m.league}|${m.away}`]?.length || 0);
    const chips = (nn ? `<span class="chip warn">${nn} ${nn === 1 ? 'noticia' : 'noticias'}</span> ` : '') + (m.ref ? `<span class="chip">Árbitro: ${esc(m.ref)}</span> ` : '') + (m.best ? `<span class="chip pos">Mejor cuota ${nf(m.best.odds)} · ${esc(m.best.book)}</span> ` : '') + (m.injuries && m.injuries.length ? `<span class="chip warn">${m.injuries.length} bajas</span> ` : '') +
      (m.fatigue && (m.fatigue.b2bH || m.fatigue.b2bA) ? `<span class="chip warn">2ª noche seguida: ${esc(m.fatigue.b2bH ? m.home : m.away)}</span> ` : '');
    html += `<div class="mrow" ${openAttr(m)}><div class="mr-time">${m.noTime ? 'Por<br>confirmar' : esc(hhmm(m))}</div>
      <div class="mr-teams">${twoLines(m.home, m.away, m.sport)}${chips ? `<div class="mr-chips">${chips}</div>` : ''}</div>
      <div class="mr-p"><b>${pct(m.pick.p, 0)}</b><span>${esc(m.pick.label)}</span></div>
      ${bar}<div class="mr-probs">${probs}</div></div>`;
  }
  out.innerHTML = html; bindOpen(out);
}
function openMatch(sport, league, h, a, ref) {
  if (sport === 'futbol') { showTab('futbol'); $('fbLeague').value = league; injKey = ''; refSel = ref || ''; refHint = ref ? `${league}|${h}|${a}` : ''; fbTeamsFill(h, a); }
  else { showTab('baloncesto'); $('nbComp').value = sport; bkInit(h, a); }
  window.scrollTo({ top: 0 });
}
function acRender() {
  const out = $('acOut');
  if (!PF || !PF.sports) { out.innerHTML = '<p class="verdict">El seguimiento empieza cuando la mesa funciona desde GitHub: cada pronóstico se guarda antes del partido y se compara con el resultado. Para ver cómo habría acertado en el pasado, usa «Precisión histórica» en cada deporte.</p>'; return; }
  const rateBox = (o, l) => statBox(o && o.n ? pct(o.hits / o.n, 0) : '—', `${l}${o && o.n ? ` · ${o.hits} de ${o.n}` : ' · aún sin datos'}`);
  let html = `<p class="note">Actualizado el ${new Date(PF.updated).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}.</p>`;
  const D = PF.daily;
  html += `<section class="block"><h3 class="sect">⭐ Apuesta del día y selección</h3><div class="stats">${rateBox(D && D.bet, 'apuesta del día')}${rateBox(D && D.picks, 'pronósticos de la selección')}${rateBox(D && D.full, 'selección completa (todos)')}</div></section>`;
  for (const [sp, s] of Object.entries(PF.sports)) {
    if (!s.n) continue;
    html += `<section class="block"><h3 class="sect">${sportIcon(sp)} ${SPORT_NAME[sp] || sp} <span class="note">· ${s.n} partidos evaluados</span></h3>
      <div class="stats">${Object.entries(s.markets).map(([k, v]) => statBox(v.n ? pct(v.hits / v.n, 0) : '—', `${k}${v.n ? ` · ${v.n}` : ''}`)).join('')}</div>
      <h4 class="sub4">¿Se cumple lo que dice el modelo?</h4>${calibTable(s.preds || [])}</section>`;
  }
  if (PF.leagues && Object.keys(PF.leagues).length) {
    const L = Object.entries(PF.leagues).sort((a, b) => b[1].n - a[1].n);
    const mk = ['pronóstico principal', '1X2', 'más/menos 2,5', 'ambos marcan', 'córners más/menos 9,5', 'tarjetas más/menos 4,5', 'ganador'].filter(k => L.some(([, v]) => v.markets[k]));
    const cell = v => !v || !v.n ? '<td class="num">—</td>' : `<td class="num"><span class="chip ${v.hits / v.n >= 0.6 ? 'pos' : v.hits / v.n >= 0.5 ? 'warn' : 'neg'}">${pct(v.hits / v.n, 0)}</span> <span class="note">${v.n}</span></td>`;
    html += `<section class="block"><h3 class="sect">Por competición y mercado</h3><div class="tablewrap"><table><thead><tr><th>Competición</th><th class="num">Partidos</th>${mk.map(k => `<th class="num">${esc(k)}</th>`).join('')}</tr></thead><tbody>
      ${L.map(([k, v]) => `<tr><td>${flag(k)}${esc(v.name)}</td><td class="num">${v.n}</td>${mk.map(k => cell(v.markets[k])).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">Porcentaje de aciertos y, en gris, cuántos pronósticos hay detrás. Con menos de 30 todavía es muy pronto para sacar conclusiones.</p></section>`;
  }
  if (PF.recent && PF.recent.length) {
    html += `<section class="block"><h3 class="sect">Últimos resultados</h3><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Partido</th><th>Pronóstico</th><th class="num">Prob.</th><th>Resultado</th><th></th></tr></thead><tbody>
      ${PF.recent.map(r => `<tr><td>${esc(r.date)}</td><td>${vs(r.home, r.away, r.sport)}</td><td>${esc(r.label)}</td><td class="num">${pct(r.p, 0)}</td><td>${esc(r.score)}</td><td><span class="chip ${r.hit ? 'pos' : 'neg'}">${r.hit ? 'Acierto' : 'Fallo'}</span></td></tr>`).join('')}
    </tbody></table></div></section>`;
  }
  out.innerHTML = html;
}

// ============================== CUOTAS ==============================
function odRender() {
  const out = $('odOut');
  if (!OD) { out.innerHTML = '<p class="verdict">Sin datos de cuotas. En la versión de GitHub, añade la clave gratuita de The Odds API (secreto <code>ODDS_API_KEY</code>) y se revisarán dos veces al día.</p>'; return; }
  const when = s => new Date(s).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tbl = (head, rows) => rows.length ? `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="note">Ninguna en la última revisión.</p>';
  out.innerHTML = `<p class="note">Revisado el ${new Date(OD.updated).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}${OD.credits_left != null ? ` · quedan ${Math.round(OD.credits_left)} créditos este mes` : ''}.</p>
    <section class="block"><h3 class="sect">✅ Surebets</h3><p class="note">Apostando a todos los resultados en estas casas, ganas pase lo que pase (si las cuotas siguen disponibles).</p>${tbl(['Partido', 'Mercado', 'Beneficio', 'Apuestas (reparto del total)'], OD.surebets.map(s => `<tr><td>${vsText(s.match, s.sport)}<br><span class="note">${flagOf(s.sport)}${esc(s.sport || '')} · ${when(s.kickoff)}</span></td><td>${esc(s.market)}</td><td class="num"><span class="chip pos">${pct(s.profit)}</span></td><td>${s.legs.map(l => `${esc(l.outcome)} @ ${nf(l.odds)} en ${esc(l.book)} (${pct(l.stake, 0)})`).join('<br>')}</td></tr>`))}</section>
    <section class="block"><h3 class="sect">⚠️ Cuotas anómalas</h3><p class="note">Muy por encima del resto de casas: puede ser un error de la casa.</p>${tbl(['Partido', 'Mercado', 'Cuota', 'Mediana del resto'], OD.anomalies.map(a => `<tr><td>${vsText(a.match, a.sport)}<br><span class="note">${flagOf(a.sport)}${esc(a.sport || '')} · ${when(a.kickoff)}</span></td><td>${esc(a.market)}: ${esc(a.outcome)}</td><td class="num">${nf(a.odds)} en ${esc(a.book)}</td><td class="num">${nf(a.median)} (×${nf(a.ratio)})</td></tr>`))}</section>
    <section class="block"><h3 class="sect">📈 Valor frente a Pinnacle</h3><p class="note">Cuotas más altas que el precio de Pinnacle sin margen, la casa más afinada.</p>${tbl(['Partido', 'Mercado', 'Cuota', 'Cuota justa', 'Valor'], OD.value.map(v => `<tr><td>${vsText(v.match, v.sport)}<br><span class="note">${flagOf(v.sport)}${esc(v.sport || '')} · ${when(v.kickoff)}</span></td><td>${esc(v.market)}: ${esc(v.outcome)}</td><td class="num">${nf(v.odds)} en ${esc(v.book)}</td><td class="num">${nf(v.fair)}</td><td class="num"><span class="chip pos">+${pct(v.ev)}</span></td></tr>`))}</section>
    <p class="note">«Valor» compara con el precio de Pinnacle sin margen, la casa más afinada. En los datos de tenis de 2023-26 esa comparación dio un +1,9% a largo plazo con muchos altibajos; en fútbol no hay datos con los que medirlo.</p>`;
}

// ============================== AVISOS DE TELEGRAM ==============================
const AV = store.get('mc_avisos', { hora: 8, equipos: [], competiciones: [], confianza_minima: 0, incluir_todos: true, activo: true, cuotas: false });
const AVF = store.get('mc_fuentes', { bluesky: [], telegram: [] });   // redes que lee el proceso automático (config.json -> fuentes)
const normTxt = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function avInit() {
  fillSelect($('avHora'), Array.from({ length: 17 }, (_, i) => [i + 6, `${i + 6}:00`]), AV.hora);
  $('avConf').value = String(AV.confianza_minima); $('avTodos').value = AV.incluir_todos ? '1' : '0'; $('avActivo').value = AV.activo ? '1' : '0'; $('avCuotas').value = AV.cuotas ? '1' : '0';
  $('avBsky').value = AVF.bluesky.join(', '); $('avTg').value = AVF.telegram.join(', ');
  const comps = [...Fd.divs.map((d, i) => [d, Fd.divNames[i]]), ['UEFA', 'Competiciones europeas'], ...Object.entries(BK).map(([k, v]) => [k, v.name])];
  $('avComps').innerHTML = comps.map(([k, n]) => `<label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" value="${esc(k)}"${AV.competiciones.includes(k) ? ' checked' : ''}>${esc(n)}</label>`).join('');
  const teams = new Set(FB.filter(r => r.d >= today() - 400).flatMap(r => [r.h, r.a])); for (const v of Object.values(BK)) for (const r of v.rows.slice(-600)) { teams.add(r.h); teams.add(r.a); }
  $('avTeams').innerHTML = [...teams].sort().map(t => `<option value="${esc(t)}">`).join('');
  ['avHora', 'avConf', 'avTodos', 'avActivo', 'avCuotas', 'avBsky', 'avTg'].forEach(id => $(id).addEventListener('change', avUpdate));
  $('avComps').addEventListener('change', avUpdate);
  $('avTeamAdd').addEventListener('click', () => { const v = $('avTeam').value.trim(); if (v && !AV.equipos.includes(v)) AV.equipos.push(v); $('avTeam').value = ''; avUpdate(); });
  $('avTeam').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('avTeamAdd').click(); } });
  $('avCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('avJson').value); $('avCopy').textContent = 'Copiado'; } catch { $('avJson').select(); $('avCopy').textContent = 'Selecciona y copia el texto'; } setTimeout(() => $('avCopy').textContent = 'Copiar configuración', 2000); });
  avUpdate();
}
function avUpdate() {
  AV.hora = +$('avHora').value; AV.confianza_minima = +$('avConf').value; AV.incluir_todos = $('avTodos').value === '1'; AV.activo = $('avActivo').value === '1'; AV.cuotas = $('avCuotas').value === '1';
  AV.competiciones = [...$('avComps').querySelectorAll('input:checked')].map(i => i.value);
  $('avTeamList').innerHTML = AV.equipos.map((t, i) => `<span class="chip warn">${esc(t)} <button type="button" class="linkbtn" data-rm="${i}" aria-label="Quitar ${esc(t)}">×</button></span>`).join('');
  $('avTeamList').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { AV.equipos.splice(+b.dataset.rm, 1); avUpdate(); }));
  store.set('mc_avisos', AV);
  const list = id => $(id).value.split(',').map(x => x.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\/(s\/)?/, '')).filter(Boolean);
  AVF.bluesky = list('avBsky'); AVF.telegram = list('avTg'); store.set('mc_fuentes', AVF);
  $('avJson').value = JSON.stringify({ telegram: AV, fuentes: AVF }, null, 2);
  if (PR && PR.matches) {   // misma regla de filtrado que el proceso automático
    const T = AV.equipos.map(normTxt), C = AV.competiciones.map(normTxt);
    const n = PR.matches.filter(m => (!T.length || T.some(t => normTxt(m.home).includes(t) || normTxt(m.away).includes(t))) && (!C.length || C.some(c => normTxt(m.league) === c || normTxt(m.leagueName).includes(c) || normTxt(m.sport) === c)) && m.pick.p >= AV.confianza_minima).length;
    $('avPreview').textContent = `Con estos filtros, de los próximos partidos calculados recibirías ${n}.`;
  }
}

// ============================== NAVEGACIÓN Y ARRANQUE ==============================
function headerInfo() {
  const parts = [`fútbol ${dayES(FB[FB.length - 1].d)}`];
  for (const c of ['nba', 'euroliga']) if (BK[c].rows.length) parts.push(`${BK[c].name} ${dayES(BK[c].rows[BK[c].rows.length - 1].d)}`);
  parts.push(`tenis ${dayES(Td.date[Td.date.length - 1])}`);
  $('dataInfo').textContent = 'Resultados hasta: ' + parts.join(' · ');
}
let tennisReady = false, statsReady = false;
function showTab(t) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('section[data-sec]').forEach(s => s.hidden = s.dataset.sec !== t);
  if (t === 'tenis' && !tennisReady) { tennisReady = true; tnRefresh(); }
  store.set('mc_tab', t);
}
function wire() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); history.replaceState(null, '', '#' + b.dataset.tab); }));
  document.querySelectorAll('.sub').forEach(sub => sub.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sub.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    sub.parentElement.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== b.dataset.v);
    if (b.dataset.v === 'stats' && !statsReady) { statsReady = true; fbStats(); }
  }));
  ['fbHome', 'fbAway', 'fbXi', 'injAttH', 'injDefH', 'injAttA', 'injDefA'].forEach(id => $(id).addEventListener('change', fbPredict));
  $('fbLeague').addEventListener('change', () => fbTeamsFill());
  ['stLeague', 'stN', 'stSide'].forEach(id => $(id).addEventListener('change', fbStats));
  $('btFbRun').addEventListener('click', fbBacktest);
  $('nbComp').addEventListener('change', () => bkInit());
  ['nbHome', 'nbAway', 'nbSpread', 'nbTotal'].forEach(id => $(id).addEventListener('change', bkPredict));
  $('btNbRun').addEventListener('click', bkBacktest);
  $('tnTour').addEventListener('change', tnRefresh);
  ['tnA', 'tnB', 'tnSurf', 'tnBo'].forEach(id => $(id).addEventListener('change', tnPredict));
  $('btTnRun').addEventListener('click', tnBacktest);
  ['prSport', 'prLeague', 'prConf'].forEach(id => $(id).addEventListener('change', e => { if (id === 'prSport') $('prLeague').value = ''; prRender(); }));
}
(async () => {
  wire();
  let BX;
  [Fd, BK.nba.raw, BK.euroliga.raw, Td, PR, PF, CE, IJ, BX, NW, OD, CR] = await Promise.all([loadJSON('d-fb', 'data/football.json'), loadJSON('d-nb', 'data/nba.json'), loadJSON('d-el', 'data/euroliga.json'),
    loadJSON('d-tn', 'data/tennis.json'), loadJSON('d-pr', 'data/predictions.json'), loadJSON('d-pf', 'data/performance.json'), loadJSON('d-ce', 'data/clubelo.json'), loadJSON('d-ij', 'data/injuries.json'),
    loadJSON('d-bx', 'data/basket_extra.json'), loadJSON('d-nw', 'data/news.json'), loadJSON('d-od', 'data/odds.json'), loadJSON('d-cr', 'data/crests.json')]);
  BK.eurocup = { raw: null, rows: [], name: 'EuroCup' }; BK.acb = { raw: null, rows: [], name: 'Liga ACB' };
  for (const [k, v] of Object.entries(BX?.comps || {})) BK[k] = { raw: v, rows: [], name: v.name };
  if (!Fd || !Td) { $('prOut').innerHTML = '<p class="verdict">No se pudieron cargar los datos. Recarga la página en unos minutos.</p>'; return; }
  buildFB(); for (const k of Object.keys(BK)) buildBK(k);
  bkCompsFill();
  appendTennis(store.get('mc_tn_extra', []));
  headerInfo(); fbInitControls(); bkInit(); prRender(); acRender(); avInit(); odRender();
  const h = location.hash.slice(1); showTab(['pronosticos', 'futbol', 'baloncesto', 'tenis', 'guia'].includes(h) ? h : 'pronosticos');
})();
