// Calcula los pronósticos de los próximos partidos, guarda el historial, evalúa aciertos y envía el resumen a Telegram.
// Uso: node pipeline/predict.mjs   (lee docs/data/*.json, data/history.json y config.json)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = createRequire(import.meta.url)(path.join(ROOT, 'app', 'model.js'));
const DATA = path.join(ROOT, 'docs', 'data'), STATE = path.join(ROOT, 'data');
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); };
const NOW = Date.now(), TODAY = Math.floor(NOW / 864e5);
const COUNTRY = { SP1: 'ES', SP2: 'ES', SP3: 'ES', E0: 'EN', E1: 'EN', I1: 'IT', I2: 'IT', D1: 'DE', D2: 'DE', F1: 'FR', F2: 'FR', N1: 'NL', P1: 'PT', SC0: 'SC', SC1: 'SC', B1: 'BE', T1: 'TR', G1: 'GR' };
const FB_FIELDS = ['hth', 'hta', 'hc', 'ac', 'hy', 'ay', 'hr', 'ar', 'hxg', 'axg', 'hst', 'ast', 'il', 'im'];
const usDay = ms => Math.round(Date.parse(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date(ms)) + 'T00:00:00Z') / 864e5);
const madridDate = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ms));   // AAAA-MM-DD
// «Jornada» de apuestas: de 6:00 a 6:00 (hora de Madrid). Los partidos de NBA de madrugada cuentan para la noche anterior,
// que es cuando se pueden apostar desde España.
const slateDay = ms => madridDate(ms - 6 * 3600e3);
const madridTime = ms => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

// Competiciones de baloncesto: NBA y Euroliga en sus ficheros; el resto (EuroCup, ACB, ...) en basket_extra.json
export function basketComps(B) {
  const list = [['nba', 'NBA', B.nba], ['euroliga', 'Euroliga', B.euroliga]];
  for (const [k, v] of Object.entries(B.extra?.comps || {})) list.push([k, v.name, v]);
  return list.filter(([, , D]) => D && D.date && D.date.length);
}

