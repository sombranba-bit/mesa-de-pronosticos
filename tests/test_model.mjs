// Pruebas de coherencia del motor de pronósticos. Uso: node tests/test_model.mjs   (falla con código 1 si algo no cuadra)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = createRequire(import.meta.url)(path.join(ROOT, 'app', 'model.js'));
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FALLO:', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} frente a ${b}`);
const sum = a => a.reduce((s, x) => s + x, 0);

// ---- fútbol: datos sintéticos de una liga de 10 equipos ----
const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], rows = [];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = l => { let k = 0, p = Math.exp(-l), s = p; const u = rnd(); while (u > s && k < 15) { k++; p *= l / k; s += p; } return k; };
const strength = Object.fromEntries(teams.map((t, i) => [t, 0.6 + i * 0.12]));
for (let d = 19000; d < 19700; d += 7) for (let i = 0; i < 5; i++) {
  const h = teams[(i + d) % 10], a = teams[(i + 5 + d) % 10]; if (h === a) continue;
  const hg = pois(1.4 * strength[h] / strength[a]), ag = pois(1.1 * strength[a] / strength[h]);
  const hth = Math.min(hg, pois(0.45 * hg + 0.1)), hta = Math.min(ag, pois(0.45 * ag + 0.1));
  rows.push({ d, div: 'SP1', h, a, hg, ag, hth, hta, hc: pois(5.2), ac: pois(4.4), hy: pois(2.1), ay: pois(2.4), hr: 0, ar: 0, hxg: hg * 0.8 + 0.3, axg: ag * 0.8 + 0.2 });
}
const set = M.fitFootballSet(rows, 19700, 0.0015), R = M.footballRatings(rows);
ok(set.ft && set.ht && set.sh && set.co && set.ca && set.fx, 'se ajustan los seis modelos de fútbol');
ok(set.caTrend > 0.7 && set.caTrend < 1.3, `tendencia de tarjetas razonable (${set.caTrend})`);
for (const adj of [null, { h: 0.85, a: 1.1 }]) {
  const P = M.footballPredict(set, R.feat('J', 'A'), 'J', 'A', adj), g = Object.fromEntries(P.groups.map(x => [x.title, x.rows]));
  near(sum(g['Resultado'].map(r => r.p)), 1, 1e-9, '1X2 suma 1');
  near(sum(g['Goles exactos'].map(r => r.p)), 1, 1e-6, 'goles exactos suma 1');
  near(sum(g['Margen de victoria'].map(r => r.p)), 1, 1e-6, 'margen de victoria suma 1');
  near(sum(g['Descanso/final'].map(r => r.p)), 1, 1e-6, 'descanso/final suma 1');
  near(sum(g['Par o impar'].map(r => r.p)), 1, 1e-9, 'par/impar suma 1');
  for (const t of ['Goles totales', 'Córners', 'Tarjetas (amarillas + rojas)']) {
    const over = g[t].filter(r => r.label.startsWith('Más de')).map(r => r.p), under = g[t].filter(r => r.label.startsWith('Menos de')).map(r => r.p);
    over.forEach((p, i) => near(p + under[i], 1, 1e-9, `${t}: más + menos = 1`));
    ok(over.every((p, i) => i === 0 || p <= over[i - 1] + 1e-12), `${t}: «más de» baja al subir la línea`);
  }
  for (const r of g['Hándicap asiático']) ok(r.p >= 0 && r.p <= 1 && (r.push || 0) >= 0 && r.p + (r.push || 0) <= 1 + 1e-9, `hándicap ${r.label} válido`);
  ok(P.summary.H > P.summary.A, 'el equipo fuerte en casa es favorito');
  ok(P.groups.flatMap(x => x.rows).every(r => r.p >= -1e-12 && r.p <= 1 + 1e-12), 'todas las probabilidades entre 0 y 1');
}
const base = M.footballPredict(set, R.feat('J', 'A'), 'J', 'A'), injured = M.footballPredict(set, R.feat('J', 'A'), 'J', 'A', { h: 0.8, a: 1 });
ok(injured.summary.H < base.summary.H && injured.summary.lam < base.summary.lam, 'las bajas del local bajan su victoria y sus goles');
const pick = M.footballPick(base.summary, 'J', 'A'); ok(pick.p >= 0.5 || pick.market === '1X2', 'el pronóstico principal es coherente');
// ---- liga sin xG: el más/menos 2,5 pasa por la calibración y el 1X2 no cambia ----
const setNoXg = M.fitFootballSet(rows.map(r => ({ ...r, hxg: null, axg: null })), 19700, 0.0015);
ok(!setNoXg.fx, 'sin xG no hay modelo mezcla');
const Pc = M.footballPredict(setNoXg, R.feat('J', 'A'), 'J', 'A'), gc = Object.fromEntries(Pc.groups.map(x => [x.title, x.rows]));
near(sum(gc['Resultado'].map(r => r.p)), 1, 1e-9, 'calibrado: 1X2 suma 1');
near(sum(gc['Goles exactos'].map(r => r.p)), 1, 1e-6, 'calibrado: goles exactos suma 1');
const raw = M.footballMarkets(M.rescaleGrid(M.dcGrid(setNoXg.ft, 'J', 'A'), [Pc.summary.H, Pc.summary.D, Pc.summary.A])).over(2.5);
const want = 1 / (1 + Math.exp(-(0.725 * Math.log(raw / (1 - raw)) + 0.092)));
near(Pc.summary.o25, want, 2e-3, 'calibrado: más de 2,5 sigue la fórmula validada');
// ---- ratings de cuotas pasadas y GAP (tiros a puerta) ----
const rowsMk = rows.map(r => ({ ...r, il: 1.4 * strength[r.h] / strength[r.a], im: 1.1 * strength[r.a] / strength[r.h], hst: 3 + 2 * strength[r.h], ast: 3 + 2 * strength[r.a] }));
const setMk = M.fitFootballSet(rowsMk, 19700, 0.0015), Rmk = M.footballRatings(rowsMk), mkJA = M.marketPredict(setMk.mk, "J", "A");
ok(setMk.mk && mkJA && mkJA.p[0] > 0.6, `ratings de cuotas: el fuerte en casa es claro favorito (${mkJA && mkJA.p[0].toFixed(3)})`);
{ const rr = []; for (let d = 19000; d < 19700; d++) { const h = teams[Math.floor(rnd() * 10)]; let a = h; while (a === h) a = teams[Math.floor(rnd() * 10)]; rr.push({ d, h, a, il: 1.4 * strength[h] / strength[a], im: 1.1 * strength[a] / strength[h] }); }
  const p = M.marketPredict(M.fitMarket(rr, 19700), 'J', 'A'); near(p.l, 1.4 * strength.J / strength.A, 0.4, 'ratings de cuotas: recupera los goles implícitos del local'); near(p.m, 1.1 * strength.A / strength.J, 0.06, 'ratings de cuotas: y los del visitante'); }
