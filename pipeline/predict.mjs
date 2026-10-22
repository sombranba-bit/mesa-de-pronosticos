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
// ---------- Tenis: partidos de ESPN de las próximas 48 h, con el Elo (general + superficie + cuotas pasadas) de la app ----------
const SURF_ES = ['pista dura', 'tierra', 'hierba', 'moqueta'];
export function predictTennis(T, fx = []) {
  if (!T || !fx.length) return [];
  const E = M.runElo(T, { from: Infinity }), ix = new Map(T.players.map((p, i) => [p, i])), out = [];
  for (const f of fx) {
    const ia = ix.get(f.a), ib = ix.get(f.b);
    if (ia == null || ib == null || ia === ib || E.N[ia] < 10 || E.N[ib] < 10) continue;   // jugadores con pocos partidos: sin pronóstico
    const p3 = M.eloProb(E, ia, ib, f.surf), p = f.bo === 5 ? M.bo3to5(p3) : p3, home = p >= 0.5, tour = f.tour ? 'wta' : 'atp';
    out.push({ id: `tenis|${tour}|${f.kickoff.slice(0, 10)}|${f.a}|${f.b}`, sport: 'tenis', league: tour, leagueName: `${tour.toUpperCase()} · ${f.tourn}`, kickoff: f.kickoff,
      ...(f.noTime ? { noTime: true } : {}), home: f.a, away: f.b, pw: p, surf: f.surf, bo: f.bo, round: f.round || '',
      pick: { market: 'Ganador', label: `Gana ${home ? f.a : f.b}`, p: Math.max(p, 1 - p), code: home ? 'H' : 'A' },
      why: [`Elo ${Math.round(E.R[ia])} frente a ${Math.round(E.R[ib])}`, `En ${SURF_ES[f.surf]}: ${Math.round(E.S[f.surf][ia])} frente a ${Math.round(E.S[f.surf][ib])}`,
        ...(f.bo === 5 ? ['A cinco sets: el favorito tiene más margen'] : [])] });
  }
  return out;
}
export function tennisResult(e, T) {
  if (!T) return null;
  const d0 = Math.floor(Date.parse(e.kickoff) / 864e5), ix = new Map(T.players.map((p, i) => [p, i])), a = ix.get(e.home), b = ix.get(e.away);
  if (a == null || b == null) return null;
  for (let k = T.date.length - 1; k >= 0 && T.date[k] >= d0 - 2; k--) {
    if (T.date[k] > d0 + 2 || !((T.w[k] === a && T.l[k] === b) || (T.w[k] === b && T.l[k] === a))) continue;
    if (!T.completed[k]) return null;   // retirada o walkover: las casas suelen anularlo; no cuenta
    let ws = 0, ls = 0; for (let i = 1; i <= 5; i++) { const W = T['W' + i][k], L = T['L' + i][k]; if (W == null || L == null) break; if (W > L) ws++; else if (L > W) ls++; }
    if (!ws) ws = 1;
    return T.w[k] === a ? { hp: ws, ap: ls } : { hp: ls, ap: ws };
  }
  return null;
}
function findResult(e, F, B, U, T) {
  if (e.sport === 'tenis') return tennisResult(e, T);
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

// TELEGRAM_CHAT_ID admite varios destinos separados por comas (tu chat privado y el grupo, por ejemplo)
const chatIds = () => String(process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
async function telegram(text, chats = chatIds()) {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token || !chats.length) return false;
  const chunks = []; let cur = '';
  const add = part => { if ((cur + part).length > 3800 && cur) { chunks.push(cur); cur = ''; } cur += part + '\n\n'; };
  for (const sec of Array.isArray(text) ? text : text.split('\n\n')) {
    if (sec.length <= 3800) { add(sec); continue; }
    for (const line of sec.replace(/<\/?blockquote[^>]*>/g, '').split('\n')) add(line);   // sección enorme: se parte por líneas (sin desplegable)
  }
  if (cur.trim()) chunks.push(cur);
  let ok = true;
  for (const chat of chats) for (const c of chunks) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: c, parse_mode: 'HTML', disable_web_page_preview: true }) });
    if (!r.ok) { console.log('AVISO: Telegram respondió', r.status, (await r.text()).slice(0, 200)); ok = false; break; }
  }
  return ok;
}
const html = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pc = p => Math.round(p * 100) + '%';
// emojis para Telegram (en el móvil se ven las banderas)
const FLAG_EMOJI = { SP1: '🇪🇸', SP2: '🇪🇸', SP3: '🇪🇸', E0: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', E1: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', I1: '🇮🇹', I2: '🇮🇹', D1: '🇩🇪', D2: '🇩🇪', F1: '🇫🇷', F2: '🇫🇷', N1: '🇳🇱', P1: '🇵🇹',
  SC0: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', SC1: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', B1: '🇧🇪', T1: '🇹🇷', G1: '🇬🇷', UEFA: '🇪🇺', nba: '🇺🇸', euroliga: '🇪🇺', eurocup: '🇪🇺', acb: '🇪🇸', lega: '🇮🇹', bbl: '🇩🇪', lnb: '🇫🇷', gbl: '🇬🇷', bsl: '🇹🇷', atp: '🎾', wta: '🎾' };