// ---------- motivos breves de cada pronóstico (solo con datos que usa el modelo) ----------
const n1 = x => x.toFixed(1).replace('.', ','), pcs = p => Math.round(p * 100) + '%';
function teamHistory(rows, gf, ga) {   // últimos partidos de cada equipo, del más antiguo al más reciente
  const T = new Map(), add = (t, f, a, d) => { if (!T.has(t)) T.set(t, []); T.get(t).push({ f, a, d }); };
  for (const r of rows) { add(r.h, r[gf], r[ga], r.d); add(r.a, r[ga], r[gf], r.d); }
  return T;
}
function formTxt(list, n, draws = true) {
  const g = (list || []).slice(-n); if (g.length < 3) return null;
  const w = g.filter(x => x.f > x.a).length, d = g.filter(x => x.f === x.a).length;
  return draws ? `${w}V ${d}E ${g.length - w - d}D` : `${w}-${g.length - w}`;
}
export function whyFootball(m, T, elo, inj = {}) {
  const c = m.pick.code, h = T.get(m.home) || [], a = T.get(m.away) || [], out = [];
  const lastN = (l, k) => l.slice(-k), avg = (l, f) => l.reduce((s, x) => s + f(x), 0) / l.length;
  const injTxt = t => { const n = inj[t]?.players?.length; return n ? `${t} tiene ${n} ${n === 1 ? 'baja' : 'bajas'}` : null; };
  if (c === 'H' || c === 'A') {
    const [fav, riv, fl, rl] = c === 'H' ? [m.home, m.away, h, a] : [m.away, m.home, a, h];
    const de = elo ? Math.round((elo.get(fav) ?? 1500) - (elo.get(riv) ?? 1500)) : null;
    if (de > 0) out.push(`${fav} está ${de} puntos de Elo por encima`);
    else if (de !== null && c === 'H') out.push(`Ventaja de jugar en casa pese a un Elo similar o menor`);
    const f1 = formTxt(fl, 5), f2 = formTxt(rl, 5);
    if (f1 && f2) out.push(`Forma (últimos 5): ${fav} ${f1}, ${riv} ${f2}`);
    out.push(`Goles esperados ${n1(m.lam)}–${n1(m.mu)}${c === 'H' ? ', y juega en casa' : ''}`);
    const ij = injTxt(riv); if (ij) out.unshift(ij);
  } else if (c === 'D') {
    const de = elo ? Math.abs(Math.round((elo.get(m.home) ?? 1500) - (elo.get(m.away) ?? 1500))) : null;
    if (de !== null) out.push(`Equipos muy igualados (${de} puntos de Elo de diferencia)`);
    out.push(`Pocos goles esperados: ${n1(m.lam + m.mu)} entre los dos`);
  } else if (c === 'O' || c === 'U') {
    out.push(`Goles esperados: ${n1(m.lam + m.mu)} entre los dos (${n1(m.lam)}–${n1(m.mu)})`);
    const hh = lastN(h, 8), aa = lastN(a, 8);
    if (hh.length >= 5 && aa.length >= 5) {
      const line = x => x.f + x.a > 2.5;
      out.push(`${c === 'O' ? 'Más' : 'Menos'} de 2,5 en sus últimos 8: ${m.home} ${hh.filter(x => line(x) === (c === 'O')).length}, ${m.away} ${aa.filter(x => line(x) === (c === 'O')).length}`);
      out.push(`Media de goles en esos partidos: ${n1(avg(hh, x => x.f + x.a))} y ${n1(avg(aa, x => x.f + x.a))}`);
    }
  } else {
    out.push(`Goles esperados de cada uno: ${n1(m.lam)} y ${n1(m.mu)}`);
    const hh = lastN(h, 8), aa = lastN(a, 8);
    if (hh.length >= 5 && aa.length >= 5) out.push(c === 'BY'
      ? `Marcaron en sus últimos 8: ${m.home} ${hh.filter(x => x.f > 0).length}, ${m.away} ${aa.filter(x => x.f > 0).length}`
      : `Se quedaron sin marcar en sus últimos 8: ${m.home} ${hh.filter(x => x.f === 0).length}, ${m.away} ${aa.filter(x => x.f === 0).length}`);
  }
  return out.slice(0, 3);
}
export function whyBasket(m, T) {
  const homeFav = m.pick.code === 'H', [fav, riv] = homeFav ? [m.home, m.away] : [m.away, m.home], out = [];
  out.push(`Marcador esperado ${Math.round(m.ph)}–${Math.round(m.pa)}: ${fav} por ${n1(Math.abs(m.margin))} puntos`);
  const f1 = formTxt(T.get(fav), 10, false), f2 = formTxt(T.get(riv), 10, false);
  if (f1 && f2) out.push(`Últimos 10: ${fav} ${f1}, ${riv} ${f2}`);
  const F = m.fatigue;
  if (F) { const b2bRiv = homeFav ? F.b2bA : F.b2bH; if (b2bRiv) out.unshift(`${riv} juega su segunda noche seguida`); }
  if (homeFav) out.push('Juega en casa');
  return out.slice(0, 3);
}
export function predictAll(F, B, fixtures, injuries = {}) {
  const matches = [], skipped = [];
  // ---------- fútbol ----------
  if (F) {
    const rows = F.date.map((d, k) => { const r = { d, div: F.divs[F.div[k]], h: F.teams[F.h[k]], a: F.teams[F.a[k]], hg: F.hg[k], ag: F.ag[k] };
      for (const f of FB_FIELDS) r[f] = F[f] ? F[f][k] : null; return r; }).sort((a, b) => a.d - b.d);
    const R = M.footballRatings(rows), T = teamHistory(rows, 'hg', 'ag'), sets = {}, names = Object.fromEntries(F.divs.map((d, i) => [d, F.divNames[i]]));
    for (const f of fixtures.football || []) {
      const c = COUNTRY[f.league]; if (!c) continue;
      if (!sets[c]) { const cr = rows.filter(r => COUNTRY[r.div] === c); sets[c] = M.fitFootballSet(cr.filter(r => r.d >= TODAY - 3 * 365), TODAY, 0.0015); }
      const ih = injuries[`${f.league}|${f.h}`], ia = injuries[`${f.league}|${f.a}`];
      const adj = (ih?.att ?? 1) !== 1 || (ia?.att ?? 1) !== 1 ? { h: ih?.att ?? 1, a: ia?.att ?? 1 } : null;
      const P = M.footballPredict(sets[c], R.feat(f.h, f.a), f.h, f.a, adj);
      if (!P) { skipped.push(`${f.h}-${f.a}`); continue; }
      const s = P.summary, pick = M.footballPick(s, f.h, f.a), m = { id: `futbol|${f.league}|${f.kickoff.slice(0, 10)}|${f.h}|${f.a}`, sport: 'futbol', league: f.league, leagueName: names[f.league],
        kickoff: f.kickoff, home: f.h, away: f.a, H: s.H, D: s.D, A: s.A, o25: s.o25, btts: s.btts, lam: s.lam, mu: s.mu, corners: s.corners, cards: s.cards,
        co95: s.co95, ca45: s.ca45, score: `${s.score.x}-${s.score.y}`, pick, ...(f.noTime ? { noTime: true } : {}) };
      if (f.ref) m.ref = f.ref;
      m.why = whyFootball(m, T, R.elo, { [f.h]: ih, [f.a]: ia });
      if (adj) { const b = M.footballPredict(sets[c], R.feat(f.h, f.a), f.h, f.a).summary; m.base = { H: b.H, D: b.D, A: b.A };
        m.injuries = [...(ih?.players || []).map(p => ({ team: f.h, ...p })), ...(ia?.players || []).map(p => ({ team: f.a, ...p }))]; }
      matches.push(m);
    }
    // competiciones europeas: Elo de ClubElo -> goles
    for (const f of fixtures.uefa || []) {
      const P = M.eloPredict(f.eh, f.ea, f.h, f.a), s = P.summary;
      matches.push({ id: `futbol|UEFA|${f.kickoff.slice(0, 10)}|${f.h}|${f.a}`, sport: 'futbol', league: 'UEFA', leagueName: f.competition || 'Competiciones europeas', kickoff: f.kickoff, noTime: f.noTime !== false, ...(f.ref ? { ref: f.ref } : {}),
        home: f.h, away: f.a, H: s.H, D: s.D, A: s.A, o25: s.o25, btts: s.btts, lam: s.lam, mu: s.mu, score: `${s.score.x}-${s.score.y}`, pick: M.footballPick(s, f.h, f.a) });
      const u = matches[matches.length - 1], c = u.pick.code;
      u.why = [c === 'H' || c === 'A' || c === 'D' ? `Elo de ClubElo: ${f.h} ${Math.round(f.eh)}, ${f.a} ${Math.round(f.ea)}${c === 'H' ? ' (y juega en casa)' : ''}` : null,
        `Goles esperados ${n1(s.lam)}–${n1(s.mu)}`].filter(Boolean);
    }
  }
  // ---------- baloncesto ----------
  for (const [sport, name, D] of basketComps(B)) {
    const fx = [...(fixtures[sport] || []), ...(fixtures.basket || []).filter(f => f.league === sport)]; if (!fx.length) continue;
    const rows = D.date.map((d, k) => ({ d, h: D.teams[D.h[k]], a: D.teams[D.a[k]], hp: D.hp[k], ap: D.ap[k] })).sort((a, b) => a.d - b.d);
    const last = rows[rows.length - 1].d, m = M.fitPts(rows.filter(r => r.d >= last - 500), Math.max(TODAY, last + 1), 0.01);
    const sd = sport === 'nba' ? M.NBA_SD : M.ptsSD(m, rows), T = teamHistory(rows, 'hp', 'ap');
    for (const f of fx) {
      const fat = sport === 'nba' ? M.nbaFatigue(rows, f.h, f.a, usDay(Date.parse(f.kickoff))) : { adj: 0 };
      const P = M.basketPredict(m, sd, f.h, f.a, undefined, undefined, fat.adj); if (!P) { skipped.push(`${f.h}-${f.a}`); continue; }
      const home = P.pw >= 0.5;
      matches.push({ id: `${sport}|${f.kickoff.slice(0, 10)}|${f.h}|${f.a}`, sport, league: sport, leagueName: name, kickoff: f.kickoff, home: f.h, away: f.a, ...(f.noTime ? { noTime: true } : {}),
        pw: P.pw, ph: P.P.ph, pa: P.P.pa, margin: P.P.margin, total: P.P.total,
        fatigue: fat.home ? { adj: +fat.adj.toFixed(2), b2bH: fat.home.rest === 1, b2bA: fat.away.rest === 1, restH: fat.home.rest, restA: fat.away.rest } : null,
        pick: { market: 'Ganador', label: `Gana ${home ? f.h : f.a}`, p: Math.max(P.pw, 1 - P.pw), code: home ? 'H' : 'A' } });
      matches[matches.length - 1].why = whyBasket(matches[matches.length - 1], T);
    }
  }
  return { matches, skipped };
}