ok(Rmk.feat('J', 'A').gap > 0.5, 'GAP: el equipo que más tira a puerta tiene ventaja');
const Pm = M.footballPredict(setMk, Rmk.feat('J', 'A'), 'J', 'A'), gm = Object.fromEntries(Pm.groups.map(x => [x.title, x.rows]));
near(sum(gm['Resultado'].map(r => r.p)), 1, 1e-9, 'con cuotas: 1X2 suma 1'); near(sum(gm['Goles exactos'].map(r => r.p)), 1, 1e-6, 'con cuotas: goles exactos suma 1');
near(Pm.summary.o25, (1 - M.MK.ou) * Pc.summary.o25 + M.MK.ou * M.marketPredict(setMk.mk, 'J', 'A').o, 0.08, 'con cuotas: más de 2,5 mezcla modelo y cuotas');
// ---- europeo ----
const E = M.eloPredict(1900, 1700, 'X', 'Y'); near(E.summary.H + E.summary.D + E.summary.A, 1, 1e-9, 'europeo 1X2 suma 1'); ok(E.summary.H > 0.5, 'Elo +200 en casa es favorito claro');
const En = M.eloPredict(1800, 1800, 'X', 'Y', true); near(En.summary.H, En.summary.A, 1e-9, 'campo neutral e igual Elo: simétrico');
// ---- cuotas sin margen ----
near(sum(M.fairProbs([1.9, 3.5, 4.2])), 1, 1e-9, 'Shin suma 1'); near(sum(M.fairProbs([1.8, 2.1])), 1, 1e-9, 'potencia suma 1');
// ---- baloncesto ----
const brow = []; for (let d = 19000; d < 19300; d++) { const h = teams[d % 10], a = teams[(d + 3) % 10]; brow.push({ d, h, a, hp: Math.round(110 + 8 * strength[h] - 6 * strength[a] + (rnd() - 0.5) * 20), ap: Math.round(108 + 8 * strength[a] - 6 * strength[h] + (rnd() - 0.5) * 20) }); }
const bm = M.fitPts(brow, 19300, 0.01), sd = M.ptsSD(bm, brow), B = M.basketPredict(bm, sd, 'J', 'A');
ok(sd.margin > 3 && sd.margin < 25, `dispersión del margen razonable (${sd.margin})`);
near(B.groups[0].rows[0].p + B.groups[0].rows[1].p, 1, 1e-9, 'baloncesto: ganador suma 1');
for (const g of B.groups.slice(1)) for (let i = 0; i < g.rows.length; i += 2) near(g.rows[i].p + g.rows[i + 1].p + (g.rows[i].push || 0), 1, 1e-6, `${g.title}: suma 1`);
const fat0 = M.nbaFatigue([{ d: 10, h: 'Boston Celtics', a: 'Miami Heat' }], 'Boston Celtics', 'Miami Heat', 12); near(fat0.adj, 0, 1e-9, 'mismo descanso y sin viaje: sin ajuste');
const fat1 = M.nbaFatigue([{ d: 10, h: 'Boston Celtics', a: 'Miami Heat' }, { d: 11, h: 'LA Clippers', a: 'Miami Heat' }], 'Boston Celtics', 'Miami Heat', 12);
ok(fat1.adj > 2, 'rival en segunda noche seguida tras cruzar el país: ventaja para el local');
// ---- tenis ----
for (const bo of [3, 5]) for (const p of [0.3, 0.5, 0.8]) {
  const T = M.tennisFromProb(p, bo, 0.62); near(sum(T.dist.map(x => x.p)), 1, 1e-6, `tenis bo${bo}: distribución suma 1`);
  near(sum(T.dist.filter(x => x.sa > x.sb).map(x => x.p)), p, 2e-3, `tenis bo${bo}: reproduce la probabilidad ${p}`);
  const X = M.tennisExtras(T.pa, T.pb, T.dist); ok(X.tieBreak >= 0 && X.tieBreak <= 1 && X.firstSetA >= 0 && X.firstSetA <= 1, 'tenis: extras válidos');
}
near(M.matchWin(0.62, 0.62, 3), 0.5, 1e-9, 'tenis: jugadores iguales, 50%');
// ---- apuesta del día y selección ----
const P2 = await import(path.join(ROOT, 'pipeline', 'predict.mjs'));
const mk = (id, iso, p, hit) => ({ id, home: id, away: 'x', kickoff: iso, pick: { p, label: id }, ...(hit === undefined ? {} : { eval: { pick: { p, hit } } }) });
const H = { a: mk('a', '2026-01-10T18:00:00Z', 0.9, true), b: mk('b', '2026-01-10T20:00:00Z', 0.7, false), c: mk('c', '2026-01-10T21:00:00Z', 0.5, true),
  d: mk('d', '2026-01-11T18:00:00Z', 0.8, false), e: mk('e', '2026-01-12T18:00:00Z', 0.95) };
