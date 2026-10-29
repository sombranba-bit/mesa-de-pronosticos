// Todos los mercados que el modelo puede calcular y el resultado permite comprobar, por deporte.
// Solo se usan para medir (no cambian la selección). Cada mercado es un código «tipo>línea» (ocurre si la magnitud supera la línea)
// o «tipo=valor» (uno de varios resultados posibles: marcador exacto, descanso/final…). El código sirve a la vez para calcular,
// comprobar y poner nombre, así que no hace falta guardar nada más que {código: probabilidad en tantos por mil}.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const M = createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'model.js'));

const half = x => { const r = Math.round(x * 2) / 2; return Number.isInteger(r) ? r + 0.5 : r; };
const range = (a, b, s = 1) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(+x.toFixed(1)); return o; };
const gridP = (g, f) => { let s = 0; g.forEach((r, x) => r.forEach((v, y) => { if (f(x, y)) s += v; })); return s; };
const sgn = (x, y) => x > y ? '1' : x === y ? 'X' : '2';
const band = (d, step, top) => d === 0 ? 'X' : `${d > 0 ? 'L' : 'V'}${Math.min(Math.ceil(Math.abs(d) / step), top)}`;   // margen de victoria por tramos

// ---------- fútbol ----------
const FB = {   // magnitudes a partir de los goles (x local, y visitante) para los mercados de goles
  tot: (x, y) => x + y, home: x => x, away: (x, y) => y, marg: (x, y) => x - y, abs: (x, y) => Math.abs(x - y),
  wtnH: (x, y) => +(x > y && y === 0), wtnA: (x, y) => +(y > x && x === 0), btts: (x, y) => +(x > 0 && y > 0),
  bttsO: (x, y) => +(x > 0 && y > 0 && x + y > 2.5), bttsU: (x, y) => +(x > 0 && y > 0 && x + y < 2.5),
  hO: (x, y) => +(x > y && x + y > 2.5), aO: (x, y) => +(y > x && x + y > 2.5), dO: (x, y) => +(x === y && x + y > 2.5),
  hU: (x, y) => +(x > y && x + y < 2.5), aU: (x, y) => +(y > x && x + y < 2.5), dU: (x, y) => +(x === y && x + y < 2.5),
  hBtts: (x, y) => +(x > y && y > 0), aBtts: (x, y) => +(y > x && x > 0), odd: (x, y) => (x + y) % 2,
  cs: (x, y) => `${x}-${y}`, wm: (x, y) => band(x - y, 1, 3), r: (x, y) => sgn(x, y) };
const FB_LINES = { tot: range(0.5, 5.5), home: range(0.5, 3.5), away: range(0.5, 3.5), marg: range(-3.5, 3.5), abs: [0.5],
  ...Object.fromEntries(['wtnH', 'wtnA', 'btts', 'bttsO', 'bttsU', 'hO', 'aO', 'dO', 'hU', 'aU', 'dU', 'hBtts', 'aBtts', 'odd'].map(k => [k, [0.5]])) };