// Busca el resultado de un partido guardado (±1 día por husos horarios)
function findResult(e, F, B, U) {
  const d0 = Math.floor(Date.parse(e.kickoff) / 864e5), v = (c, k) => (F[c] ? F[c][k] : null);
  if (e.league === 'UEFA') {   // resultados de Champions de football-data.org, con nombres de ClubElo
    const r = (U?.results || []).find(x => Math.abs(x.d - d0) <= 1 && x.h === e.home && x.a === e.away);
    return r ? { hg: r.hg, ag: r.ag, corners: null, cards: null } : null;
  }
  if (e.sport === 'futbol') {
    if (!F) return null;
    for (let k = F.date.length - 1; k >= 0; k--) { const d = F.date[k]; if (d < d0 - 1) break;
      if (d <= d0 + 1 && F.teams[F.h[k]] === e.home && F.teams[F.a[k]] === e.away)
        return { hg: F.hg[k], ag: F.ag[k], corners: v('hc', k) != null ? v('hc', k) + v('ac', k) : null,
          cards: v('hy', k) != null ? v('hy', k) + v('ay', k) + (v('hr', k) || 0) + (v('ar', k) || 0) : null }; }
  } else {
    const D = basketComps(B).find(([s]) => s === e.sport)?.[2]; if (!D) return null;
    for (let k = D.date.length - 1; k >= 0; k--) { const d = D.date[k]; if (d < d0 - 1) break;
      if (d <= d0 + 1 && D.teams[D.h[k]] === e.home && D.teams[D.a[k]] === e.away) return { hp: D.hp[k], ap: D.ap[k] }; }
  }
  return null;
}
// Evalúa un pronóstico con su resultado: devuelve los aciertos por mercado
export function evaluate(e) {
  const r = e.result, ev = {};
  const side = (p, happened) => ({ p: Math.max(p, 1 - p), hit: (p > 0.5) === happened });
  if (e.sport === 'futbol') {
    const y = r.hg > r.ag ? 'H' : r.hg === r.ag ? 'D' : 'A', fav = [['H', e.H], ['D', e.D], ['A', e.A]].reduce((b, x) => x[1] > b[1] ? x : b);
    const over = r.hg + r.ag > 2.5, both = r.hg > 0 && r.ag > 0;
    ev['1X2'] = { p: fav[1], hit: fav[0] === y };
    if (e.base) { // comparación con y sin el ajuste por bajas, en los partidos en que hubo bajas
      const fb = [['H', e.base.H], ['D', e.base.D], ['A', e.base.A]].reduce((b, x) => x[1] > b[1] ? x : b);
      ev['1X2 con bajas'] = ev['1X2']; ev['1X2 sin bajas'] = { p: fb[1], hit: fb[0] === y };
    }
    ev['más/menos 2,5'] = side(e.o25, over);
    ev['ambos marcan'] = side(e.btts, both);
    if (e.co95 != null && r.corners != null) ev['córners más/menos 9,5'] = side(e.co95, r.corners > 9.5);
    if (e.ca45 != null && r.cards != null) ev['tarjetas más/menos 4,5'] = side(e.ca45, r.cards > 4.5);
    const c = e.pick.code;
    ev.pick = { p: e.pick.p, hit: c === 'H' || c === 'D' || c === 'A' ? c === y : c === 'O' ? over : c === 'U' ? !over : c === 'BY' ? both : !both };
    e.scoreText = `${r.hg}-${r.ag}`;
  } else {
    ev.ganador = { p: e.pick.p, hit: (e.pick.code === 'H') === (r.hp > r.ap) };
    ev.pick = ev.ganador;
    e.scoreText = `${r.hp}-${r.ap}`;
  }
  return ev;
}
// Apuesta del día y selección: los pronósticos de más probabilidad del día (hora de Madrid), uno por partido y de cualquier deporte.
// Los partidos ya empezados conservan su último pronóstico previo, así la elección es la misma en la app y al medir aciertos.
export const SEL_MIN = 0.65, SEL_MAX = 5, SIM_N = 100;
export function dailyPicks(entries, day) {
  const d = entries.filter(e => slateDay(Date.parse(e.kickoff)) === day).sort((a, b) => b.pick.p - a.pick.p);
  return d.length ? { day, bet: d[0], picks: d.filter(e => e.pick.p >= SEL_MIN).slice(0, SEL_MAX), combos: combos(d) } : null;
}
// Combinadas de la jornada (máximo 3 partidos distintos):
// · segura: los pronósticos más probables (65% o más);
// · con valor: solo pronósticos cuya mejor cuota supera la cuota justa del modelo (y la de Pinnacle, si la hay) en un 2% o más.
export const COMBO_MAX = 3;
export function combos(d) {
  const legs = list => { const L = list.slice(0, COMBO_MAX); if (L.length < 2) return null;
    const p = L.reduce((x, e) => x * e.pick.p, 1), odds = L.every(e => e.best?.odds) ? L.reduce((x, e) => x * e.best.odds, 1) : null;
    return { ids: L.map(e => e.id), p, fair: 1 / p, odds }; };
  const edge = e => { if (!e.best?.odds) return -1; const ref = Math.max(1 / e.pick.p, e.fair?.[e.pick.code] || 0); return e.best.odds / ref - 1; };
  return {
    safe: legs(d.filter(e => e.pick.p >= SEL_MIN)),
    value: legs(d.filter(e => e.pick.p >= 0.5 && edge(e) >= 0.02).sort((a, b) => edge(b) - edge(a))),
  };
}
// Día a mostrar: hoy si queda algún partido por empezar; si no, el siguiente día con partidos.
export function dailyFor(entries, now = NOW) {
  const next = entries.filter(e => Date.parse(e.kickoff) > now).map(e => slateDay(Date.parse(e.kickoff))).sort()[0];
  return next ? dailyPicks(entries, next) : null;
}
export function performance(hist) {
  const done = Object.values(hist).filter(e => e.eval).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const sports = {}, leagues = {};
  const tally = (o, e) => {
    o.n++;
    for (const [k, v] of Object.entries(e.eval)) { if (k === 'pick') continue; const mk = o.markets[k] || (o.markets[k] = { n: 0, hits: 0 }); mk.n++; mk.hits += v.hit; }
    const pk = o.markets['pronóstico principal'] || (o.markets['pronóstico principal'] = { n: 0, hits: 0 }); pk.n++; pk.hits += e.eval.pick.hit;
  };
  for (const e of done) {
    const s = sports[e.sport] || (sports[e.sport] = { n: 0, markets: {}, preds: [] });
    tally(s, e); s.preds.push({ p: +e.eval.pick.p.toFixed(3), hit: e.eval.pick.hit });
    tally(leagues[e.league] || (leagues[e.league] = { name: e.leagueName, sport: e.sport, n: 0, markets: {} }), e);
  }
  for (const s of Object.values(sports)) s.preds = s.preds.slice(-3000);
  const recent = done.slice(-40).reverse().map(e => ({ date: madridDate(Date.parse(e.kickoff)), sport: e.sport, home: e.home, away: e.away, label: e.pick.label, p: e.pick.p, hit: e.eval.pick.hit, score: e.scoreText }));
  const all = Object.values(hist), daily = { bet: { n: 0, hits: 0 }, picks: { n: 0, hits: 0 }, full: { n: 0, hits: 0 }, recent: [] };
  // Simulación sin dinero: 1 unidad a cada pronóstico de la selección (y a la apuesta del día), cobrada a la mejor cuota vista antes del partido
  const simNew = () => ({ n: 0, hits: 0, pSum: 0, withOdds: 0, profit: 0, clvSum: 0, clvN: 0 }), sim = { bet: simNew(), picks: simNew(), safe: simNew(), value: simNew() };
  const byId = Object.fromEntries(Object.values(hist).map(e => [e.id, e]));
  const comboAdd = (o, c) => {   // una combinada cuenta cuando se han jugado todos sus partidos
    if (!c) return; const L = c.ids.map(id => byId[id]); if (L.some(e => !e?.eval)) return;
    const hit = L.every(e => e.eval.pick.hit); o.n++; o.hits += hit; o.pSum += c.p;
    if (c.odds) { o.withOdds++; o.profit += hit ? c.odds - 1 : -1; }
  };
  const simAdd = (o, e) => {
    o.n++; o.hits += e.eval.pick.hit; o.pSum += e.pick.p;
    if (e.best?.odds > 1) { o.withOdds++; o.profit += e.eval.pick.hit ? e.best.odds - 1 : -1; }
    const f = e.fair?.[e.pick.code]; if (f && e.best?.odds) { o.clvSum += e.best.odds / f - 1; o.clvN++; }
  };
  for (const day of [...new Set(done.map(e => slateDay(Date.parse(e.kickoff))))].sort()) {
    const sel = dailyPicks(all, day);
    if (sel.bet.eval) { daily.bet.n++; daily.bet.hits += sel.bet.eval.pick.hit; simAdd(sim.bet, sel.bet);
      daily.recent.unshift({ date: day, home: sel.bet.home, away: sel.bet.away, label: sel.bet.pick.label, p: sel.bet.pick.p, hit: sel.bet.eval.pick.hit }); }
    for (const e of sel.picks) if (e.eval) { daily.picks.n++; daily.picks.hits += e.eval.pick.hit; simAdd(sim.picks, e); }
    comboAdd(sim.safe, sel.combos.safe); comboAdd(sim.value, sel.combos.value);
    if (sel.picks.length >= 2 && sel.picks.every(e => e.eval)) { daily.full.n++; daily.full.hits += sel.picks.every(e => e.eval.pick.hit); }
  }
  daily.recent = daily.recent.slice(0, 30);
  for (const o of Object.values(sim)) Object.assign(o, { pAvg: o.n ? o.pSum / o.n : null, roi: o.withOdds ? o.profit / o.withOdds : null, clv: o.clvN ? o.clvSum / o.clvN : null });
  // listo para apostar con dinero: 100 pronósticos simulados con cuota, rendimiento no negativo y aciertos a la altura de lo que decía el modelo
  const P = sim.picks;
  sim.ready = { need: SIM_N, have: P.withOdds, ok: P.withOdds >= SIM_N && P.roi >= 0 && P.hits / P.n >= P.pAvg - 0.03 };
  daily.sim = sim;
  // última cuota justa de Pinnacle vista antes de empezar cada partido (para el CLV del registro de apuestas) y resultado
  const closing = {};
  for (const e of Object.values(hist)) if (NOW - Date.parse(e.kickoff) < 120 * 864e5 && (e.fair || e.result))
    closing[e.id] = { ...(e.fair ? { fair: e.fair } : {}), ...(e.result ? { result: e.result } : {}) };
  return { updated: new Date(NOW).toISOString(), sports, leagues, recent, daily, closing };
}