const S1 = P2.dailyPicks(Object.values(H), '2026-01-10');
ok(S1.bet.id === 'a' && S1.picks.map(e => e.id).join() === 'a,b', 'apuesta del día: la más probable y selección ≥65% ordenada');
ok(P2.dailyFor(Object.values(H), Date.parse('2026-01-10T19:00:00Z')).day === '2026-01-10', 'apuesta del día: se mantiene el día con partidos pendientes');
ok(P2.dailyFor(Object.values(H), Date.parse('2026-01-10T22:00:00Z')).day === '2026-01-11', 'apuesta del día: pasa al día siguiente al empezar todos');
const DP = P2.performance(H).daily;
ok(DP.bet.n === 2 && DP.bet.hits === 1 && DP.picks.n === 3 && DP.picks.hits === 1 && DP.full.n === 1 && DP.full.hits === 0, `seguimiento de la apuesta del día (${JSON.stringify(DP)})`);
// ---- motivos de cada pronóstico ----
const Th = new Map([['A', [{ f: 2, a: 0 }, { f: 3, a: 1 }, { f: 1, a: 1 }, { f: 2, a: 1 }, { f: 4, a: 0 }]], ['B', [{ f: 0, a: 2 }, { f: 1, a: 1 }, { f: 0, a: 3 }, { f: 1, a: 2 }, { f: 0, a: 1 }]]]);
const Wf = P2.whyFootball({ home: 'A', away: 'B', lam: 2.1, mu: 0.6, pick: { code: 'H' } }, Th, new Map([['A', 1700], ['B', 1500]]), { B: { players: [{}, {}] } });
ok(Wf.length === 3 && Wf[0] === 'B tiene 2 bajas' && Wf[1].includes('200 puntos') && Wf[2].includes('4V 1E 0D'), `motivos del fútbol (${Wf.join(' | ')})`);
const Wo = P2.whyFootball({ home: 'A', away: 'B', lam: 2.1, mu: 0.6, pick: { code: 'O' } }, Th, null);
ok(Wo[0].includes('2,7') && Wo[1].includes('A 3'), `motivos del más de 2,5 (${Wo.join(' | ')})`);
const Wb = P2.whyBasket({ home: 'A', away: 'B', ph: 112, pa: 104, margin: 8, pick: { code: 'H' }, fatigue: { b2bA: true } }, Th);
ok(Wb[0] === 'B juega su segunda noche seguida' && Wb[1].includes('por 8,0'), `motivos del baloncesto (${Wb.join(' | ')})`);
// mejor cuota: casa los nombres de dos fuentes distintas y no confunde equipos de la misma ciudad
const MB = [{ home: 'Ath Madrid', away: 'Sevilla', kickoff: '2026-10-25T19:00:00Z', pick: { code: 'H' } }, { home: 'Real Madrid', away: 'Getafe', kickoff: '2026-10-25T14:00:00Z', pick: { code: 'O' } }];
const nb = P2.attachBest(MB, { best: [{ home: 'Atlético Madrid', away: 'Sevilla FC', kickoff: '2026-10-25T19:00:00Z', H: [1.9, 'Pinnacle', 8] },
  { home: 'Real Madrid', away: 'Getafe CF', kickoff: '2026-10-25T14:00:00Z', O: [1.8, 'Codere', 6] }] });