const marg1 = g => { const n = g.length, h = new Array(n).fill(0), a = new Array(n).fill(0); g.forEach((r, x) => r.forEach((v, y) => { h[x] += v; a[y] += v; })); return [h, a]; };
const over = (d, l) => d.reduce((s, v, k) => s + (k > l ? v : 0), 0);
export function footballMarkets(P, s = P.summary || {}, ext = {}) {
  const out = {}, put = (c, p) => { if (p > 0.0005 && p < 0.9995) out[c] = Math.round(p * 1000); };
  const g = P.G.g;
  for (const [t, ls] of Object.entries(FB_LINES)) for (const l of ls) put(`${t}>${l}`, gridP(g, (x, y) => FB[t](x, y) > l));
  for (const t of ['cs', 'wm', 'r']) { const d = {}; g.forEach((row, x) => row.forEach((v, y) => { const k = FB[t](x, y); d[k] = (d[k] || 0) + v; })); for (const [k, p] of Object.entries(d)) put(`${t}=${k}`, p); }
  if (P.GH && P.GS) {   // 1ª parte, 2ª parte (tablas independientes) y descanso/final
    const h = P.GH.g, s2 = P.GS.g;
    for (const l of [0.5, 1.5, 2.5]) { put(`htt>${l}`, gridP(h, (x, y) => x + y > l)); put(`sht>${l}`, gridP(s2, (x, y) => x + y > l)); }
    put('hth>0.5', gridP(h, x => x > 0)); put('hta>0.5', gridP(h, (x, y) => y > 0)); put('shh>0.5', gridP(s2, x => x > 0)); put('sha>0.5', gridP(s2, (x, y) => y > 0));
    for (const r of ['1', 'X', '2']) { put(`htr=${r}`, gridP(h, (x, y) => sgn(x, y) === r)); put(`shr=${r}`, gridP(s2, (x, y) => sgn(x, y) === r)); }
    const t1 = new Array(30).fill(0), t2 = new Array(30).fill(0); h.forEach((r, x) => r.forEach((v, y) => t1[x + y] += v)); s2.forEach((r, x) => r.forEach((v, y) => t2[x + y] += v));
    const hv = { 1: 0, X: 0, 2: 0 }; t1.forEach((a, i) => t2.forEach((b, j) => { hv[sgn(i, j)] += a * b; })); for (const [k, p] of Object.entries(hv)) put(`half=${k}`, p);
    const m = M.htft(h, s2), L = ['1', 'X', '2']; m.forEach((r, i) => r.forEach((p, j) => put(`hf=${L[i]}/${L[j]}`, p)));
  }
  if (s.corners) for (const l of range(6.5, 13.5)) put(`co>${l}`, M.nbOver(s.corners, M.NB_SIZE.corners, l));
  if (s.cards) for (const l of range(1.5, 7.5)) put(`ca>${l}`, M.nbOver(s.cards, M.NB_SIZE.cards, l));
  if (P.GC) { const [h, a] = marg1(P.GC.g); for (const l of range(1.5, 8.5)) { put(`coh>${l}`, over(h, l)); put(`coa>${l}`, over(a, l)); }
    for (const r of ['1', 'X', '2']) put(`cor=${r}`, gridP(P.GC.g, (x, y) => sgn(x, y) === r)); }
  if (P.GK) { const [h, a] = marg1(P.GK.g); for (const l of range(0.5, 4.5)) { put(`cah>${l}`, over(h, l)); put(`caa>${l}`, over(a, l)); }
    for (const r of ['1', 'X', '2']) put(`car=${r}`, gridP(P.GK.g, (x, y) => sgn(x, y) === r)); }
  // tiros, tiros a puerta y faltas (tablas propias, mismo modelo que los córners)
  for (const [G, tt, th, ta, tr, lt, lh] of [[P.GSS, 'sst', 'ssh', 'ssa', 'ssr', range(16.5, 32.5, 2), range(6.5, 18.5, 2)], [P.GSO, 'sot', 'soh', 'soa', 'sor', range(4.5, 12.5), range(1.5, 6.5)],
    [P.GFO, 'fot', 'foh', 'foa', 'fo1', range(16.5, 30.5, 2), range(7.5, 15.5, 2)]]) {
    if (!G) continue;
    for (const l of lt) put(`${tt}>${l}`, gridP(G.g, (x, y) => x + y > l));
    const [h, a] = marg1(G.g); for (const l of lh) { put(`${th}>${l}`, over(h, l)); put(`${ta}>${l}`, over(a, l)); }
    for (const r of ['1', 'X', '2']) put(`${tr}=${r}`, gridP(G.g, (x, y) => sgn(x, y) === r));
  }
  // primer gol: quién y cuándo (goles como procesos de Poisson a ritmo constante)
  const lam = P.G.lam, mu = P.G.mu, p00 = g[0][0];
  if (lam > 0 && mu > 0) { put('fg=1', (1 - p00) * lam / (lam + mu)); put('fg=2', (1 - p00) * mu / (lam + mu)); put('fg=none', p00);
    for (const m of [15, 30, 45, 60]) put(`fgm>${m}`, Math.exp(-(lam + mu) * m / 90)); }
  // fueras de juego (media de cada equipo en sus últimos partidos, ESPN) y el máximo goleador de cada equipo
  if (ext.offH != null && ext.offA != null) { const ps = (m, l) => { let c = 0, pk = Math.exp(-m); for (let k = 0; k <= l; k++) { c += pk; pk *= m / (k + 1); } return 1 - c; };
    for (const l of range(1.5, 6.5)) put(`off>${l}`, ps(ext.offH + ext.offA, l)); for (const l of range(0.5, 3.5)) { put(`offh>${l}`, ps(ext.offH, l)); put(`offa>${l}`, ps(ext.offA, l)); } }
  if (ext.tsH) put('tsh>0.5', 1 - Math.exp(-ext.tsH.rate));
  if (ext.tsA) put('tsa>0.5', 1 - Math.exp(-ext.tsA.rate));
  return out;
}