// Mejor cuota disponible para el pronóstico principal (de odds.json). En la validación 2025-26, cobrar los pronósticos de 65% o más
// a la mejor cuota del mercado en vez de a la de Bet365 subía el rendimiento de +0,2% a +2,7%.
const GENERIC = new Set(['club', 'real', 'sporting', 'city', 'united', 'olympique', 'stade', 'racing', 'deportivo', 'athletic', 'union', 'borussia', 'basket', 'calcio', 'football']);
const toks = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !GENERIC.has(t));
const sameTeam = (a, b) => { const A = toks(a), B = toks(b); return A.some(x => B.some(y => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))); };
export function attachBest(matches, odds) {
  let n = 0;
  for (const m of matches) {
    const e = (odds?.best || []).find(e => Math.abs(Date.parse(e.kickoff) - Date.parse(m.kickoff)) <= 3 * 3600e3 && sameTeam(m.home, e.home) && sameTeam(m.away, e.away));
    const b = e && e[m.pick.code];
    if (b) { m.best = { odds: b[0], book: b[1], ...(e.fair?.[m.pick.code] ? { fair: e.fair[m.pick.code] } : {}) }; n++; }
    if (e?.fair) m.fair = e.fair;   // cuotas justas de Pinnacle de todos los resultados (para el registro de apuestas)
  }
  return n;
}
const bestTxt = m => m.best ? ` · mejor cuota ${String(m.best.odds).replace('.', ',')} (${html(m.best.book)})` : '';