ok(nb === 2 && MB[0].best.odds === 1.9 && MB[1].best.book === 'Codere', `mejor cuota casada (${JSON.stringify(MB.map(m => m.best))})`);
{ const H = { x: { id: 'x', sport: 'nba', leagueName: 'NBA', home: 'A', away: 'B', kickoff: new Date(Date.now() - 864e5).toISOString(), pick: { label: 'Gana A', p: 0.7123, code: 'H' }, best: { odds: 1.5 }, fair: { H: 1.45 },
    eval: { ganador: { p: 0.7123, hit: true }, pick: { p: 0.7123, hit: true } } }, y: { id: 'y', kickoff: new Date().toISOString(), pick: { p: 0.6 } } };
  const { names, rows: R } = P2.historyRows(H, Date.now());
  ok(R.length === 1 && R[0].p === 0.712 && R[0].r === 1 && R[0].o === 1.5 && R[0].f === 1.45 && names[R[0].m[0][0]] === 'ganador' && R[0].m[0][2] === 1 && !names.includes('pick'), 'historial: solo resueltos, con cuota y mercados'); }
{ // mercados extra: se evalúan con la magnitud del resultado frente a la línea
  const e = { sport: 'futbol', H: 0.5, D: 0.3, A: 0.2, o25: 0.55, btts: 0.5, score: '1-0', scoreP: 0.12, pick: { code: 'H', p: 0.5 }, result: { hg: 2, ag: 1 },
    mx: [['más/menos 1,5', 0.7, 'tot', 1.5], ['marca el visitante', 0.4, 'away', 0.5], ['doble oportunidad 12 / X', 0.7, 'abs', 0.5]] };
  const ev = P2.evaluate(e);
  ok(ev['más/menos 1,5'].hit === true && ev['marca el visitante'].hit === false && ev['marca el visitante'].p === 0.6 && ev['doble oportunidad 12 / X'].hit && ev['marcador exacto'].hit === false, 'mercados extra de fútbol');
  const t = P2.evaluate({ sport: 'tenis', pick: { code: 'H', p: 0.7 }, result: { hp: 2, ap: 1, games: 28, tb: 1, s1: 0 }, mx: [['hay tie-break', 0.4, 'tb', 0.5], ['gana el 1er set', 0.7, 's1', 0.5], ['juegos totales (línea justa)', 0.55, 'tot', 24.5]] });
  ok(t['hay tie-break'].hit === false && t['gana el 1er set'].hit === false && t['juegos totales (línea justa)'].hit === true && t.ganador.hit, 'mercados extra de tenis');
  const old = P2.evaluate({ sport: 'nba', pick: { code: 'A', p: 0.6 }, result: { hp: 90, ap: 100 } });
  ok(Object.keys(old).length === 2, 'partidos antiguos sin mercados extra: igual que antes');
  const ht = P2.evaluate({ sport: 'futbol', H: 0.5, D: 0.3, A: 0.2, o25: 0.5, btts: 0.5, pick: { code: 'H', p: 0.5 }, result: { hg: 2, ag: 1, hth: 0, hta: 0 },
    mx: [['1X2 al descanso', 0.42, 'htr', 0, 'eq'], ['descanso/final', 0.3, 'hf', 'X/1', 'eq'], ['gana el local y ambos marcan', 0.3, 'hBtts', 0.5], ['local gana por 1 gol', 0.2, 'h1', 0.5]] });
  ok(ht['1X2 al descanso'].hit && ht['descanso/final'].hit && ht['gana el local y ambos marcan'].hit === false && ht['local gana por 1 gol'].hit === false, 'descanso y combinados de fútbol');
  const mx = P2.tennisMx(0.7, 3, 0.62); ok(mx.length >= 10 && mx.every(([, p]) => p > 0 && p < 1), 'tenis: probabilidades de mercados extra válidas'); }