const tag = m => m.sport === 'tenis' ? '🎾' : `${m.sport === 'futbol' ? '⚽' : '🏀'}${FLAG_EMOJI[m.league] || ''}`;
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
  const sportName = m => m.sport === 'futbol' ? '⚽ FÚTBOL' : m.sport === 'tenis' ? '🎾 TENIS' : '🏀 BALONCESTO';
  const head = m => `${tag(m)} ${html(m.leagueName)} · 🕒 ${when(m)}`;
  const pickLine = m => `🎯 <b>${html(m.pick.label)}</b> · ${pc(m.pick.p)} · justa ${odds(1 / m.pick.p)}${m.best && Date.parse(m.kickoff) > NOW ? ` · 💰 ${odds(m.best.odds)} en ${html(m.best.book)}` : ''}${state(m)}`;
  const nFb = todays.filter(m => m.sport === 'futbol').length, nTn = todays.filter(m => m.sport === 'tenis').length, nBk = todays.length - nFb - nTn;
  const date = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.parse(day + 'T12:00:00Z')));
  const S = [];   // secciones: el envío parte el mensaje por secciones, nunca dentro de una
  S.push(`📅 <b>PRONÓSTICOS DE HOY</b>\n<i>${html(date.charAt(0).toUpperCase() + date.slice(1))}</i>\n${[nFb && `⚽ ${nFb}`, nBk && `🏀 ${nBk}`, nTn && `🎾 ${nTn}`].filter(Boolean).join(' · ')} · ${todays.length} ${todays.length === 1 ? 'partido' : 'partidos'}${filtered ? ' (según tus filtros)' : ''}`);
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
    const grp = m => m.sport === 'futbol' ? 'futbol' : m.sport === 'tenis' ? 'tenis' : 'basket';
    for (const sp of ['futbol', 'basket', 'tenis']) {
      const list = todays.filter(m => grp(m) === sp).slice(0, 40);
      if (!list.length) continue;
      const lk = m => m.sport === 'tenis' ? m.leagueName : m.league;   // en tenis, cada torneo por separado
      const leagues = [...new Map(list.map(m => [lk(m), m])).values()];
      S.push(`<b>${sportName(list[0])}</b>\n<blockquote expandable>` + leagues.map(L => `${FLAG_EMOJI[L.league] || '🏳️'} <u>${html(L.leagueName)}</u>\n` + list.filter(m => lk(m) === lk(L)).map(m => m.sport === 'futbol'
        ? `<code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n      1 ${pc(m.H)} · X ${pc(m.D)} · 2 ${pc(m.A)} · +2,5 ${pc(m.o25)}${m.ref ? `\n      🟨 Árbitro: ${html(m.ref)}` : ''}`
        : m.sport === 'tenis' ? `<code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n      ${html(m.pick.label)} ${pc(m.pick.p)}${m.round ? ` · ${html(m.round)}` : ''}`
        : `<code>${when(m)}</code> ${html(m.home)} – ${html(m.away)}\n      ${html(m.pick.label)} ${pc(m.pick.p)} · ${Math.round(m.ph)}-${Math.round(m.pa)}`).join('\n')).join('\n\n') + '</blockquote>');
    }
  }
  const y = perf.recent.filter(r => r.date < day).slice(0, 30), hits = y.filter(r => r.hit).length, sm = perf.daily?.sim?.picks;
  const foot = [y.length ? `📈 <b>Últimos ${y.length} pronósticos:</b> ${hits} ✅ · ${y.length - hits} ❌ (${pc(hits / y.length)})` : '',
    sm?.n ? `🧪 <b>Simulación de la selección:</b> ${sm.hits} de ${sm.n} (${pc(sm.hits / sm.n)}, el modelo esperaba ${pc(sm.pAvg)})${sm.withOdds ? ` · rendimiento ${sm.roi >= 0 ? '+' : ''}${(sm.roi * 100).toFixed(1).replace('.', ',')}% en ${sm.withOdds} con cuota` : ''} · ${perf.daily.sim.ready.ok ? '✅ lista para apostar' : `${Math.min(sm.withOdds, SIM_N)}/${SIM_N} para fiarse`}` : '', process.env.PAGES_URL ? `🔗 ${process.env.PAGES_URL}` : ''].filter(Boolean);
  if (foot.length) S.push(`${SEP}\n${foot.join('\n')}`);
  return S;   // lista de secciones
}