async function telegram(text) {
  const token = process.env.TELEGRAM_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const chunks = []; let cur = '';
  const add = part => { if ((cur + part).length > 3800 && cur) { chunks.push(cur); cur = ''; } cur += part + '\n\n'; };
  for (const sec of Array.isArray(text) ? text : text.split('\n\n')) {
    if (sec.length <= 3800) { add(sec); continue; }
    for (const line of sec.replace(/<\/?blockquote[^>]*>/g, '').split('\n')) add(line);   // sección enorme: se parte por líneas (sin desplegable)
  }
  if (cur.trim()) chunks.push(cur);
  for (const c of chunks) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: c, parse_mode: 'HTML', disable_web_page_preview: true }) });
    if (!r.ok) { console.log('AVISO: Telegram respondió', r.status, (await r.text()).slice(0, 200)); return false; }
  }
  return true;
}
const html = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pc = p => Math.round(p * 100) + '%';
// emojis para Telegram (en el móvil se ven las banderas)
const FLAG_EMOJI = { SP1: '🇪🇸', SP2: '🇪🇸', SP3: '🇪🇸', E0: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', E1: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', I1: '🇮🇹', I2: '🇮🇹', D1: '🇩🇪', D2: '🇩🇪', F1: '🇫🇷', F2: '🇫🇷', N1: '🇳🇱', P1: '🇵🇹',
  SC0: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', SC1: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', B1: '🇧🇪', T1: '🇹🇷', G1: '🇬🇷', UEFA: '🇪🇺', nba: '🇺🇸', euroliga: '🇪🇺', eurocup: '🇪🇺', acb: '🇪🇸', lega: '🇮🇹', bbl: '🇩🇪', lnb: '🇫🇷', gbl: '🇬🇷', bsl: '🇹🇷' };