// ---------- baloncesto: márgenes y totales normales alrededor de lo esperado ----------
export function basketMarkets(P, sd) {
  const out = {}, put = (c, p) => { if (p > 0.0005 && p < 0.9995) out[c] = Math.round(p * 1000); };
  const { margin, total, ph, pa } = P.P, tsd = M.teamSD(sd), up = (mu, s, l) => 1 - M.normCdf((l - mu) / s);
  for (const k of range(-10, 10, 2)) { const l = half(margin) + k; put(`marg>${l}`, up(margin, sd.margin, l)); }
  for (const k of range(-10, 10, 2)) { const l = half(total) + k; put(`tot>${l}`, up(total, sd.total, l)); }
  for (const k of range(-6, 6, 2)) { put(`home>${half(ph) + k}`, up(ph, tsd, half(ph) + k)); put(`away>${half(pa) + k}`, up(pa, tsd, half(pa) + k)); }
  const cdf = x => M.normCdf((x - margin) / sd.margin);   // margen de victoria por tramos de 5 puntos (sin empates: la prórroga los deshace)
  const edges = [[-Infinity, -20.5, 'V5'], [-20.5, -15.5, 'V4'], [-15.5, -10.5, 'V3'], [-10.5, -5.5, 'V2'], [-5.5, 0, 'V1'], [0, 5.5, 'L1'], [5.5, 10.5, 'L2'], [10.5, 15.5, 'L3'], [15.5, 20.5, 'L4'], [20.5, Infinity, 'L5']];
  for (const [a, b, k] of edges) put(`wm=${k}`, cdf(b) - cdf(a));
  const res3 = (m, s) => { const lo = M.normCdf((-0.5 - m) / s), hi = M.normCdf((0.5 - m) / s); return { 1: 1 - hi, X: hi - lo, 2: lo }; };
  for (const [ks, f] of [[['q1', 'q2', 'q3', 'q4'], 4], [['h1', 'h2'], 2]]) for (const q of ks) {   // cuartos y mitades: la parte proporcional, con su dispersión
    const mm = margin / f, sm = sd.margin / Math.sqrt(f), tt = total / f, st = sd.total / Math.sqrt(f);
    for (const k of range(-4, 4, 2)) put(`${q}t>${half(tt) + k}`, up(tt, st, half(tt) + k));
    for (const [r, p] of Object.entries(res3(mm, sm))) put(`${q}r=${r}`, p);
  }
  put('ot>0.5', M.normCdf((0.5 - margin) / sd.margin) - M.normCdf((-0.5 - margin) / sd.margin));
  return out;
}

// ---------- tenis: modelo de puntos al saque ----------
export function tennisMarkets(p, bo, base) {
  const out = {}, put = (c, q) => { if (q > 0.0005 && q < 0.9995) out[c] = Math.round(q * 1000); };
  const T = M.tennisFromProb(p, bo, base), D = T.dist, P = f => M.sum(D.filter(f).map(x => x.p)), mean = f => M.sum(D.map(x => f(x) * x.p));
  const S1 = [...M.setDist(T.pa, T.pb, true).map(x => ({ ...x, p: x.p / 2 })), ...M.setDist(T.pa, T.pb, false).map(x => ({ ...x, p: x.p / 2 }))], P1 = f => M.sum(S1.filter(f).map(x => x.p));
  const X = M.tennisExtras(T.pa, T.pb, D);
  put('s1>0.5', P1(x => x.ga > x.gb)); put('tb>0.5', X.tieBreak); put('tb1>0.5', P1(x => x.ga + x.gb === 13));
  for (const l of range(7.5, 11.5)) put(`s1g>${l}`, P1(x => x.ga + x.gb > l));
  const s1 = {}; for (const x of S1) s1[`${x.ga}-${x.gb}`] = (s1[`${x.ga}-${x.gb}`] || 0) + x.p; for (const [k, q] of Object.entries(s1)) put(`s1s=${k}`, q);
  for (const l of bo === 5 ? [3.5, 4.5] : [2.5]) put(`sets>${l}`, P(x => x.sa + x.sb > l));
  for (const l of bo === 5 ? [-2.5, -1.5, 1.5, 2.5] : [-1.5, 1.5]) put(`marg>${l}`, P(x => x.sa - x.sb > l));
  put('sa>0.5', P(x => x.sa > 0)); put('sb>0.5', P(x => x.sb > 0));
  const ss = {}; for (const x of D) ss[`${x.sa}-${x.sb}`] = (ss[`${x.sa}-${x.sb}`] || 0) + x.p; for (const [k, q] of Object.entries(ss)) put(`ss=${k}`, q);
  const lg = half(mean(x => x.ga + x.gb)), ld = half(mean(x => x.ga - x.gb)), la = half(mean(x => x.ga)), lb = half(mean(x => x.gb));
  for (const k of range(-6, 6)) { put(`tot>${lg + k}`, P(x => x.ga + x.gb > lg + k)); put(`gm>${ld + k}`, P(x => x.ga - x.gb > ld + k)); }
  for (const k of range(-3, 3)) { put(`ga>${la + k}`, P(x => x.ga > la + k)); put(`gb>${lb + k}`, P(x => x.gb > lb + k)); }
  return out;
}