ok(P2.keepBest({ pick: { code: 'H' } }, { pick: { code: 'H' }, best: { odds: 1.5, book: 'X' }, fair: { H: 1.6 } }).best?.odds === 1.5, 'conserva la mejor cuota vista si la pasada nueva no trae el partido');
ok(!P2.keepBest({ pick: { code: 'A' } }, { pick: { code: 'H' }, best: { odds: 1.5, book: 'X' } }).best, 'no conserva la cuota si el pronóstico ha cambiado');
ok(P2.keepBest({ pick: { code: 'H' }, best: { odds: 1.7 } }, { pick: { code: 'H' }, best: { odds: 1.5 } }).best.odds === 1.7, 'la cuota nueva manda sobre la vieja');
ok(P2.attachBest([{ home: 'Real Madrid', away: 'Sevilla', kickoff: '2026-10-25T19:00:00Z', pick: { code: 'H' } }], { best: [{ home: 'Atlético Madrid', away: 'Getafe', kickoff: '2026-10-25T19:00:00Z', H: [2, 'X', 3] }] }) === 0, 'no casa partidos distintos a la misma hora');
// resumen de Telegram: secciones con título y etiquetas HTML equilibradas
{
  const t0 = Date.now() + 3 * 3600e3, day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(t0 - 6 * 3600e3));   // jornada de 6:00 a 6:00
  const m = { sport: 'futbol', league: 'SP1', leagueName: 'España - LaLiga', kickoff: new Date(t0).toISOString(), home: 'A & B', away: 'C', H: .5, D: .3, A: .2, o25: .6, pick: { label: 'Gana A', p: .7, code: 'H' }, best: { odds: 1.5, book: 'X' } };
  const S = P2.digest([m], { recent: [] }, day, {}, { day, bet: m, picks: [m] });
  const T = S.join('\n\n');
  ok(Array.isArray(S) && T.includes('APUESTA DEL DÍA') && T.includes('TODOS LOS PARTIDOS') && T.includes('A &amp; B') && T.includes('1,50 en X'), 'resumen de Telegram con secciones');
  ok(S.every(x => (x.match(/<blockquote/g) || []).length === (x.match(/<\/blockquote>/g) || []).length && (x.match(/<b>/g) || []).length === (x.match(/<\/b>/g) || []).length), 'cada sección cierra sus etiquetas');
}
// jornada de 6:00 a 6:00: un NBA a la 1:30 (hora de Madrid) del viernes cuenta para el jueves
{
  const e = { kickoff: '2026-10-22T23:30:00Z', pick: { p: 0.8 } }, f = { kickoff: '2026-10-22T18:00:00Z', pick: { p: 0.7 } };
  const sel = P2.dailyPicks([e, f], '2026-10-22');
  ok(sel && sel.bet === e && sel.picks.length === 2 && !P2.dailyPicks([e], '2026-10-23'), 'la madrugada cuenta para la jornada anterior');
}
// el registro de apuestas recibe la cuota justa de cierre y el resultado de cada partido pronosticado
{
  const k = new Date(Date.now() - 864e5).toISOString();
  const pf = P2.performance({ x: { id: 'x', sport: 'futbol', league: 'SP1', leagueName: 'L', kickoff: k, home: 'A', away: 'B', pick: { p: .6, code: 'H', label: 'Gana A' }, fair: { H: 1.8, D: 3.6, A: 4.5 }, result: { hg: 2, ag: 1 } } });
  ok(pf.closing.x && pf.closing.x.fair.H === 1.8 && pf.closing.x.result.hg === 2, 'cierre y resultado para el registro');
}
// simulación sin dinero de la selección: 1 u a la mejor cuota
{
  const mk = (id, d, p, hit, odds) => ({ id, sport: 'futbol', league: 'SP1', leagueName: 'L', kickoff: `2026-10-${d}T18:00:00Z`, home: id, away: 'Z', pick: { p, code: 'H', label: 'Gana' },
    best: odds ? { odds } : undefined, fair: { H: 1.5 }, result: { hg: hit ? 1 : 0, ag: 0 }, eval: { pick: { p, hit: hit ? 1 : 0 } } });
  const H = { a: mk('a', 10, .8, 1, 1.4), b: mk('b', 10, .7, 0, 1.6), c: mk('c', 11, .75, 1, null) };
  const sm = P2.performance(H).daily.sim;
  ok(sm.picks.n === 3 && sm.picks.withOdds === 2 && Math.abs(sm.picks.profit - (0.4 - 1)) < 1e-9 && Math.abs(sm.picks.roi + 0.3) < 1e-9 && sm.bet.n === 2 && !sm.ready.ok, `simulación de la selección (${JSON.stringify(sm.picks)})`);
}
// combinadas: la segura junta los más probables; la de valor solo los que pagan más que la cuota justa
{
  const e = (id, p, odds, pin) => ({ id, pick: { p, code: 'H' }, best: odds ? { odds } : undefined, fair: pin ? { H: pin } : undefined });
  const C = P2.combos([e('a', .85, 1.15), e('b', .75, 1.45, 1.42), e('c', .7, 1.40), e('d', .66, 1.60, 1.62), e('e', .55, 2.0)]);
  ok(C.safe.ids.join() === 'a,b,c' && Math.abs(C.safe.p - .85 * .75 * .7) < 1e-12 && Math.abs(C.safe.odds - 1.15 * 1.45 * 1.40) < 1e-9, `combinada segura (${C.safe.ids})`);
  ok(C.value.ids.join() === 'e,b' , `combinada con valor (${C.value?.ids})`);   // d no: Pinnacle 1,62 paga más que 1,60
  ok(P2.combos([e('a', .9, 1.05)]).safe === null && P2.combos([e('a', .9, 1.05), e('b', .8, 1.1)]).value === null, 'sin combinada si no hay dos partidos que cumplan');
}
// bot de Telegram: resultados de la noche, avisos de valor, resumen semanal y comandos
{
  const now = Date.now(), dayOf = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ms - 6 * 3600e3));
  const past = now - 26 * 3600e3, d0 = dayOf(past);
  const e = (id, p, hit, k, extra = {}) => ({ id, sport: 'futbol', league: 'SP1', leagueName: 'España - LaLiga', kickoff: new Date(k).toISOString(), home: id + ' FC', away: 'Rival', pick: { p, code: 'H', label: `Gana ${id}` },
    ...(hit == null ? {} : { result: { hg: hit ? 2 : 0, ag: 1 }, eval: { pick: { p, hit: hit ? 1 : 0 } } }), ...extra });
  const H = { a: e('a', .8, 1, past), b: e('b', .7, 0, past + 3600e3), c: e('c', .66, null, past + 7200e3) };
  const N = P2.nightResults(H, d0).join('\n');
  ok(N.includes('RESULTADOS DE HOY') && N.includes('✅') && N.includes('❌') && N.includes('⏳') && N.includes('1 de 2 acertados'), 'resultados de la noche');
  const soon = now + 5 * 3600e3, M = [e('v', .6, null, soon, { best: { odds: 1.80, book: 'X' }, fair: { H: 1.70 } }), e('w', .6, null, soon, { best: { odds: 1.70, book: 'X' } }), e('z', .6, null, now + 40 * 3600e3, { best: { odds: 2.5, book: 'X' } })];
  const A = P2.valueAlerts(M, {}, now);
  ok(A && A.ids.join() === 'v' && A.text.join().includes('+5,9%'), `avisos de valor (${A?.ids})`);   // w: 1,70 = justa 1,67 · +2%, no llega; z: fuera de las 30 h
  ok(P2.valueAlerts(M, { v: now }, now) === null, 'no repite avisos ya enviados');
  const W = P2.weeklySummary(H, null, now + 864e5);
  ok(W && W.join().includes('RESUMEN SEMANAL') && W.join().includes('1 de 2'), 'resumen semanal');
  const U = [{ update_id: 1, message: { chat: { id: -100 }, text: '/hoy@AldanaBot' } }, { update_id: 2, message: { chat: { id: 555 }, text: '/hoy' } }, { update_id: 3, message: { chat: { id: -100 }, text: 'hola' } }];
  const C = P2.parseCommands(U, ['-100']);
  ok(C.length === 1 && C[0].cmd === 'hoy' && C[0].chat === '-100', 'comandos: solo en tus chats');
  const J = P2.parseCommands([{ update_id: 4, message: { chat: { id: -100 }, new_chat_members: [{ first_name: 'Ana' }, { first_name: 'Bot', is_bot: true }] } }], ['-100']);
  ok(J.length === 1 && J[0].cmd === 'bienvenida' && J[0].names.join() === 'Ana' && P2.welcomeText(J[0].names).includes('/hoy'), 'bienvenida a los nuevos con los comandos');
}
// tenis automático: pronóstico de los partidos próximos y su resultado
{
  const players = ['Alto A.', 'Bajo B.', 'Medio C.'], T = { players, date: [], tour: [], surf: [], bo: [], completed: [], w: [], l: [], tourns: ['X'], tourn: [] };
  for (const c of ['W1', 'L1', 'W2', 'L2', 'W3', 'L3', 'W4', 'L4', 'W5', 'L5', 'bW', 'bL', 'pW', 'pL', 'mW', 'mL']) T[c] = [];
  const add = (d, w, l, sets) => { T.date.push(d); T.tour.push(0); T.surf.push(0); T.bo.push(3); T.completed.push(1); T.w.push(w); T.l.push(l); T.tourn.push(0);
    for (let i = 1; i <= 5; i++) { T['W' + i].push(sets[i - 1]?.[0] ?? null); T['L' + i].push(sets[i - 1]?.[1] ?? null); } for (const c of ['bW', 'bL', 'pW', 'pL', 'mW', 'mL']) T[c].push(null); };
  for (let k = 0; k < 14; k++) { add(20000 + k, 0, 1, [[6, 3], [6, 4]]); add(20000 + k, 2, 1, [[6, 4], [3, 6], [6, 2]]); add(20000 + k, 0, 2, [[6, 4], [6, 4]]); }
  const ko = new Date((20020 + 0.6) * 864e5).toISOString();
  const P = P2.predictTennis(T, [{ tour: 0, kickoff: ko, a: 'Bajo B.', b: 'Alto A.', tourn: 'Open', surf: 0, bo: 3 }, { tour: 0, kickoff: ko, a: 'Nuevo N.', b: 'Alto A.', tourn: 'Open', surf: 0, bo: 3 }]);
  ok(P.length === 1 && P[0].pick.code === 'A' && P[0].pick.label === 'Gana Alto A.' && P[0].pick.p > 0.7 && P[0].sport === 'tenis', `tenis: pronóstico (${P[0]?.pick.label} ${P[0]?.pick.p.toFixed(2)})`);
  add(20020, 0, 1, [[6, 2], [4, 6], [7, 5]]);
  const r = P2.tennisResult(P[0], T);
  ok(r && r.hp === 1 && r.ap === 2 && P2.evaluate({ ...P[0], result: r }).pick.hit === true, `tenis: resultado y acierto (${JSON.stringify(r)})`);
}
// rachas y porra
{
  const day = k => new Date((20000 + k) * 864e5 + 18 * 3600e3).toISOString();
  const e = (id, k, hit, extra = {}) => ({ id, sport: 'futbol', league: 'SP1', leagueName: 'L', kickoff: day(k), home: id, away: 'Z', H: .6, D: .25, A: .15, pick: { p: .8, code: 'H', label: 'Gana' },
    result: { hg: hit ? 2 : 0, ag: hit ? 0 : 1 }, eval: { pick: { p: .8, hit: hit ? 1 : 0 } }, ...extra });
  const H = { a: e('a', 0, 0), b: e('b', 1, 1), c: e('c', 2, 1), d: e('d', 3, 1) };
  const sd = k => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(Date.parse(day(k)) - 6 * 3600e3));
  const rk = P2.betStreak(H, sd(3));
  ok(rk.n === 3 && rk.hit === true, `racha de aciertos (${JSON.stringify(rk)})`);
  ok(P2.nightResults(H, sd(3)).join().includes('3 aciertos seguidos'), 'la racha sale en los resultados de la noche');
  const m = { id: 'x', sport: 'futbol', home: 'Betis', away: 'Cádiz', leagueName: 'LaLiga', kickoff: day(5), H: .5, D: .3, A: .2, pick: { code: 'H', p: .5 } };
  const q = P2.porraPoll(m);
  ok(q.options.join() === 'Gana Betis,Empate,Gana Cádiz' && q.machine === 'H', 'porra: encuesta de fútbol');
  const porra = { p1: { day: sd(3), id: 'd', codes: ['H', 'D', 'A'], machine: 'A', kickoff: day(3), votes: { 1: { name: 'Ana', code: 'H' }, 2: { name: 'Luis', code: 'D' } } } };
  const T = P2.porraTable(porra, H, [sd(3)]);
  ok(T[0][0] === 'Ana' && T[0][1].pts === 1 && T.find(r => r[0] === P2.MACHINE)[1].pts === 0, `porra: clasificación (${JSON.stringify(T)})`);
  const sel = { day: sd(5), bet: { id: 'x' } };
  const PM = P2.porraMatches(sel, [m, { ...m, id: 'y', sport: 'nba', pick: { p: .9, code: 'H' } }, { ...m, id: 'z', pick: { p: .7, code: 'H' } }, { ...m, id: 'w', pick: { p: .6, code: 'H' } }], Date.parse(day(5)) - 5 * 3600e3);
  ok(PM.map(x => x.id).join() === 'x,y,z', `porra: partidos elegidos (${PM.map(x => x.id)})`);
}
// mejor cuota en tenis con los jugadores en orden distinto
{ const T = [{ sport: 'tenis', home: 'Sinner J.', away: 'Alcaraz C.', kickoff: '2026-10-30T12:00:00Z', pick: { code: 'H', p: .6 } }];
  P2.attachBest(T, { best: [{ home: 'Carlos Alcaraz', away: 'Jannik Sinner', kickoff: '2026-10-30T12:00:00Z', H: [2.1, 'X', 9], A: [1.8, 'Y', 9], fair: { H: 2.2, A: 1.75 } }] });
  ok(T[0].best?.odds === 1.8 && T[0].best.fair === 1.75, `tenis: mejor cuota con orden cambiado (${JSON.stringify(T[0].best)})`); }