const tag = m => `${m.sport === 'futbol' ? '⚽' : '🏀'}${FLAG_EMOJI[m.league] || ''}`;
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Filtros de config.json -> telegram: equipos, competiciones, confianza mínima
export function filterForAlerts(matches, cfg = {}) {
  const teams = (cfg.equipos || []).map(norm), comps = (cfg.competiciones || []).map(norm), min = +cfg.confianza_minima || 0;
  return matches.filter(m => (!teams.length || teams.some(t => norm(m.home).includes(t) || norm(m.away).includes(t)))
    && (!comps.length || comps.some(c => norm(m.league) === c || norm(m.leagueName).includes(c) || norm(m.sport) === c))
    && m.pick.p >= min);
}
export function digest(matches, perf, day, cfg = {}, sel = null) {
  const todays = filterForAlerts(matches.filter(m => slateDay(Date.parse(m.kickoff)) === day && Date.parse(m.kickoff) > NOW), cfg)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (!todays.length) return null;
  const topMin = Math.max(0.6, +cfg.confianza_minima || 0), top = todays.filter(m => m.pick.p >= topMin);
  const filtered = (cfg.equipos || []).length || (cfg.competiciones || []).length || +cfg.confianza_minima > 0;
  const when = m => m.noTime ? '--:--' : madridTime(Date.parse(m.kickoff)) + (madridDate(Date.parse(m.kickoff)) !== day ? ' 🌙' : '');
  const state = m => Date.parse(m.kickoff) > NOW ? '' : m.eval ? (m.eval.pick.hit ? ' · ✅ acertado' : ' · ❌ fallado') : ' · ⏳ ya empezado';
  const odds = x => String(x.toFixed(2)).replace('.', ',');
  const SEP = '━━━━━━━━━━━━━━━━';
  const sportName = m => m.sport === 'futbol' ? '⚽ FÚTBOL' : '🏀 BALONCESTO';
  const head = m => `${tag(m)} ${html(m.leagueName)} · 🕒 ${when(m)}`;
  const pickLine = m => `🎯 <b>${html(m.pick.label)}</b> · ${pc(m.pick.p)} · justa ${odds(1 / m.pick.p)}${m.best && Date.parse(m.kickoff) > NOW ? ` · 💰 ${odds(m.best.odds)} en ${html(m.best.book)}` : ''}${state(m)}`;
  const nFb = todays.filter(m => m.sport === 'futbol').length, nBk = todays.length - nFb;
  const date = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.parse(day + 'T12:00:00Z')));
  const S = [];   // secciones: el envío parte el mensaje por secciones, nunca dentro de una
  S.push(`📅 <b>PRONÓSTICOS DE HOY</b>\n<i>${html(date.charAt(0).toUpperCase() + date.slice(1))}</i>\n${[nFb && `⚽ ${nFb}`, nBk && `🏀 ${nBk}`].filter(Boolean).join(' · ')} · ${todays.length} ${todays.length === 1 ? 'partido' : 'partidos'}${filtered ? ' (según tus filtros)' : ''}`);
  if (sel && sel.day === day) {
    const b = sel.bet;
    S.push(`${SEP}\n⭐ <b>APUESTA DEL DÍA</b>\n\n${head(b)}\n<b>${html(b.home)} – ${html(b.away)}</b>\n${pickLine(b)}`
      + (b.why?.length ? `\n<blockquote>${b.why.map(w => '• ' + html(w)).join('\n')}</blockquote>` : ''));
    if (sel.picks.length >= 2) {
      const all = sel.picks.reduce((x, e) => x * e.pick.p, 1), N = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
      S.push(`${SEP}\n🧩 <b>SELECCIÓN RECOMENDADA</b>\n<i>Todas juntas: ${pc(all)} · cuota justa ${odds(1 / all)}</i>\n\n`
        + sel.picks.slice().sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map((e, k) => `${N[k] || '▫️'} ${head(e)}\n<b>${html(e.home)} – ${html(e.away)}</b>\n${pickLine(e)}`).join('\n\n'));
    }
  }
  if (sel && sel.day === day && (sel.combos?.safe || sel.combos?.value)) {
    const C = (t, c, note) => c ? `<b>${t}</b> · acertarla ${pc(c.p)} · justa ${odds(c.fair)}${c.odds ? ` · mejores cuotas ${odds(c.odds)}` : ''}\n`
      + c.ids.map(id => sel.picks.concat([sel.bet]).find(e => e.id === id) || matches.find(m => m.id === id)).filter(Boolean)
        .map(e => `   • ${tag(e)} ${html(e.home)} – ${html(e.away)}: <b>${html(e.pick.label)}</b> ${pc(e.pick.p)}`).join('\n') : `<b>${t}</b>: ${note}`;
    S.push(`${SEP}\n🎰 <b>COMBINADAS</b> <i>(máx. ${COMBO_MAX} partidos)</i>\n\n${C('🛡️ Segura', sel.combos.safe, 'hoy no hay 2 pronósticos del 65% o más')}\n\n${C('💎 Con valor', sel.combos.value, 'hoy no hay pronósticos con valor suficiente')}`);
  }
  if (top.length) S.push(`${SEP}\n🔥 <b>MÁS CONFIANZA</b> <i>(${pc(topMin)} o más)</i>\n\n` + top.slice().sort((a, b) => b.pick.p - a.pick.p).slice(0, 10)
    .map(m => `${tag(m)} <code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n    ${pickLine(m)}`).join('\n'));
  if (cfg.incluir_todos !== false) {
    S.push(`${SEP}\n📋 <b>TODOS LOS PARTIDOS</b> <i>(toca para desplegar)</i>`);
    for (const sp of ['futbol', 'basket']) {
      const list = todays.filter(m => (m.sport === 'futbol') === (sp === 'futbol')).slice(0, 40);
      if (!list.length) continue;
      const leagues = [...new Map(list.map(m => [m.league, m])).values()];
      S.push(`<b>${sportName(list[0])}</b>\n<blockquote expandable>` + leagues.map(L => `${FLAG_EMOJI[L.league] || '🏳️'} <u>${html(L.leagueName)}</u>\n` + list.filter(m => m.league === L.league).map(m => m.sport === 'futbol'
        ? `<code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n      1 ${pc(m.H)} · X ${pc(m.D)} · 2 ${pc(m.A)} · +2,5 ${pc(m.o25)}${m.ref ? `\n      🟨 Árbitro: ${html(m.ref)}` : ''}`
        : `<code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n      ${html(m.pick.label)} ${pc(m.pick.p)} · ${Math.round(m.ph)}-${Math.round(m.pa)}`).join('\n')).join('\n\n') + '</blockquote>');
    }
  }
  const y = perf.recent.filter(r => r.date < day).slice(0, 30), hits = y.filter(r => r.hit).length, sm = perf.daily?.sim?.picks;
  const foot = [y.length ? `📈 <b>Últimos ${y.length} pronósticos:</b> ${hits} ✅ · ${y.length - hits} ❌ (${pc(hits / y.length)})` : '',
    sm?.n ? `🧪 <b>Simulación de la selección:</b> ${sm.hits} de ${sm.n} (${pc(sm.hits / sm.n)}, el modelo esperaba ${pc(sm.pAvg)})${sm.withOdds ? ` · rendimiento ${sm.roi >= 0 ? '+' : ''}${(sm.roi * 100).toFixed(1).replace('.', ',')}% en ${sm.withOdds} con cuota` : ''} · ${perf.daily.sim.ready.ok ? '✅ lista para apostar' : `${Math.min(sm.withOdds, SIM_N)}/${SIM_N} para fiarse`}` : '', process.env.PAGES_URL ? `🔗 ${process.env.PAGES_URL}` : ''].filter(Boolean);
  if (foot.length) S.push(`${SEP}\n${foot.join('\n')}`);
  return S;   // lista de secciones
}