// ---------- Más mensajes del bot: resultados de la noche, avisos de valor, resumen semanal y comandos ----------
const odds2 = x => x.toFixed(2).replace('.', ',');
const dayLong = day => { const t = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.parse(day + 'T12:00:00Z'))); return t.charAt(0).toUpperCase() + t.slice(1); };
const mark = e => !e ? '⏳' : e.eval ? (e.eval.pick.hit ? '✅' : '❌') : '⏳';
const score = e => e?.result ? ` <i>(${e.result.hg ?? e.result.hp}-${e.result.ag ?? e.result.ap})</i>` : '';
const rateTxt = (h, n) => n ? `${h} de ${n} (${pc(h / n)})` : 'sin datos';
export const valueEdge = e => { if (!e.best?.odds) return -1; return e.best.odds / Math.max(1 / e.pick.p, e.fair?.[e.pick.code] || 0) - 1; };

// Resultados de la jornada (por la noche): apuesta del día, selección, combinadas y todos los pronósticos
export function nightResults(hist, day, porra = null) {
  const all = Object.values(hist), sel = dailyPicks(all, day);
  if (!sel) return null;
  const d = all.filter(e => slateDay(Date.parse(e.kickoff)) === day), done = d.filter(e => e.eval), byId = Object.fromEntries(all.map(e => [e.id, e]));
  const line = e => `${mark(e)} ${tag(e)} ${html(e.home)} – ${html(e.away)}${score(e)}\n      ${html(e.pick.label)} · ${pc(e.pick.p)}`;
  const S = [`🌙 <b>RESULTADOS DE HOY</b>\n<i>${html(dayLong(day))}</i>`];
  S.push(`━━━━━━━━━━━━━━━━\n⭐ <b>APUESTA DEL DÍA</b>\n${line(sel.bet)}`);
  if (sel.picks.length >= 2) { const ok = sel.picks.filter(e => e.eval?.pick.hit).length, fin = sel.picks.filter(e => e.eval).length;
    S.push(`━━━━━━━━━━━━━━━━\n🧩 <b>SELECCIÓN</b> · ${ok} de ${fin} acertados${fin < sel.picks.length ? ` · ${sel.picks.length - fin} ⏳ pendientes` : ''}\n` + sel.picks.map(line).join('\n')); }
  const cLine = (t, c) => { if (!c) return null; const L = c.ids.map(id => byId[id]); const st = L.some(e => e?.eval && !e.eval.pick.hit) ? '❌ fallada' : L.every(e => e?.eval?.pick.hit) ? '✅ acertada' : '⏳ en juego';
    return `${t}: <b>${st}</b> · acertarla era un ${pc(c.p)}${c.odds ? ` · cuota ${odds2(c.odds)}` : ''}`; };
  const cs = [cLine('🛡️ Segura', sel.combos.safe), cLine('💎 Con valor', sel.combos.value)].filter(Boolean);
  if (cs.length) S.push(`━━━━━━━━━━━━━━━━\n🎰 <b>COMBINADAS</b>\n${cs.join('\n')}`);
  if (porra) { const t = porraText(porraTable(porra, hist, [day]), '🏆 <b>PORRA DE HOY</b>'); if (t) S.push(`━━━━━━━━━━━━━━━━\n${t}`); }
  const rk = betStreak(hist, day);
  if (rk.hit && rk.n >= 3) S.push(`🔥 <b>¡La apuesta del día lleva ${rk.n} aciertos seguidos!</b>`);   // las malas rachas solo en el resumen semanal
  const h = done.filter(e => e.eval.pick.hit).length;
  S.push(`━━━━━━━━━━━━━━━━\n📊 <b>Todos los pronósticos del día:</b> ${rateTxt(h, done.length)}${d.length > done.length ? ` · ${d.length - done.length} ⏳ por jugar (cuentan mañana)` : ''}`);
  return S;
}