// ---------- magnitudes del resultado (lo que se compara con cada código) ----------
export function values(sport, r) {
  if (!r) return {};
  if (sport === 'futbol') {
    const V = Object.fromEntries(Object.entries(FB).map(([k, f]) => [k, f(r.hg, r.ag)]));
    if (r.hth != null) { const sh = r.hg - r.hth, sa = r.ag - r.hta;
      Object.assign(V, { htt: r.hth + r.hta, hth: r.hth, hta: r.hta, htr: sgn(r.hth, r.hta), sht: sh + sa, shh: sh, sha: sa, shr: sgn(sh, sa), half: sgn(r.hth + r.hta, sh + sa), hf: `${sgn(r.hth, r.hta)}/${sgn(r.hg, r.ag)}` }); }
    if (r.corners != null) V.co = r.corners;
    if (r.cards != null) V.ca = r.cards;
    if (r.ch != null) Object.assign(V, { coh: r.ch, coa: r.cA, cor: sgn(r.ch, r.cA) });
    if (r.kh != null) Object.assign(V, { cah: r.kh, caa: r.ka, car: sgn(r.kh, r.ka) });
    if (r.hsh != null) Object.assign(V, { sst: r.hsh + r.ash, ssh: r.hsh, ssa: r.ash, ssr: sgn(r.hsh, r.ash) });
    if (r.hst != null) Object.assign(V, { sot: r.hst + r.ast, soh: r.hst, soa: r.ast, sor: sgn(r.hst, r.ast) });
    if (r.hfo != null) Object.assign(V, { fot: r.hfo + r.afo, foh: r.hfo, foa: r.afo, fo1: sgn(r.hfo, r.afo) });
    if (r.fg != null) Object.assign(V, { fg: r.fg, fgm: r.fgm });
    if (r.offH != null) Object.assign(V, { off: r.offH + r.offA, offh: r.offH, offa: r.offA });
    if (r.tsh != null) V.tsh = r.tsh;
    if (r.tsa != null) V.tsa = r.tsa;
    return V;
  }
  if (sport === 'tenis') {
    const V = { sets: r.hp + r.ap, marg: r.hp - r.ap, sa: r.hp, sb: r.ap, ss: `${r.hp}-${r.ap}` };
    if (r.games != null) Object.assign(V, { tot: r.games, gm: r.gdiff, ga: (r.games + r.gdiff) / 2, gb: (r.games - r.gdiff) / 2, tb: r.tb, s1: r.s1 });
    if (r.s1s) Object.assign(V, { s1s: r.s1s, s1g: r.s1s.split('-').reduce((a, b) => +a + +b, 0), tb1: +(r.s1s === '7-6' || r.s1s === '6-7') });
    return V;
  }
  const d = r.hp - r.ap, V = { tot: r.hp + r.ap, home: r.hp, away: r.ap, marg: d, wm: band(d, 5, 5).replace('X', d >= 0 ? 'L1' : 'V1') };
  if (r.q && r.q.length === 4) { const s = p => p[0] + p[1];
    r.q.forEach((p, i) => { V[`q${i + 1}t`] = s(p); V[`q${i + 1}r`] = sgn(p[0], p[1]); });
    const h1 = [r.q[0][0] + r.q[1][0], r.q[0][1] + r.q[1][1]], h2 = [r.q[2][0] + r.q[3][0], r.q[2][1] + r.q[3][1]];
    Object.assign(V, { h1t: s(h1), h1r: sgn(...h1), h2t: s(h2), h2r: sgn(...h2), ot: r.ot || 0 }); }
  return V;
}