async function main() {
  const F = read(path.join(DATA, 'football.json'));
  const B = { nba: read(path.join(DATA, 'nba.json')), euroliga: read(path.join(DATA, 'euroliga.json')), extra: read(path.join(DATA, 'basket_extra.json')) };
  const fixtures = read(path.join(DATA, 'fixtures.json'), {}), inj = read(path.join(DATA, 'injuries.json'), {}), cfg = read(path.join(ROOT, 'config.json'), {});
  const U = read(path.join(DATA, 'uefa.json'), { results: [] });
  const { matches, skipped } = predictAll(F, B, fixtures, inj.teams || {});
  const nBest = attachBest(matches, read(path.join(DATA, 'odds.json'), {}));
  if (skipped.length) console.log(`AVISO: ${skipped.length} partidos sin datos suficientes (equipo nuevo o nombre distinto):`, skipped.slice(0, 10).join(', '));
  // historial: se guarda el último pronóstico antes del inicio
  const histFile = path.join(STATE, 'history.json'), hist = read(histFile, {});
  for (const m of matches) if (Date.parse(m.kickoff) > NOW) hist[m.id] = { ...m, savedAt: new Date(NOW).toISOString() };
  let evaluated = 0;
  for (const [id, e] of Object.entries(hist)) {
    if (e.eval) continue;
    const age = NOW - Date.parse(e.kickoff);
    if (age < 3 * 3600e3) continue;
    const res = findResult(e, F, B, U);
    if (res) { e.result = res; e.eval = evaluate(e); evaluated++; }
    else if (age > 14 * 864e5) delete hist[id];   // aplazado, europeo sin resultado o nunca publicado
  }
  for (const [id, e] of Object.entries(hist)) if (NOW - Date.parse(e.kickoff) > 400 * 864e5) delete hist[id];
  const perf = performance(hist);
  write(histFile, hist);
  write(path.join(DATA, 'performance.json'), perf);
  const sel = dailyFor(Object.values(hist));
  const withHit = e => e.eval ? { ...e, hit: e.eval.pick.hit } : e;
  const byIdAll = Object.fromEntries(Object.values(hist).map(e => [e.id, e]));
  const comboOut = c => c && { ...c, legs: c.ids.map(id => withHit(byIdAll[id])) };
  const daily = sel && { day: sel.day, bet: withHit(sel.bet), picks: sel.picks.map(withHit), combos: { safe: comboOut(sel.combos.safe), value: comboOut(sel.combos.value) } };
  write(path.join(DATA, 'predictions.json'), { generated: new Date(NOW).toISOString(), daily, matches: matches.filter(m => Date.parse(m.kickoff) > NOW - 3 * 3600e3) });
  console.log(`pronósticos: ${matches.length} partidos · con mejor cuota: ${nBest} · evaluados ahora: ${evaluated} · historial: ${Object.keys(hist).length}`);
  // resumen diario por Telegram, a partir de la hora configurada (8:00 por defecto, hora de Madrid)
  const tg = cfg.telegram || {}, stFile = path.join(STATE, 'state.json'), st = read(stFile, {}), day = madridDate(NOW);
  const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date(NOW));
  if (tg.activo !== false && hour >= (+tg.hora || 8) && st.lastDigest !== day) {
    const t = digest(matches, perf, slateDay(NOW), tg, sel);
    if (t && await telegram(t)) { st.lastDigest = day; write(stFile, st); console.log('resumen enviado a Telegram'); }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