// Avisos de valor: pronósticos de las próximas 30 h cuya mejor cuota paga un 3% más que la justa (y que Pinnacle). Uno por partido.
export const VALUE_ALERT = 0.03;
export function valueAlerts(matches, alerted = {}, now = NOW) {
  const c = matches.filter(m => !alerted[m.id] && m.pick.p >= 0.5 && Date.parse(m.kickoff) > now + 20 * 60e3 && Date.parse(m.kickoff) < now + 30 * 3600e3 && valueEdge(m) >= VALUE_ALERT)
    .sort((a, b) => valueEdge(b) - valueEdge(a)).slice(0, 6);
  if (!c.length) return null;
  const when = m => m.noTime ? '--:--' : madridTime(Date.parse(m.kickoff));
  return { ids: c.map(m => m.id), text: [`💎 <b>AVISO DE VALOR</b>\n<i>La mejor cuota paga más que la cuota justa del modelo${c.some(m => m.fair) ? ' y que Pinnacle' : ''}</i>`,
    ...c.map(m => `${tag(m)} ${html(m.leagueName)} · 🕒 ${when(m)}\n<b>${html(m.home)} – ${html(m.away)}</b>\n🎯 <b>${html(m.pick.label)}</b> · ${pc(m.pick.p)} · justa ${odds2(1 / m.pick.p)}\n💰 ${odds2(m.best.odds)} en ${html(m.best.book)} <b>(+${(valueEdge(m) * 100).toFixed(1).replace('.', ',')}%)</b>`),
    `<i>Antes de apostar, mira la cuota de tu casa: si paga menos de la justa, no compensa.</i>`] };
}

// Resumen semanal (lunes): los 7 días anteriores
export function weeklySummary(hist, perf, now = NOW, porra = null) {
  const all = Object.values(hist), today = slateDay(now), days = [];
  for (let k = 7; k >= 1; k--) days.push(slateDay(now - k * 864e5));
  let bet = [0, 0], pk = [0, 0], pSum = 0, safe = [0, 0], val = [0, 0], prof = 0, nOdds = 0;
  const byId = Object.fromEntries(all.map(e => [e.id, e]));
  for (const day of days) {
    const sel = dailyPicks(all, day); if (!sel) continue;
    if (sel.bet.eval) { bet[1]++; bet[0] += sel.bet.eval.pick.hit; }
    for (const e of sel.picks) if (e.eval) { pk[1]++; pk[0] += e.eval.pick.hit; pSum += e.pick.p; if (e.best?.odds > 1) { nOdds++; prof += e.eval.pick.hit ? e.best.odds - 1 : -1; } }
    for (const [o, c] of [[safe, sel.combos.safe], [val, sel.combos.value]]) if (c && c.ids.every(id => byId[id]?.eval)) { o[1]++; o[0] += c.ids.every(id => byId[id].eval.pick.hit); }
  }
  if (!pk[1] && !bet[1]) return null;
  const sm = perf?.daily?.sim, f = d => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(Date.parse(d + 'T12:00:00Z')));
  return [`📅 <b>RESUMEN SEMANAL</b>\n<i>${f(days[0])} – ${f(days[6])}</i>`,
    `━━━━━━━━━━━━━━━━\n⭐ Apuesta del día: <b>${rateTxt(...bet)}</b>\n🧩 Selección: <b>${rateTxt(...pk)}</b>${pk[1] ? ` · el modelo esperaba ${pc(pSum / pk[1])}` : ''}\n🎰 Combinada segura: ${rateTxt(...safe)} · con valor: ${rateTxt(...val)}`
      + (nOdds ? `\n💰 Rendimiento a la mejor cuota: <b>${prof >= 0 ? '+' : ''}${(prof / nOdds * 100).toFixed(1).replace('.', ',')}%</b> en ${nOdds} pronósticos` : ''),
    (() => { const rk = betStreak(hist, days[6]); return rk.n >= 2 ? `${rk.hit ? '🔥' : '🧊'} Racha de la apuesta del día: ${rk.n} ${rk.hit ? 'aciertos' : 'fallos'} seguidos` : ''; })(),
    porra ? porraText(porraTable(porra, hist, days), '━━━━━━━━━━━━━━━━\n🏆 <b>CLASIFICACIÓN DE LA PORRA</b>') : '',
    sm ? `━━━━━━━━━━━━━━━━\n🧪 Simulación total: ${sm.ready.ok ? '✅ lista para apostar' : `${Math.min(sm.picks.withOdds, sm.ready.need)} de ${sm.ready.need} pronósticos con cuota para fiarse`}` : ''].filter(Boolean);
}