// ---------- nombres ----------
const n = l => String(l).replace('.', ',');
const LB = {
  futbol: { tot: 'Goles', home: 'Goles del local', away: 'Goles del visitante', marg: 'Diferencia de goles (local − visitante)', abs: 'Hay ganador (12 / X)',
    wtnH: 'Gana el local sin encajar', wtnA: 'Gana el visitante sin encajar', btts: 'Ambos marcan', bttsO: 'Ambos marcan y más de 2,5', bttsU: 'Ambos marcan y menos de 2,5',
    hO: 'Gana el local y más de 2,5', aO: 'Gana el visitante y más de 2,5', dO: 'Empate y más de 2,5', hU: 'Gana el local y menos de 2,5', aU: 'Gana el visitante y menos de 2,5', dU: 'Empate y menos de 2,5',
    hBtts: 'Gana el local y ambos marcan', aBtts: 'Gana el visitante y ambos marcan', odd: 'Goles totales impares',
    htt: 'Goles en la 1ª parte', hth: 'Marca el local en la 1ª parte', hta: 'Marca el visitante en la 1ª parte', sht: 'Goles en la 2ª parte', shh: 'Marca el local en la 2ª parte', sha: 'Marca el visitante en la 2ª parte',
    co: 'Córners', coh: 'Córners del local', coa: 'Córners del visitante', ca: 'Tarjetas', cah: 'Tarjetas del local', caa: 'Tarjetas del visitante',
    sst: 'Tiros', ssh: 'Tiros del local', ssa: 'Tiros del visitante', sot: 'Tiros a puerta', soh: 'Tiros a puerta del local', soa: 'Tiros a puerta del visitante',
    fot: 'Faltas', foh: 'Faltas del local', foa: 'Faltas del visitante', ssr: 'Más tiros (1X2)', sor: 'Más tiros a puerta (1X2)', fo1: 'Más faltas (1X2)',
    fg: 'Primer gol (local, visitante o ninguno)', fgm: 'Minuto del primer gol', off: 'Fueras de juego', offh: 'Fueras de juego del local', offa: 'Fueras de juego del visitante',
    tsh: 'Marca el máximo goleador del local', tsa: 'Marca el máximo goleador del visitante',
    cs: 'Marcador exacto', wm: 'Margen de victoria', r: '1X2', htr: '1X2 al descanso', shr: '1X2 de la 2ª parte', half: 'Parte con más goles', hf: 'Descanso/final', cor: 'Más córners (1X2)', car: 'Más tarjetas (1X2)' },
  tenis: { s1: 'Jugador A gana el 1er set', tb: 'Hay tie-break', tb1: 'Tie-break en el 1er set', s1g: 'Juegos del 1er set', sets: 'Número de sets', marg: 'Hándicap de sets (A − B)',
    sa: 'Jugador A gana al menos un set', sb: 'Jugador B gana al menos un set', tot: 'Juegos totales (respecto a la línea justa)', gm: 'Hándicap de juegos (respecto a la línea justa)',
    ga: 'Juegos del jugador A (respecto a la línea justa)', gb: 'Juegos del jugador B (respecto a la línea justa)', ss: 'Resultado exacto en sets', s1s: 'Resultado exacto del 1er set' },
  basket: { marg: 'Hándicap (respecto a la línea justa)', tot: 'Puntos totales (respecto a la línea justa)', home: 'Puntos del local (respecto a la línea justa)', away: 'Puntos del visitante (respecto a la línea justa)', wm: 'Margen de victoria (tramos de 5)',
    q1t: 'Puntos del 1er cuarto', q2t: 'Puntos del 2º cuarto', q3t: 'Puntos del 3er cuarto', q4t: 'Puntos del 4º cuarto', h1t: 'Puntos de la 1ª mitad', h2t: 'Puntos de la 2ª mitad',
    q1r: 'Ganador del 1er cuarto', q2r: 'Ganador del 2º cuarto', q3r: 'Ganador del 3er cuarto', q4r: 'Ganador del 4º cuarto', h1r: 'Ganador de la 1ª mitad', h2r: 'Ganador de la 2ª mitad', ot: 'Hay prórroga' } };