ok(!P2.activeCommands({}).some(c => c[0] === 'porra') && P2.activeCommands({ porra: true }).some(c => c[0] === 'porra') && !P2.helpText(P2.activeCommands({})).includes('/porra'), 'porra desactivada por defecto');
// reajuste semanal y informe mensual
{
  const now = Date.UTC(2026, 10, 1, 10), H = {}; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 400; k++) { const p = 0.55 + 0.4 * rnd(), real = 0.5 + (p - 0.5) * 0.6;   // el modelo exagera: lo real está más cerca del 50%
    H['t' + k] = { id: 't' + k, sport: 'tenis', league: 'atp', leagueName: 'ATP · X', kickoff: new Date(now - (100 - k / 5) * 864e5).toISOString(), home: 'A', away: 'B', pw: p, pick: { p, code: 'H', label: 'Gana A' }, result: {}, eval: { pick: { p, hit: rnd() < real ? 1 : 0 } } }; }
  const C = P2.fitCalib(H, now);
  ok(C.tenis && C.tenis.c < 0.9 && !C.baloncesto, `reajuste: corrige el exceso de confianza (${JSON.stringify(C)})`);
  const few = P2.fitCalib({ a: { ...H.t0 } }, now); ok(few.tenis.c === 1, 'reajuste: sin datos suficientes no cambia nada');
  const M2 = [{ sport: 'tenis', pw: 0.8, pick: { p: 0.8, code: 'H' } }, { sport: 'futbol', pw: 0.8, pick: { p: 0.8, code: 'H' } }]; P2.applyCalib(M2, { tenis: { c: 0.8 } });
  ok(M2[0].pick.p < 0.8 && M2[0].pwRaw === 0.8 && M2[1].pick.p === 0.8, 'reajuste: se aplica solo donde toca');
  const R = P2.monthlyReport(Object.fromEntries(Object.entries(H).map(([k, e]) => [k, { ...e, kickoff: '2026-10-15T12:00:00Z' }])), null, now);
  ok(R && R[0].includes('OCTUBRE') && R.join().includes('Tenis'), 'informe mensual');
}
console.log(`${checks - fails} de ${checks} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