// ---------- Rachas ----------
// Racha de la apuesta del día hasta la última jornada terminada: { n, hit } (n aciertos o fallos seguidos)
export function betStreak(hist, uptoDay) {
  const all = Object.values(hist), days = [...new Set(all.map(e => slateDay(Date.parse(e.kickoff))))].filter(d => d <= uptoDay).sort().reverse();
  let n = 0, hit = null;
  for (const d of days) { const sel = dailyPicks(all, d); if (!sel?.bet.eval) { if (d === uptoDay) continue; break; }
    const h = !!sel.bet.eval.pick.hit; if (hit === null) hit = h; if (h !== hit) break; n++; }
  return { n, hit };
}

// ---------- Porra: encuestas en el grupo y clasificación con «la máquina» como un jugador más ----------
export const PORRA_N = 3, MACHINE = '🤖 La máquina';
const outcomeCode = e => { const r = e.result; if (!r) return null; return r.hg != null ? (r.hg > r.ag ? 'H' : r.hg === r.ag ? 'D' : 'A') : (r.hp > r.ap ? 'H' : 'A'); };
export function porraMatches(sel, matches, now = NOW) {   // la apuesta del día y los más destacados, de deportes distintos si se puede
  if (!sel) return [];
  const up = matches.filter(m => slateDay(Date.parse(m.kickoff)) === sel.day && !m.noTime && Date.parse(m.kickoff) > now + 90 * 60e3).sort((a, b) => b.pick.p - a.pick.p);
  const out = []; const bet = up.find(m => m.id === sel.bet.id); if (bet) out.push(bet);
  for (const m of up) if (out.length < PORRA_N && !out.includes(m) && !out.some(x => x.sport === m.sport)) out.push(m);
  for (const m of up) if (out.length < PORRA_N && !out.includes(m)) out.push(m);
  return out;
}
export function porraPoll(m) {
  const codes = m.sport === 'futbol' ? ['H', 'D', 'A'] : ['H', 'A'];
  const machine = m.sport === 'futbol' ? [['H', m.H], ['D', m.D], ['A', m.A]].reduce((b, x) => x[1] > b[1] ? x : b)[0] : m.pick.code;
  return { codes, machine, question: `🏆 Porra · ${m.home} – ${m.away} (${m.noTime ? '' : madridTime(Date.parse(m.kickoff)) + ', '}${m.leagueName})`.slice(0, 300),
    options: codes.map(c => c === 'D' ? 'Empate' : `Gana ${c === 'H' ? m.home : m.away}`.slice(0, 100)) };
}
// puntos por jugador en las jornadas indicadas (1 por acierto); la máquina juega con el resultado más probable del modelo
export function porraTable(porra, hist, days) {
  const T = {}, add = (name, pt) => { const x = T[name] || (T[name] = { pts: 0, n: 0 }); x.n++; x.pts += pt; };
  for (const p of Object.values(porra || {})) {
    if (!days.includes(p.day)) continue; const y = outcomeCode(hist[p.id] || {}); if (!y) continue;
    add(MACHINE, p.machine === y ? 1 : 0);
    for (const v of Object.values(p.votes || {})) add(v.name, v.code === y ? 1 : 0);
  }
  return Object.entries(T).sort((a, b) => b[1].pts - a[1].pts || a[1].n - b[1].n);
}
export const porraText = (rows, title) => rows.length ? `${title}\n` + rows.map(([n, x], i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${html(n)}: <b>${x.pts}</b> de ${x.n}`).join('\n') : '';

// Comandos que el bot entiende (se contestan en la siguiente ejecución, como mucho en una hora)
export const COMMANDS = [['hoy', 'Pronósticos de hoy: apuesta del día, selección y combinadas'], ['combinada', 'Combinadas de hoy'],
  ['resultados', 'Cómo van los pronósticos de hoy'], ['semana', 'Resumen de los últimos 7 días'], ['valor', 'Pronósticos con valor ahora mismo'], ['porra', 'Clasificación de la porra de la semana'], ['ayuda', 'Lista de comandos']];
export const helpText = () => '🤖 <b>Comandos de Aldana Bet</b>\n' + COMMANDS.map(([c, d]) => `/${c} · ${d}`).join('\n') + '\n\n<i>Contesto en la siguiente actualización (como mucho en una hora).</i>';
export const welcomeText = names => `👋 <b>¡Bienvenid${names.length > 1 ? 'os' : 'o/a'}, ${names.map(html).join(', ')}!</b>\n\nEsto es <b>Aldana Bet</b>: pronósticos de fútbol, baloncesto y tenis calculados con datos.\n⭐ Cada mañana a las 8:00: apuesta del día, selección y combinadas.\n🌙 Por la noche: resultados, con aciertos y fallos.\n💎 Avisos cuando aparece una cuota con valor.\n\n${helpText()}\n\n🔞 +18 · Juega con responsabilidad.`;
export function parseCommands(updates, allowed) {
  const out = [];
  for (const u of updates) { const m = u.message || u.channel_post; if (!m) continue;
    if (allowed.length && !allowed.includes(String(m.chat.id))) continue;   // solo responde en tus chats
    const joined = (m.new_chat_members || []).filter(x => !x.is_bot);
    if (joined.length) { out.push({ chat: String(m.chat.id), cmd: 'bienvenida', names: joined.map(x => x.first_name || x.username || 'nuevo miembro') }); continue; }
    if (!m.text?.startsWith('/')) continue;
    const cmd = m.text.slice(1).split(/[\s@]/)[0].toLowerCase(); if (COMMANDS.some(c => c[0] === cmd) || cmd === 'start') out.push({ chat: String(m.chat.id), cmd }); }
  return out;
}
async function tgApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.ok ? (await r.json()).result : null;
}

async function main() {
  const F = read(path.join(DATA, 'football.json'));
  const B = { nba: read(path.join(DATA, 'nba.json')), euroliga: read(path.join(DATA, 'euroliga.json')), extra: read(path.join(DATA, 'basket_extra.json')) };
  const fixtures = read(path.join(DATA, 'fixtures.json'), {}), inj = read(path.join(DATA, 'injuries.json'), {}), cfg = read(path.join(ROOT, 'config.json'), {});
  const U = read(path.join(DATA, 'uefa.json'), { results: [] });
  const { matches, skipped } = predictAll(F, B, fixtures, inj.teams || {});
  const Tn = read(path.join(DATA, 'tennis.json'));
  const tn = predictTennis(Tn, fixtures.tennis || []); matches.push(...tn);
  if ((fixtures.tennis || []).length) console.log(`tenis: ${tn.length} pronósticos de ${fixtures.tennis.length} partidos próximos (los demás, jugadores con pocos datos)`);
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
    const res = findResult(e, F, B, U, Tn);
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
  if (tg.activo === false || !process.env.TELEGRAM_TOKEN) return;
  const slate = slateDay(NOW), save = () => write(stFile, st);
  // resultados de la noche (a partir de las 23:00)
  if (tg.resultados !== false && hour >= 23 && st.lastNight !== slate) {
    const t = nightResults(hist, slate, st.porra);
    if (t && await telegram(t)) console.log('resultados de la noche enviados');
    st.lastNight = slate; save();
  }
  // avisos de valor (de 9:00 a 23:00)
  if (tg.avisos_valor !== false && hour >= 9 && hour < 23) {
    st.alerted = Object.fromEntries(Object.entries(st.alerted || {}).filter(([, t]) => NOW - t < 3 * 864e5));
    const a = valueAlerts(matches, st.alerted);
    if (a && await telegram(a.text)) { for (const id of a.ids) st.alerted[id] = NOW; console.log(`avisos de valor: ${a.ids.length}`); }
    save();
  }
  // resumen semanal (lunes desde las 9:00)
  const wk = madridDate(NOW - ((new Date(NOW).getUTCDay() + 6) % 7) * 864e5);
  if (tg.semanal !== false && new Date(NOW).getUTCDay() === 1 && hour >= 9 && st.lastWeekly !== wk) {
    const t = weeklySummary(hist, perf, NOW, st.porra);
    if (t && await telegram(t)) console.log('resumen semanal enviado');
    st.lastWeekly = wk; save();
  }
  // recordatorio de la apuesta del día (entre 30 y 90 minutos antes; el proceso va por horas)
  if (tg.recordatorio !== false && sel && sel.day === slate && !sel.bet.noTime && st.reminded !== sel.bet.id) {
    const b = sel.bet, mins = (Date.parse(b.kickoff) - NOW) / 60e3;
    if (mins > 25 && mins <= 95) {
      const t = [`⏰ <b>En ${Math.round(mins)} minutos empieza la apuesta del día</b>`,
        `${tag(b)} ${html(b.leagueName)} · 🕒 ${madridTime(Date.parse(b.kickoff))}\n<b>${html(b.home)} – ${html(b.away)}</b>\n🎯 <b>${html(b.pick.label)}</b> · ${pc(b.pick.p)} · justa ${odds2(1 / b.pick.p)}${b.best ? `\n💰 Mejor cuota ${odds2(b.best.odds)} en ${html(b.best.book)}` : ''}`,
        `<i>Si tu casa paga menos de ${odds2(1 / b.pick.p)}, no compensa.</i>`];
      if (await telegram(t)) { st.reminded = b.id; save(); console.log('recordatorio de la apuesta del día enviado'); }
    }
  }
  // porra: encuestas por la mañana en los grupos, cierre antes de cada partido y votos para la clasificación
  const groups = chatIds().filter(c => c.startsWith('-'));
  st.porra = Object.fromEntries(Object.entries(st.porra || {}).filter(([, p]) => NOW - Date.parse(p.kickoff) < 21 * 864e5));
  if (tg.porra !== false && groups.length && sel && sel.day === slate && hour >= (+tg.hora || 8) && hour < 21 && st.lastPorra !== slate) {   // por la mañana (o hasta las 21:00 si el proceso se retrasa)
    for (const m of porraMatches(sel, matches)) {
      const q = porraPoll(m);
      for (const chat of groups) {
        const msg = await tgApi('sendPoll', { chat_id: chat, question: q.question, options: q.options.map(text => ({ text })), is_anonymous: false });
        if (msg?.poll) st.porra[msg.poll.id] = { day: slate, chat, msg: msg.message_id, id: m.id, kickoff: m.kickoff, codes: q.codes, machine: q.machine, votes: {} };
      }
    }
    st.lastPorra = slate; save(); console.log('porra del día enviada');
  }
  for (const p of Object.values(st.porra)) if (!p.closed && Date.parse(p.kickoff) < NOW + 65 * 60e3) {   // se cierra en la última pasada antes del partido
    await tgApi('stopPoll', { chat_id: p.chat, message_id: p.msg }); p.closed = true; save();
  }
  // comandos (/hoy, /combinada, ...) y votos de la porra: se leen los mensajes nuevos y se contesta en el mismo chat
  if (tg.comandos !== false || tg.porra !== false) {
    const cmdKey = COMMANDS.map(c => c[0]).join();   // se vuelve a registrar el menú si cambia la lista
    if (st.cmdsSet !== cmdKey) { if (await tgApi('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) })) st.cmdsSet = cmdKey; }
    const ups = await tgApi('getUpdates', { offset: (st.tgOffset || 0) + 1, timeout: 0, allowed_updates: ['message', 'channel_post', 'poll_answer'] }) || [];
    for (const u of ups) { const a = u.poll_answer, p = a && st.porra[a.poll_id]; if (!p || p.closed) continue;   // votos (se puede cambiar de voto hasta el cierre)
      const k = String(a.user?.id ?? a.voter_chat?.id), nm = a.user ? [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username || 'Anónimo' : 'Anónimo';
      if (!a.option_ids?.length) delete p.votes[k]; else p.votes[k] = { name: nm, code: p.codes[a.option_ids[0]] }; }   // las altas en el grupo llegan como «message»
    if (ups.length) st.tgOffset = ups[ups.length - 1].update_id;
    // mensaje fijo con los comandos en cada grupo (se vuelve a fijar si cambia la lista)
    const key = COMMANDS.map(c => c[0]).join();
    st.pinned = st.pinned || {};
    for (const chat of chatIds().filter(c => c.startsWith('-'))) {
      let p = st.pinned[chat];
      if (!p || p.key !== key) {   // se envía una sola vez (y otra si cambia la lista de comandos)
        const msg = await tgApi('sendMessage', { chat_id: chat, text: helpText().replace(/\n\n<i>.*<\/i>$/, '\n\n📌 <i>Escribe un comando en el grupo y te contesto en la siguiente actualización (como mucho en una hora).</i>'), parse_mode: 'HTML' });
        if (!msg) continue;
        p = st.pinned[chat] = { key, id: msg.message_id, ok: false };
      }
      if (!p.ok) {   // si el bot aún no puede fijar, lo reintenta cada hora sin volver a enviar el mensaje
        p.ok = !!(await tgApi('pinChatMessage', { chat_id: chat, message_id: p.id, disable_notification: true }));
        console.log(p.ok ? `mensaje de comandos fijado en ${chat}` : 'AVISO: no se pudo fijar el mensaje de comandos (haz al bot administrador con permiso para fijar mensajes)');
      }
    }
    const answered = new Set();
    for (const { chat, cmd, names } of tg.comandos === false ? [] : parseCommands(ups, chatIds())) {
      const k = chat + (cmd === 'start' ? 'ayuda' : cmd);
      if (cmd !== 'bienvenida' && answered.has(k)) continue;   // el mismo comando varias veces en la misma hora: una sola respuesta
      answered.add(k);
      if (cmd === 'bienvenida') { await telegram([welcomeText(names)], [chat]); continue; }
      const full = digest(matches, perf, slate, { ...tg, incluir_todos: false, equipos: [], competiciones: [], confianza_minima: 0 }, sel) || ['Hoy no quedan partidos por jugar.'];
      const ans = cmd === 'hoy' ? full : cmd === 'combinada' ? (full.filter(x => x.includes('COMBINADAS')).length ? full.filter(x => x.includes('COMBINADAS')) : ['Hoy no hay combinadas.'])
        : cmd === 'resultados' ? (nightResults(hist, slate, st.porra) || ['Aún no hay pronósticos de hoy.']) : cmd === 'semana' ? (weeklySummary(hist, perf, NOW, st.porra) || ['Aún no hay datos de la última semana.'])
        : cmd === 'porra' ? [porraText(porraTable(st.porra, hist, [0, 1, 2, 3, 4, 5, 6].map(k => slateDay(NOW - k * 864e5))), '🏆 <b>PORRA · ÚLTIMOS 7 DÍAS</b>') || 'Todavía no hay partidos de la porra terminados.']
        : cmd === 'valor' ? (valueAlerts(matches, {})?.text || ['Ahora mismo no hay pronósticos con valor suficiente.'])
        : [helpText()];
      await telegram(ans, [chat]);
    }
    if (ups.length) console.log(`comandos de Telegram: ${ups.length} mensajes leídos`);
    save();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