const BIN1 = new Set(['tsh', 'tsa', 'ot', 'abs', 'wtnH', 'wtnA', 'btts', 'bttsO', 'bttsU', 'hO', 'aO', 'dO', 'hU', 'aU', 'dU', 'hBtts', 'aBtts', 'odd', 'hth', 'hta', 'shh', 'sha', 's1', 'tb', 'tb1', 'sa', 'sb']);
const REL = new Set(['tot', 'gm', 'ga', 'gb', 'marg', 'home', 'away', 'q1t', 'q2t', 'q3t', 'q4t', 'h1t', 'h2t']);   // en tenis y baloncesto la línea es relativa a la justa de cada partido
// Clave de agrupación: en tenis y baloncesto las líneas cambian de un partido a otro, así que se agrupan por distancia a la línea justa
export function groupKey(sport, code, lines) {
  const [, t, op, v] = /^([A-Za-z0-9]+)([>=])(.*)$/.exec(code);
  if (op === '=') return `${t}=`;
  if (sport !== 'futbol' && REL.has(t) && lines && lines[t] != null && !(sport === 'tenis' && t === 'marg')) return `${t}>${+(+v - lines[t]).toFixed(1)}`;
  return code;
}
export function label(sport, key) {
  const L = LB[sport === 'futbol' || sport === 'tenis' ? sport : 'basket'], [, t, op, v] = /^([A-Za-z0-9]+)([>=])(.*)$/.exec(key), base = L[t] || t;
  if (op === '=') return `${base} (el más probable)`;
  if (BIN1.has(t)) return base;
  if (sport !== 'futbol' && REL.has(t) && !(sport === 'tenis' && t === 'marg')) return `${base} ${+v > 0 ? '+' : +v < 0 ? '−' : '±'}${n(Math.abs(+v))}`;
  return `${base}: más/menos ${n(v)}`;
}

// ---------- agregado: acierto y calibración de cada mercado ----------
// Binario: se «apuesta» al lado más probable. Varios resultados («=»): al resultado más probable de ese tipo.
export function aggregate(lines) {
  const S = {}, add = (sp, key, hit, p) => {
    const o = ((S[sp] ||= {})[key] ||= { n: 0, hits: 0, exp: 0, b: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] });
    o.n++; o.hits += hit; o.exp += p; const b = o.b[p < 0.5 ? 0 : Math.min(5, Math.floor((p - 0.5) * 10) + 1)]; b[0]++; b[1] += hit;
  };
  for (const ln of lines) {
    const V = values(ln.s, ln.r), lines_ = {}, best = {};
    for (const code of Object.keys(ln.m)) { const [, t, op, v] = /^([A-Za-z0-9]+)([>=])(.*)$/.exec(code); if (op === '>') (lines_[t] ||= []).push(+v); }
    for (const t of Object.keys(lines_)) { const ls = lines_[t].sort((a, b) => a - b); lines_[t] = ls[Math.floor(ls.length / 2)]; }   // línea central = la justa
    const sp = ln.s === 'futbol' || ln.s === 'tenis' ? ln.s : 'baloncesto';
    for (const [code, pm] of Object.entries(ln.m)) {
      const [, t, op, v] = /^([A-Za-z0-9]+)([>=])(.*)$/.exec(code), p = pm / 1000;
      if (V[t] == null) continue;
      if (op === '=') { if (!best[t] || p > best[t][1]) best[t] = [v, p]; continue; }
      add(sp, groupKey(ln.s, code, lines_), +((p >= 0.5) === (V[t] > +v)), Math.max(p, 1 - p));
    }
    for (const [t, [v, p]] of Object.entries(best)) add(sp, `${t}=`, +(String(V[t]) === v), p);
  }
  const out = {};
  for (const [sp, mk] of Object.entries(S)) out[sp] = Object.entries(mk).map(([k, o]) => ({ k, l: label(sp === 'baloncesto' ? 'nba' : sp, k), n: o.n, hits: o.hits, exp: +o.exp.toFixed(2), b: o.b }))
    .sort((a, b) => b.n - a.n || a.l.localeCompare(b.l, 'es'));
  return out;
}
