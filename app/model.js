// ===== Motor de cálculo (sin DOM). Fútbol: Dixon-Coles · Baloncesto: rating de puntos · Tenis: Elo por superficie + modelo de puntos =====
const M = (() => {
  // ---------- utilidades ----------
  const sum = a => a.reduce((s, x) => s + x, 0);
  function normCdf(x) { // Abramowitz-Stegun 7.1.26, error < 1.5e-7
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  function bisect(f, lo, hi, it = 60) { // f creciente; devuelve x con f(x)=0
    for (let i = 0; i < it; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // Quitar margen: Shin para 3+ resultados, potencia para 2 (métodos de penaltyblog)
  function fairProbs(odds) {
    if (odds.some(o => !(o > 1))) return null;
    const q = odds.map(o => 1 / o), s = sum(q), n = q.length;
    if (n === 2) { const k = bisect(k => 1 - sum(q.map(x => x ** k)), 0.5, 3); return q.map(x => x ** k); }
    let z = 0;
    for (let i = 0; i < 50; i++) z = (sum(q.map(x => Math.sqrt(z * z + 4 * (1 - z) * x * x / s))) - 2) / (n - 2);
    const p = q.map(x => (Math.sqrt(z * z + 4 * (1 - z) * x * x / s) - z) / (2 * (1 - z)));
    const t = sum(p); return p.map(x => x / t);
  }
  // Mezcla geométrica modelo/mercado: a=0 solo mercado, a=1 solo modelo
  function blend(model, market, a) {
    if (!market || a >= 1) return model;
    const b = model.map((p, i) => market[i] ** (1 - a) * p ** a), t = sum(b); return b.map(x => x / t);
  }
  const kelly = (p, o, frac, cap) => o > 1 ? Math.max(0, Math.min(cap, frac * (p * o - 1) / (o - 1))) : 0;

  // ---------- FÚTBOL: Dixon-Coles con decaimiento temporal ----------
  // Ajuste por punto fijo con pesos exp(-xi*días) y 'prior' partidos ficticios de equipo medio; rho por sección áurea.
  // Verificado contra máxima verosimilitud completa (scipy): mismas probabilidades a 3 decimales.
  function fitDC(rows, ref, xi, prior = 3, iters = 60) {
    const ix = new Map(); for (const r of rows) { if (!ix.has(r.h)) ix.set(r.h, ix.size); if (!ix.has(r.a)) ix.set(r.a, ix.size); }
    const n = ix.size, N = rows.length;
    const H = new Int32Array(N), A = new Int32Array(N), hg = new Float64Array(N), ag = new Float64Array(N), w = new Float64Array(N);
    rows.forEach((r, k) => { H[k] = ix.get(r.h); A[k] = ix.get(r.a); hg[k] = r.hg; ag[k] = r.ag; w[k] = Math.exp(-xi * (ref - r.d)); });
    const sc = new Float64Array(n), cc = new Float64Array(n); let W = 0, G = 0;
    for (let k = 0; k < N; k++) { sc[H[k]] += w[k] * hg[k]; sc[A[k]] += w[k] * ag[k]; cc[H[k]] += w[k] * ag[k]; cc[A[k]] += w[k] * hg[k]; W += w[k]; G += w[k] * (hg[k] + ag[k]); }
    const avg = G / (2 * W);
    let att = new Float64Array(n).fill(1), def = new Float64Array(n).fill(1), home = 1.3;
    const den = new Float64Array(n);
    for (let it = 0; it < iters; it++) {
      den.fill(0); for (let k = 0; k < N; k++) { den[H[k]] += w[k] * def[A[k]] * home; den[A[k]] += w[k] * def[H[k]]; }
      for (let i = 0; i < n; i++) att[i] = (sc[i] + prior * avg) / (den[i] + prior * avg);
      den.fill(0); for (let k = 0; k < N; k++) { den[H[k]] += w[k] * att[A[k]]; den[A[k]] += w[k] * att[H[k]] * home; }
      for (let i = 0; i < n; i++) def[i] = (cc[i] + prior * avg) / (den[i] + prior * avg);
      let num = 0, d2 = 0; for (let k = 0; k < N; k++) { num += w[k] * hg[k]; d2 += w[k] * att[H[k]] * def[A[k]]; } home = num / d2;
      let lg = 0; for (let i = 0; i < n; i++) lg += Math.log(att[i]); const g = Math.exp(lg / n);
      for (let i = 0; i < n; i++) { att[i] /= g; def[i] *= g; }
    }
    const lam = new Float64Array(N), mu = new Float64Array(N);
    for (let k = 0; k < N; k++) { lam[k] = att[H[k]] * def[A[k]] * home; mu[k] = att[A[k]] * def[H[k]]; }
    const nll = r => { let s = 0; for (let k = 0; k < N; k++) { let t = 1;
      if (hg[k] === 0 && ag[k] === 0) t = 1 - lam[k] * mu[k] * r; else if (hg[k] === 0 && ag[k] === 1) t = 1 + lam[k] * r;
      else if (hg[k] === 1 && ag[k] === 0) t = 1 + mu[k] * r; else if (hg[k] === 1 && ag[k] === 1) t = 1 - r;
      s -= w[k] * Math.log(Math.max(t, 1e-9)); } return s; };
    let lo = -0.25, hi = 0.25;
    for (let i = 0; i < 40; i++) { const a = hi - (hi - lo) / 1.618, b = lo + (hi - lo) / 1.618; if (nll(a) < nll(b)) hi = b; else lo = a; }
    return { ix, att, def, home, rho: (lo + hi) / 2, avg };
  }
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  function dcGrid(m, h, a, MAXG = 11, adj = null) {
    if (!m.ix.has(h) || !m.ix.has(a)) return null;
    const i = m.ix.get(h), j = m.ix.get(a), lam = m.att[i] * m.def[j] * m.home * (adj ? adj.h : 1), mu = m.att[j] * m.def[i] * (adj ? adj.a : 1), r = m.rho;
    const g = []; let t = 0;
    for (let x = 0; x < MAXG; x++) { g.push([]); for (let y = 0; y < MAXG; y++) { let v = pois(x, lam) * pois(y, mu);
      if (x === 0 && y === 0) v *= 1 - lam * mu * r; else if (x === 0 && y === 1) v *= 1 + lam * r; else if (x === 1 && y === 0) v *= 1 + mu * r; else if (x === 1 && y === 1) v *= 1 - r;
      g[x].push(v); t += v; } }
    g.forEach(row => row.forEach((v, y) => row[y] = v / t));
    return { g, lam, mu };
  }
  // Tabla de marcadores de dos Poisson independientes (para el modelo europeo basado en ClubElo)
  function poisGrid(lam, mu, MAXG = 11) {
    const g = []; let t = 0;
    for (let x = 0; x < MAXG; x++) { g.push([]); for (let y = 0; y < MAXG; y++) { const v = pois(x, lam) * pois(y, mu); g[x].push(v); t += v; } }
    g.forEach(row => row.forEach((v, y) => row[y] = v / t));
    return { g, lam, mu };
  }
  // Goles esperados a partir del Elo de ClubElo: log λ = a + b·d, log μ = c − e·d, d = (Elo local − Elo visitante)/100.
  // Ajustado en 2019-24 (16.284 partidos de primeras divisiones); validado en 2024-26: acierta el favorito el 52,4%, goles medios 2,80 vs 2,81 reales.
  const ELO_GOALS = [0.3856, 0.1851, 0.178, 0.188];
  const eloGoals = (eh, ea, neutral = false) => { const d = (eh - ea) / 100, [a, b, c, e] = ELO_GOALS, hb = neutral ? (a - c) / 2 : 0;
    return { lam: Math.exp(a - hb + b * d), mu: Math.exp(c + hb - e * d) }; };
  // Distribución de la diferencia de goles (local - visitante)
  function marginDist(g) { const d = new Map(); g.forEach((row, x) => row.forEach((v, y) => d.set(x - y, (d.get(x - y) || 0) + v))); return d; }
  // Hándicap asiático en línea L (para el lado con margen 'side'): devuelve {A,B}: EV(o) = A*o + B - 1
  function ahTerms(md, L, sign = 1) {
    const parts = (Math.abs(L * 4) % 2 === 1) ? [L - 0.25, L + 0.25] : [L];   // cuartos: mitad y mitad
    let A = 0, B = 0;
    for (const l of parts) { const wgt = 1 / parts.length;
      for (const [m, p] of md) { const r = sign * m + l; if (r > 0) A += wgt * p; else if (Math.abs(r) < 1e-9) B += wgt * p; } }
    return { A, B };
  }
  function footballMarkets(G) {
    const g = G.g, n = g.length; let H = 0, D = 0, A = 0, btts = 0; const tot = new Float64Array(2 * n);
    const hgd = new Float64Array(n), agd = new Float64Array(n);
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) { const v = g[x][y];
      if (x > y) H += v; else if (x === y) D += v; else A += v; if (x > 0 && y > 0) btts += v; tot[x + y] += v; hgd[x] += v; agd[y] += v; }
    const over = (dist, l) => { let s = 0; dist.forEach((v, k) => { if (k > l) s += v; }); return s; };
    const md = marginDist(g);
    const scores = []; for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) scores.push({ x, y, p: g[x][y] });
    scores.sort((a, b) => b.p - a.p);
    let csH = 0, csA = 0, wtnH = 0, wtnA = 0; for (let x = 0; x < n; x++) { csH += g[x][0]; csA += g[0][x]; if (x > 0) { wtnH += g[x][0]; wtnA += g[0][x]; } }
    return { H, D, A, btts, tot, csH, csA, wtnH, wtnA, over: l => over(tot, l), overHome: l => over(hgd, l), overAway: l => over(agd, l), md, scores, lam: G.lam, mu: G.mu };
  }

  // ---------- FÚTBOL: conjunto Dixon-Coles + Elo + pi-ratings ----------
  // Pesos y logit ordenado ajustados en 2023-25 y validados en 2025-26 (log-loss 0,9958 -> 0,9919 frente a DC solo).
  // Conjunto 1X2: Dixon-Coles, Elo, pi-ratings y GAP (tiros a puerta, Wheatcroft 2020). Pesos ajustados en 17 ligas 2022-25,
  // prueba 2025-26: log-loss 1,0130 -> 1,0101 al añadir GAP.
  const ENS = { w: [0.292, 0.139, 0.140, 0.538], w3: [0.349, 0.32, 0.396], elo: [0.5087, -0.6668, -0.5861], pi: [1.0445, -0.6941, -0.5584], gap: [0.4076, -0.2601, -0.9566] };
  const GAP = { lambda: 0.2, phi: 0.5 };
  // Ratings de cuotas pasadas: ataque/defensa ajustados a los goles implícitos en las cuotas Bet365 de los partidos jugados
  // (2 años, decaimiento 0,008/día). Mezcla con el conjunto validada en 17 ligas (pesos 2024-25, prueba 2025-26):
  // 1X2 1,0105 -> 1,0083 (acierto 49,1% -> 49,4%); más/menos 2,5 0,6843 -> 0,6806. Apuesta del día 69,0% -> 71,2% de acierto.
  const MK = { w: 0.35, ou: 0.86, xi: 0.008, ridge: 2, days: 730, rho: -0.05 };
  function ordLogit([b, c1, c2], x) {
    const ph = 1 / (1 + Math.exp(-(b * x + c1))), pa = 1 / (1 + Math.exp(b * x - c2)), pd = Math.max(1 - ph - pa, 1e-4), t = ph + pd + pa;
    return [ph / t, pd / t, pa / t];
  }
  // Elo por resultados (K=20, ventaja local 60, multiplicador por goles) y pi-ratings (Constantinou y Fenton 2013).
  // rows en orden cronológico; devuelve las variables previas a cada partido y el estado final.
  function footballRatings(rows) {
    const E = new Map(), RH = new Map(), RA = new Map(), pre = new Array(rows.length);
    const HA = new Map(), HD = new Map(), AA = new Map(), AD = new Map();   // GAP: ataque/defensa en casa y fuera (tiros a puerta)
    const gp = (h, a) => [((HA.get(h) ?? 4.5) + (AD.get(a) ?? 4.0)) / 2, ((AA.get(a) ?? 4.0) + (HD.get(h) ?? 4.5)) / 2];
    const psi = e => 3 * Math.log10(1 + Math.abs(e)) * Math.sign(e), pinv = r => (10 ** (Math.abs(r) / 3) - 1) * Math.sign(r);
    const feat = (h, a) => { const g = gp(h, a); return { elo: ((E.get(h) ?? 1500) + 60 - (E.get(a) ?? 1500)) / 100, pi: pinv(RH.get(h) ?? 0) - pinv(RA.get(a) ?? 0),
      gap: g[0] - g[1], gapOK: HA.has(h) && AA.has(a) }; };   // sin tiros a puerta de alguno de los dos, GAP no cuenta
    rows.forEach((r, k) => {
      const h = r.h, a = r.a; pre[k] = feat(h, a);
      if (r.hst != null && r.ast != null) {
        const [ph, pa] = gp(h, a), eh = r.hst - ph, ea = r.ast - pa, L = GAP.lambda, f = GAP.phi, up = (M, t, d, v) => M.set(t, Math.max((M.get(t) ?? d) + v, 0));
        const ha = HA.get(h) ?? 4.5, hd = HD.get(h) ?? 4.5, aa = AA.get(a) ?? 4.0, ad = AD.get(a) ?? 4.0;
        HA.set(h, Math.max(ha + L * f * eh, 0)); AD.set(a, Math.max(ad + L * f * eh, 0)); AA.set(a, Math.max(aa + L * f * ea, 0)); HD.set(h, Math.max(hd + L * f * ea, 0));
        up(AA, h, 4.0, L * (1 - f) * eh); up(HD, a, 4.5, L * (1 - f) * eh); up(HA, a, 4.5, L * (1 - f) * ea); up(AD, h, 4.0, L * (1 - f) * ea);
      }
      const eh = E.get(h) ?? 1500, ea = E.get(a) ?? 1500, we = 1 / (1 + 10 ** ((ea - eh - 60) / 400)), gd = Math.abs(r.hg - r.ag);
      const K = 20 * (gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8), sc = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
      E.set(h, eh + K * (sc - we)); E.set(a, ea - K * (sc - we));
      const rh = RH.get(h) ?? 0, ra = RA.get(a) ?? 0, de = psi((r.hg - r.ag) - (pinv(rh) - pinv(ra))) * 0.035;
      RH.set(h, rh + de); RA.set(h, (RA.get(h) ?? 0) + de * 0.7);
      RA.set(a, ra - de); RH.set(a, (RH.get(a) ?? 0) - de * 0.7);
    });
    return { pre, feat, elo: E };
  }
  function ensemble1x2(dc, f) {
    const gapOK = f.gapOK ?? f.gap != null, P = [dc, ordLogit(ENS.elo, f.elo), ordLogit(ENS.pi, f.pi)].concat(gapOK ? [ordLogit(ENS.gap, f.gap)] : []);
    const W = gapOK ? ENS.w : ENS.w3;   // sin datos de tiros: el conjunto anterior de tres modelos (validado igual)
    const g = [0, 1, 2].map(i => Math.exp(P.reduce((s, p, j) => s + W[j] * Math.log(p[i]), 0))), t = sum(g);
    return g.map(x => x / t);
  }
  // Reescala la tabla de marcadores para que 1X2 coincida con el conjunto (el resto de mercados queda coherente)
  function rescaleGrid(G, target) {
    const g = G.g, s = [0, 0, 0];
    g.forEach((row, x) => row.forEach((v, y) => s[x > y ? 0 : x === y ? 1 : 2] += v));
    return { ...G, g: g.map((row, x) => row.map((v, y) => { const i = x > y ? 0 : x === y ? 1 : 2; return v * target[i] / s[i]; })) };
  }
  // P(total > L) con binomial negativa de media mu y tamaño r (más dispersión que Poisson)
  function nbOver(mu, r, L) { const p = r / (r + mu); let pk = Math.pow(p, r), cdf = 0;
    for (let k = 0; k <= Math.floor(L); k++) { cdf += pk; pk *= (k + r) / (k + 1) * (1 - p); } return 1 - cdf; }
  // Córners y tarjetas varían más de lo que supone Poisson. Tamaños ajustados en 17 ligas 2023-25, validados en 2025-26:
  // córners log-loss 0,7188 -> 0,6895; tarjetas 0,6353 -> 0,6344.
  const NB_SIZE = { corners: 4.7, cards: 22.6 };
  // Más/menos 2,5 goles: el Dixon-Coles es demasiado tajante. logit(p') = 0,725·logit(p) + 0,092
  // (17 ligas, ajuste 2022-25, prueba 2025-26: 0,6890 -> 0,6845). Se ajusta la tabla de marcadores manteniendo el 1X2.
  const OU_CAL = [0.725, 0.092];
  const over25 = G => { let o = 0; G.g.forEach((r, x) => r.forEach((v, y) => { if (x + y > 2.5) o += v; })); return o; };
  function calibrateOU(G, target1x2, targetO = null) {
    const g = G.g.map(r => r.slice()), n = g.length, reg = (x, y) => x > y ? 0 : x === y ? 1 : 2;
    const o = over25(G), lo = Math.log(o / (1 - o)), to = targetO ?? 1 / (1 + Math.exp(-(OU_CAL[0] * lo + OU_CAL[1])));
    for (let it = 0; it < 30; it++) {   // ajuste proporcional alterno: total de goles y 1X2
      let so = 0; for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (x + y > 2.5) so += g[x][y];
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) g[x][y] *= x + y > 2.5 ? to / so : (1 - to) / (1 - so);
      const s = [0, 0, 0]; for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) s[reg(x, y)] += g[x][y];
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) g[x][y] *= target1x2[reg(x, y)] / s[reg(x, y)];
    }
    return { ...G, g };
  }
  // Descanso/final: tabla de la 1ª parte combinada con la de la 2ª parte (independientes)
  function htft(ht, sh) {
    const res = (x, y) => x > y ? 0 : x === y ? 1 : 2, m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    ht.forEach((r1, x) => r1.forEach((p1, y) => { if (p1 < 1e-7) return; sh.forEach((r2, u) => r2.forEach((p2, v) => { m[res(x, y)][res(x + u, y + v)] += p1 * p2; })); }));
    return m;
  }

  // ---------- BALONCESTO: rating de puntos (ataque/defensa/factor cancha) con decaimiento y ridge ----------
  // SD del margen y del total medidas en el backtest 2023-26 de la NBA.
  const NBA_SD = { margin: 14.3, total: 18.7 };
  function fitPts(rows, ref, xi, lam = 3, iters = 30) {
    const ix = new Map(); for (const r of rows) { if (!ix.has(r.h)) ix.set(r.h, ix.size); if (!ix.has(r.a)) ix.set(r.a, ix.size); }
    const T = ix.size, N = rows.length;
    const H = new Int32Array(N), A = new Int32Array(N), hp = new Float64Array(N), ap = new Float64Array(N), w = new Float64Array(N);
    let W = 0, P = 0;
    rows.forEach((r, k) => { H[k] = ix.get(r.h); A[k] = ix.get(r.a); hp[k] = r.hp; ap[k] = r.ap; w[k] = Math.exp(-xi * (ref - r.d)); W += w[k]; P += w[k] * (r.hp + r.ap); });
    let mu = P / (2 * W), hca = 0; const off = new Float64Array(T), de = new Float64Array(T), num = new Float64Array(T), cnt = new Float64Array(T);
    for (let k = 0; k < N; k++) { cnt[H[k]] += w[k]; cnt[A[k]] += w[k]; }
    for (let it = 0; it < iters; it++) {
      num.fill(0); for (let k = 0; k < N; k++) { num[H[k]] += w[k] * (hp[k] - mu - hca + de[A[k]]); num[A[k]] += w[k] * (ap[k] - mu + de[H[k]]); }
      for (let i = 0; i < T; i++) off[i] = num[i] / (cnt[i] + lam);
      num.fill(0); for (let k = 0; k < N; k++) { num[A[k]] += w[k] * -(hp[k] - mu - hca - off[H[k]]); num[H[k]] += w[k] * -(ap[k] - mu - off[A[k]]); }
      for (let i = 0; i < T; i++) de[i] = num[i] / (cnt[i] + lam);
      let s = 0; for (let k = 0; k < N; k++) s += w[k] * (hp[k] - ap[k] - off[H[k]] + de[A[k]] + off[A[k]] - de[H[k]]); hca = s / W / 2;
      s = 0; for (let k = 0; k < N; k++) s += w[k] * (hp[k] + ap[k] - hca - off[H[k]] + de[A[k]] - off[A[k]] + de[H[k]]); mu = s / (2 * W);
    }
    return { ix, mu, hca, off, de };
  }
  // SD de los puntos de cada equipo deducida de las del margen y el total: var(t)+var(m) = 4·var(equipo)
  const teamSD = sd => Math.sqrt((sd.margin ** 2 + sd.total ** 2) / 4);
  // SD en muestra de los últimos partidos, inflada un 10% (shortcut: sin backtest propio; medir cuando haya temporadas suficientes)
  function ptsSD(m, rows) {
    let sm = 0, st = 0, n = 0;
    for (const r of rows.slice(-400)) { const P = ptsPredict(m, r.h, r.a); if (!P) continue; sm += (r.hp - r.ap - P.margin) ** 2; st += (r.hp + r.ap - P.total) ** 2; n++; }
    return n > 30 ? { margin: 1.1 * Math.sqrt(sm / n), total: 1.1 * Math.sqrt(st / n) } : NBA_SD;
  }
  function ptsPredict(m, h, a) {
    if (!m.ix.has(h) || !m.ix.has(a)) return null;
    const i = m.ix.get(h), j = m.ix.get(a), ph = m.mu + m.hca + m.off[i] - m.de[j], pa = m.mu + m.off[j] - m.de[i];
    return { ph, pa, margin: ph - pa, total: ph + pa };
  }
  // P(margen + línea > 0) con corrección de continuidad (puntos enteros)
  function spreadProbs(margin, line, sd) { // línea del local, p.ej. -5.5
    if (Number.isInteger(line)) { const win = 1 - normCdf((-line + 0.5 - margin) / sd), lose = normCdf((-line - 0.5 - margin) / sd); return { win, push: 1 - win - lose, lose }; }
    const win = 1 - normCdf((-line - margin) / sd); return { win, push: 0, lose: 1 - win };
  }
  function totalProbs(total, line, sd) {
    if (Number.isInteger(line)) { const over = 1 - normCdf((line + 0.5 - total) / sd), under = normCdf((line - 0.5 - total) / sd); return { over, push: 1 - over - under, under }; }
    const over = 1 - normCdf((line - total) / sd); return { over, push: 0, under: 1 - over };
  }

  // ---------- TENIS: Elo general + Elo por superficie (K de FiveThirtyEight) ----------
  const eloK = n => 250 / Math.pow(n + 5, 0.4);
  // El Elo crudo es demasiado confiado: logit(p') = 0,75·logit(p), ajustado en 2021-23 y validado en 2024-26
  // (log-loss 0,6308 -> 0,6239; lo pronosticado al 74% se cumple el 73,6%).
  const ELO_C = 0.75, eloCalib = p => 1 / (1 + Math.exp(-ELO_C * Math.log(p / (1 - p))));
  function runElo(T, opts = {}) {
    const wS = opts.surfWeight ?? 0.3, minN = opts.minN ?? 10, from = opts.from ?? Infinity, P = T.players.length;
    const R = new Float64Array(P).fill(1500), S = [0, 1, 2, 3].map(() => new Float64Array(P).fill(1500));
    const Nn = new Float64Array(P), NS = [0, 1, 2, 3].map(() => new Float64Array(P)), preds = [];
    const Mk = new Float64Array(P), Ms = new Uint8Array(P);   // rating de mercado (cuotas Pinnacle de partidos pasados)
    for (let k = 0; k < T.date.length; k++) {
      const w = T.w[k], l = T.l[k], s = T.surf[k];
      if (!T.completed[k] && T.W1[k] == null) continue;   // walkover
      const rw = (1 - wS) * R[w] + wS * S[s][w], rl = (1 - wS) * R[l] + wS * S[s][l];
      const p = 1 / (1 + Math.pow(10, (rl - rw) / 400));
      if (T.date[k] >= from && Nn[w] >= minN && Nn[l] >= minN) preds.push({ k, p: tnBlend(p, Ms[w] && Ms[l] ? Mk[w] - Mk[l] : null) });
      const ow = T.pW && T.pW[k], ol = T.pL && T.pL[k];
      if (ow > 1 && ol > 1) {   // el rating de mercado se acerca a lo que decían las cuotas, no al resultado
        const q = Math.min(Math.max((1 / ow) / (1 / ow + 1 / ol), 0.01), 0.99), e = Math.log(q / (1 - q)) - (Mk[w] - Mk[l]);
        Mk[w] += TN_MK.k * e; Mk[l] -= TN_MK.k * e; Ms[w] = Ms[l] = 1;
      }
      if (T.completed[k]) {
        R[w] += eloK(Nn[w]) * (1 - p); R[l] -= eloK(Nn[l]) * (1 - p);
        const ps = 1 / (1 + Math.pow(10, (S[s][l] - S[s][w]) / 400));
        S[s][w] += eloK(NS[s][w]) * (1 - ps); S[s][l] -= eloK(NS[s][l]) * (1 - ps);
        Nn[w]++; Nn[l]++; NS[s][w]++; NS[s][l]++;
      }
    }
    return { R, S, N: Nn, NS, preds, wS, Mk, Ms };
  }
  // Tenis: Elo mezclado con ratings de cuotas pasadas (2019-23 para ajustar, prueba 2024-26 en los mismos partidos: log-loss 0,6239 -> 0,6172)
  const TN_MK = { k: 0.35, wElo: 0.199, wMk: 0.738 };
  const tnBlend = (pRaw, dm) => dm == null ? eloCalib(pRaw) : 1 / (1 + Math.exp(-(TN_MK.wElo * Math.log(pRaw / (1 - pRaw)) + TN_MK.wMk * dm)));
  const eloProb = (E, a, b, s) => { const ra = (1 - E.wS) * E.R[a] + E.wS * E.S[s][a], rb = (1 - E.wS) * E.R[b] + E.wS * E.S[s][b];
    return tnBlend(1 / (1 + Math.pow(10, (rb - ra) / 400)), E.Ms && E.Ms[a] && E.Ms[b] ? E.Mk[a] - E.Mk[b] : null); };

  // Modelo de puntos: probabilidad de ganar punto al saque -> juego, tie-break, set, partido (exacto)
  function holdProb(p) { const q = 1 - p; return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * p * p / (1 - 2 * p * q); }
  function tiebreakProb(pa, pb) { // A saca el primer punto; luego B 2, A 2...
    const memo = new Map();
    const f = (a, b) => {
      if (a >= 7 && a - b >= 2) return 1; if (b >= 7 && b - a >= 2) return 0;
      if (a === 6 && b === 6) { const ww = pa * (1 - pb), ll = (1 - pa) * pb; return ww / (ww + ll); }
      const key = a * 100 + b; if (memo.has(key)) return memo.get(key);
      const n = a + b, aServes = n % 4 === 0 || n % 4 === 3, pw = aServes ? pa : 1 - pb;
      const v = pw * f(a + 1, b) + (1 - pw) * f(a, b + 1); memo.set(key, v); return v;
    };
    return f(0, 0);
  }
  // Distribución de marcadores de un set: [{ga, gb, p, aServesNext}] con A sacando primero si aFirst
  function setDist(pa, pb, aFirst) {
    const hA = holdProb(pa), hB = holdProb(pb), out = [];
    let cur = new Map([['0,0', 1]]);
    for (let g = 0; g < 13; g++) {
      const nxt = new Map();
      for (const [key, p] of cur) {
        const [a, b] = key.split(',').map(Number);
        const aServes = (g % 2 === 0) === aFirst;
        if (a === 6 && b === 6) { const tb = aServes ? tiebreakProb(pa, pb) : 1 - tiebreakProb(pb, pa);
          out.push({ ga: 7, gb: 6, p: p * tb, aServesNext: !aFirst }); out.push({ ga: 6, gb: 7, p: p * (1 - tb), aServesNext: !aFirst }); continue; }
        const pw = aServes ? hA : 1 - hB;
        for (const [na, nb, pp] of [[a + 1, b, pw], [a, b + 1, 1 - pw]]) {
          const done = (na >= 6 && na - nb >= 2) || (nb >= 6 && nb - na >= 2) || na === 7 || nb === 7;
          const v = p * pp;
          if (done) out.push({ ga: na, gb: nb, p: v, aServesNext: ((na + nb) % 2 === 0) === aFirst });
          else { const k2 = na + ',' + nb; nxt.set(k2, (nxt.get(k2) || 0) + v); }
        }
      }
      cur = nxt;
    }
    return out;
  }
  // Partido: distribución conjunta de (sets A, sets B, juegos A, juegos B)
  function matchDist(pa, pb, bo) {
    const need = bo === 5 ? 3 : 2, sA = setDist(pa, pb, true), sB = setDist(pa, pb, false);
    let states = new Map([['0,0,1', new Map([['0,0', 1]])]]); const final = [];
    while (states.size) {
      const nxt = new Map();
      for (const [key, gm] of states) {
        const [a, b, srv] = key.split(',').map(Number);
        for (const s of (srv ? sA : sB)) {
          const na = a + (s.ga > s.gb), nb = b + (s.gb > s.ga), ns = s.aServesNext ? 1 : 0;
          for (const [gk, gp] of gm) {
            const [x, y] = gk.split(',').map(Number), v = gp * s.p, g2 = (x + s.ga) + ',' + (y + s.gb);
            if (na === need || nb === need) final.push({ sa: na, sb: nb, ga: x + s.ga, gb: y + s.gb, p: v });
            else { const k2 = na + ',' + nb + ',' + ns; if (!nxt.has(k2)) nxt.set(k2, new Map()); const mm = nxt.get(k2); mm.set(g2, (mm.get(g2) || 0) + v); }
          }
        }
      }
      states = nxt;
    }
    return final;
  }
  function matchWin(pa, pb, bo) { return sum(matchDist(pa, pb, bo).filter(f => f.sa > f.sb).map(f => f.p)); }
  // Ajusta la diferencia de saque d para que el modelo de puntos reproduzca la probabilidad p de ganar el partido
  function tennisFromProb(p, bo, base) {
    const d = bisect(d => matchWin(base + d, base - d, bo) - p, -0.25, 0.25, 30);
    const dist = matchDist(base + d, base - d, bo);
    return { d, dist, pa: base + d, pb: base - d };
  }
  function tennisExtras(pa, pb, dist) {
    const sA = setDist(pa, pb, true), sB = setDist(pa, pb, false), avg = f => (sum(sA.filter(f).map(x => x.p)) + sum(sB.filter(f).map(x => x.p))) / 2;
    const tb = avg(x => x.ga + x.gb === 13), nsets = new Map();
    for (const f of dist) nsets.set(f.sa + f.sb, (nsets.get(f.sa + f.sb) || 0) + f.p);
    let noTB = 0; for (const [n, p] of nsets) noTB += p * (1 - tb) ** n;   // shortcut: tie-breaks independientes entre sets
    return { firstSetA: avg(x => x.ga > x.gb), tieBreak: 1 - noTB, set1Over: l => avg(x => x.ga + x.gb > l) };
  }
  // Probabilidad de partido al mejor de 5 a partir de una de mejor de 3 (vía probabilidad de set)
  function bo3to5(p) { const s = bisect(s => s * s * (3 - 2 * s) - p, 0, 1); return s ** 3 * (10 - 15 * s + 6 * s * s); }


  // ---------- Pronóstico completo de un partido (lo usan la app y el proceso automático) ----------
  const nfmt = (x, d = 1) => x.toFixed(d).replace('.', ',');
  const sgnL = L => (L > 0 ? '+' : L < 0 ? '−' : '') + nfmt(Math.abs(L), Number.isInteger(L * 2) && !Number.isInteger(L) ? 1 : Number.isInteger(L) ? 0 : 2);
  // Ratings de cuotas pasadas (ver MK): mínimos cuadrados ponderados sobre log(goles implícitos) de local y visitante
  function fitMarket(rows, ref) {
    const R = rows.filter(r => r.il != null && r.im != null && r.d < ref && r.d >= ref - MK.days);
    if (R.length < 200) return null;
    const teams = [...new Set(R.flatMap(r => [r.h, r.a]))], ix = new Map(teams.map((t, i) => [t, i])), n = teams.length, m = 2 * n + 1;
    const A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
    let sw = 0, sy = 0;
    for (const r of R) { const w = Math.exp(-MK.xi * (ref - r.d)); sw += 2 * w; sy += w * (Math.log(r.il) + Math.log(r.im)); }
    const mu0 = sy / sw;
    const addRow = (idx, sg, y, w) => { for (let p = 0; p < idx.length; p++) { b[idx[p]] += w * sg[p] * (y - mu0); for (let q = 0; q < idx.length; q++) A[idx[p]][idx[q]] += w * sg[p] * sg[q]; } };
    for (const r of R) { const w = Math.exp(-MK.xi * (ref - r.d)), h = ix.get(r.h), a = ix.get(r.a);
      addRow([h, n + a, 2 * n], [1, -1, 1], Math.log(r.il), w); addRow([a, n + h], [1, -1], Math.log(r.im), w); }
    for (let i = 0; i < 2 * n; i++) A[i][i] += MK.ridge; A[2 * n][2 * n] += 1e-6;
    // eliminación gaussiana con pivote parcial
    for (let c = 0; c < m; c++) { let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
      [A[c], A[pv]] = [A[pv], A[c]]; [b[c], b[pv]] = [b[pv], b[c]];
      for (let r = c + 1; r < m; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
    const beta = new Float64Array(m); for (let c = m - 1; c >= 0; c--) { let s = b[c]; for (let k = c + 1; k < m; k++) s -= A[c][k] * beta[k]; beta[c] = s / A[c][c]; }
    return { ix, beta, mu0, n };
  }
  function marketPredict(mk, h, a) {
    if (!mk || !mk.ix.has(h) || !mk.ix.has(a)) return null;
    const i = mk.ix.get(h), j = mk.ix.get(a), n = mk.n, b = mk.beta;
    const l = Math.exp(mk.mu0 + b[i] - b[n + j] + b[2 * n]), m = Math.exp(mk.mu0 + b[j] - b[n + i]), rho = MK.rho;
    const ph = k => { let p = Math.exp(-l), out = []; for (let x = 0; x < 11; x++) { out.push(p); p *= l / (x + 1); } return out; };
    const pa = k => { let p = Math.exp(-m), out = []; for (let x = 0; x < 11; x++) { out.push(p); p *= m / (x + 1); } return out; };
    const X = ph(), Y = pa(); let H = 0, D = 0, Aw = 0, O = 0, t = 0;
    for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) {
      let v = X[x] * Y[y];
      if (x === 0 && y === 0) v *= 1 - l * m * rho; else if (x === 0 && y === 1) v *= 1 + l * rho; else if (x === 1 && y === 0) v *= 1 + m * rho; else if (x === 1 && y === 1) v *= 1 - rho;
      t += v; if (x > y) H += v; else if (x === y) D += v; else Aw += v; if (x + y > 2.5) O += v;
    }
    return { p: [H / t, D / t, Aw / t], o: O / t, l, m };
  }
  // Ajusta los cinco modelos de un país: goles, 1ª parte, 2ª parte, córners y tarjetas (amarillas + rojas)
  function fitFootballSet(rows, ref, xi) {
    const sub = (f, map) => { const r = rows.filter(f); return r.length > 200 ? fitDC(r.map(map), ref, xi) : null; };
    const has = (...k) => r => k.every(c => r[c] != null);
    const set = {
      ft: fitDC(rows, ref, xi),
      fx: sub(has('hxg', 'axg'), r => ({ ...r, hg: (r.hg + r.hxg) / 2, ag: (r.ag + r.axg) / 2 })),
      ht: sub(has('hth', 'hta'), r => ({ ...r, hg: r.hth, ag: r.hta })),
      sh: sub(has('hth', 'hta'), r => ({ ...r, hg: r.hg - r.hth, ag: r.ag - r.hta })),
      co: sub(has('hc', 'ac'), r => ({ ...r, hg: r.hc, ag: r.ac })),
      ca: sub(has('hy', 'ay'), r => ({ ...r, hg: r.hy + (r.hr || 0), ag: r.ay + (r.ar || 0) })),
    };
    set.caTrend = cardsTrend(set.ca, rows, ref);
    set.mk = fitMarket(rows, ref);
    return set;
  }
  // Tendencia reciente de tarjetas de la liga (vida media 180 días, encogida con 40 tarjetas): corrige que el árbitraje
  // se endurezca o suavice por temporadas. Premier 2022-26: log-loss de más/menos tarjetas 0,6348 -> 0,6244.
  // El árbitro concreto se probó y no mejora (0,6238 -> 0,6245), por eso solo se muestra como información.
  function cardsTrend(m, rows, ref) {
    if (!m) return 1;
    let a = 40, e = 40;
    for (const r of rows) { if (r.hy == null || r.ay == null || !m.ix.has(r.h) || !m.ix.has(r.a)) continue;
      const i = m.ix.get(r.h), j = m.ix.get(r.a), w = Math.pow(0.5, (ref - r.d) / 180);
      a += w * (r.hy + r.ay + (r.hr || 0) + (r.ar || 0)); e += w * (m.att[i] * m.def[j] * m.home + m.att[j] * m.def[i]); }
    return a / e;
  }
  // Mercados que salen de una tabla de marcadores (los usan el modelo de ligas y el europeo)
  function footballGroups(G, k, h, a) {
    const groups = [], add = (title, rows) => rows.length && groups.push({ title, rows });
    add('Resultado', [{ key: '1', label: `1 · ${h}`, p: k.H }, { key: 'X', label: 'X · Empate', p: k.D }, { key: '2', label: `2 · ${a}`, p: k.A }]);
    add('Doble oportunidad', [{ key: '1X', label: '1X', p: k.H + k.D }, { key: 'X2', label: 'X2', p: k.D + k.A }, { key: '12', label: '12', p: k.H + k.A }]);
    add('Ambos marcan', [{ key: 'by', label: 'Sí', p: k.btts }, { key: 'bn', label: 'No', p: 1 - k.btts }]);
    add('Goles totales', [0.5, 1.5, 2.5, 3.5, 4.5].flatMap(l => [{ key: 'o' + l, label: `Más de ${nfmt(l)}`, p: k.over(l) }, { key: 'u' + l, label: `Menos de ${nfmt(l)}`, p: 1 - k.over(l) }]));
    add('Goles exactos', [0, 1, 2, 3, 4].map(n => ({ key: 'eg' + n, label: `${n} goles`, p: k.tot[n] })).concat([{ key: 'eg5', label: '5 o más', p: k.over(4.5) }]));
    const odd = k.tot.reduce((s, v, i) => s + (i % 2 ? v : 0), 0);
    add('Par o impar', [{ key: 'par', label: 'Par', p: 1 - odd }, { key: 'impar', label: 'Impar', p: odd }]);
    add('Goles de cada equipo', [0.5, 1.5, 2.5].flatMap(l => [{ key: 'hO' + l, label: `${h} más de ${nfmt(l)}`, p: k.overHome(l) }, { key: 'aO' + l, label: `${a} más de ${nfmt(l)}`, p: k.overAway(l) }]));
    add('Portería a cero', [{ key: 'csH', label: `${h} no encaja`, p: k.csH }, { key: 'csA', label: `${a} no encaja`, p: k.csA }, { key: 'wtnH', label: `${h} gana sin encajar`, p: k.wtnH }, { key: 'wtnA', label: `${a} gana sin encajar`, p: k.wtnA }]);
    const mg = n => k.md.get(n) || 0, mgSum = f => [...k.md].filter(([m]) => f(m)).reduce((s, [, p]) => s + p, 0);
    add('Margen de victoria', [{ key: 'm1', label: `${h} por 1`, p: mg(1) }, { key: 'm2', label: `${h} por 2`, p: mg(2) }, { key: 'm3', label: `${h} por 3 o más`, p: mgSum(m => m >= 3) },
      { key: 'm0', label: 'Empate', p: k.D }, { key: 'm-1', label: `${a} por 1`, p: mg(-1) }, { key: 'm-2', label: `${a} por 2`, p: mg(-2) }, { key: 'm-3', label: `${a} por 3 o más`, p: mgSum(m => m <= -3) }]);
    // hándicap asiático alrededor de la línea más equilibrada
    let best = 0, bd = 9; for (let L = -3; L <= 3; L += 0.25) { const t = ahTerms(k.md, L, 1), f = (1 - t.B) / t.A; if (Math.abs(f - 2) < bd) { bd = Math.abs(f - 2); best = L; } }
    const ah = []; for (let L = best - 0.5; L <= best + 0.501; L += 0.25) { const t = ahTerms(k.md, L, 1), u = ahTerms(k.md, -L, -1);
      ah.push({ key: 'ahH' + L, label: `${h} ${sgnL(L)}`, p: t.A, push: t.B }, { key: 'ahA' + L, label: `${a} ${sgnL(-L)}`, p: u.A, push: u.B }); }
    add('Hándicap asiático', ah);
    add('Resultado exacto', k.scores.slice(0, 8).map(s => ({ key: `cs${s.x}${s.y}`, label: `${s.x}-${s.y}`, p: s.p })));
    return { groups, add };
  }
  // Partido entre clubes de distintas ligas (competiciones europeas): Elo de ClubElo -> goles
  function eloPredict(eh, ea, h, a, neutral = false, adj = null) {
    const { lam, mu } = eloGoals(eh, ea, neutral), G = poisGrid(lam * (adj ? adj.h : 1), mu * (adj ? adj.a : 1)), k = footballMarkets(G), { groups } = footballGroups(G, k, h, a);
    return { G, k, groups, summary: { H: k.H, D: k.D, A: k.A, lam: k.lam, mu: k.mu, o25: k.over(2.5), btts: k.btts, score: k.scores[0], corners: null, cards: null } };
  }
  // adj (opcional): { h, a } multiplicadores de goles esperados por bajas (1 = sin cambio)
  function footballPredict(set, feat, h, a, adj = null) {
    const Gb = dcGrid(set.ft, h, a); if (!Gb) return null;
    const kb = footballMarkets(Gb), base = [kb.H, kb.D, kb.A];
    let ens = ensemble1x2(base, feat);
    const mk = marketPredict(set.mk, h, a);
    if (mk) { const g = [0, 1, 2].map(i => Math.exp((1 - MK.w) * Math.log(ens[i]) + MK.w * Math.log(mk.p[i]))), t = sum(g); ens = g.map(x => x / t); }
    // con xG (5 grandes ligas) la forma de los goles sale del modelo mezcla goles+xG: mejora más/menos 2,5 (0,6722 -> 0,6672)
    const G0 = (set.fx && dcGrid(set.fx, h, a, 11, adj)) || dcGrid(set.ft, h, a, 11, adj);
    if (adj) { // las bajas mueven el 1X2 del conjunto en la misma proporción que mueven al Dixon-Coles
      const ka = footballMarkets(dcGrid(set.ft, h, a, 11, adj)), r = [ka.H / kb.H, ka.D / kb.D, ka.A / kb.A], t = ens.reduce((s, p, i) => s + p * r[i], 0);
      ens = ens.map((p, i) => p * r[i] / t);
    }
    let G = set.fx ? rescaleGrid(G0, ens) : calibrateOU(rescaleGrid(G0, ens), ens);   // con xG no se calibra: no validado
    if (mk) G = calibrateOU(G, ens, (1 - MK.ou) * over25(G) + MK.ou * mk.o);   // más/menos 2,5 mezclado con los ratings de cuotas
    const k = footballMarkets(G);
    const out = footballGroups(G, k, h, a);
    const groups = out.groups, add = out.add;
    let ht = null;
    if (set.ht && set.sh) {
      const Gh = dcGrid(set.ht, h, a), Gs = dcGrid(set.sh, h, a);
      if (Gh && Gs) {
        ht = footballMarkets(Gh);
        add('Descanso', [{ key: 'ht1', label: `1 · ${h}`, p: ht.H }, { key: 'htX', label: 'X · Empate', p: ht.D }, { key: 'ht2', label: `2 · ${a}`, p: ht.A },
          { key: 'hto0.5', label: 'Más de 0,5 goles en la 1ª parte', p: ht.over(0.5) }, { key: 'hto1.5', label: 'Más de 1,5 goles en la 1ª parte', p: ht.over(1.5) }]);
        const m = htft(Gh.g, Gs.g), L = ['1', 'X', '2'], rows = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rows.push({ key: `hf${i}${j}`, label: `${L[i]}/${L[j]}`, p: m[i][j] });
        add('Descanso/final', rows.sort((x, y) => y.p - x.p));
      }
    }
    let corners = null, cards = null;
    if (set.co) { const Gc = dcGrid(set.co, h, a, 26); if (Gc) { corners = footballMarkets(Gc); const mc = corners.lam + corners.mu;
      add('Córners', [7.5, 8.5, 9.5, 10.5, 11.5].flatMap(l => { const o = nbOver(mc, NB_SIZE.corners, l); return [{ key: 'co' + l, label: `Más de ${nfmt(l)} córners`, p: o }, { key: 'cu' + l, label: `Menos de ${nfmt(l)} córners`, p: 1 - o }]; })
        .concat([{ key: 'coH', label: `Más córners: ${h}`, p: corners.H }, { key: 'coX', label: 'Mismos córners', p: corners.D }, { key: 'coA', label: `Más córners: ${a}`, p: corners.A }])); } }
    if (set.ca) { const t = set.caTrend || 1, Gk = dcGrid(set.ca, h, a, 16, { h: t, a: t }); if (Gk) { cards = footballMarkets(Gk); const mk = cards.lam + cards.mu;
      add('Tarjetas (amarillas + rojas)', [2.5, 3.5, 4.5, 5.5].flatMap(l => { const o = nbOver(mk, NB_SIZE.cards, l); return [{ key: 'ka' + l, label: `Más de ${nfmt(l)} tarjetas`, p: o }, { key: 'ku' + l, label: `Menos de ${nfmt(l)} tarjetas`, p: 1 - o }]; })); } }
    const summary = { H: k.H, D: k.D, A: k.A, lam: k.lam, mu: k.mu, o25: k.over(2.5), btts: k.btts, score: k.scores[0],
      corners: corners ? corners.lam + corners.mu : null, cards: cards ? cards.lam + cards.mu : null,
      co95: corners ? nbOver(corners.lam + corners.mu, NB_SIZE.corners, 9.5) : null, ca45: cards ? nbOver(cards.lam + cards.mu, NB_SIZE.cards, 4.5) : null };
    return { G, k, groups, summary };
  }
  // Pronóstico principal: el resultado más probable entre 1X2, más/menos 2,5 y ambos marcan
  function footballPick(s, h, a) {
    const c = [['1X2', `Gana ${h}`, s.H, 'H'], ['1X2', 'Empate', s.D, 'D'], ['1X2', `Gana ${a}`, s.A, 'A'],
      ['Más/menos 2,5', 'Más de 2,5 goles', s.o25, 'O'], ['Más/menos 2,5', 'Menos de 2,5 goles', 1 - s.o25, 'U'], ['Ambos marcan', 'Ambos marcan', s.btts, 'BY'], ['Ambos marcan', 'No marcan ambos', 1 - s.btts, 'BN']];
    return c.reduce((b, x) => x[2] > b[2] ? x : b).reduce((o, v, i) => (o[['market', 'label', 'p', 'code'][i]] = v, o), {});
  }
  // Cansancio NBA (ajustado 2023-25, validado 2025-26: log-loss 0,6011 -> 0,5996, acierto 67,4% -> 67,6%):
  // segunda noche seguida -2,79 pts de margen; +0,41 por día de descanso de ventaja (1-3); +0,64 por cada 1000 km que viajó el rival.
  const NBA_ARENA = { 'Atlanta Hawks': [33.757, -84.396], 'Boston Celtics': [42.366, -71.062], 'Brooklyn Nets': [40.683, -73.976], 'Charlotte Hornets': [35.225, -80.839],
    'Chicago Bulls': [41.881, -87.674], 'Cleveland Cavaliers': [41.496, -81.688], 'Dallas Mavericks': [32.79, -96.81], 'Denver Nuggets': [39.749, -105.008],
    'Detroit Pistons': [42.341, -83.055], 'Golden State Warriors': [37.768, -122.388], 'Houston Rockets': [29.751, -95.362], 'Indiana Pacers': [39.764, -86.155],
    'LA Clippers': [33.945, -118.341], 'Los Angeles Lakers': [34.043, -118.267], 'Memphis Grizzlies': [35.138, -90.051], 'Miami Heat': [25.781, -80.188],
    'Milwaukee Bucks': [43.045, -87.917], 'Minnesota Timberwolves': [44.98, -93.276], 'New Orleans Pelicans': [29.949, -90.082], 'New York Knicks': [40.751, -73.993],
    'Oklahoma City Thunder': [35.463, -97.515], 'Orlando Magic': [28.539, -81.384], 'Philadelphia 76ers': [39.901, -75.172], 'Phoenix Suns': [33.446, -112.071],
    'Portland Trail Blazers': [45.532, -122.667], 'Sacramento Kings': [38.58, -121.5], 'San Antonio Spurs': [29.427, -98.438], 'Toronto Raptors': [43.643, -79.379],
    'Utah Jazz': [40.768, -111.901], 'Washington Wizards': [38.898, -77.021] };
  const kmBetween = (p, q) => { const r = Math.PI / 180, s1 = Math.sin((q[0] - p[0]) * r / 2), s2 = Math.sin((q[1] - p[1]) * r / 2);
    return 12742 * Math.asin(Math.sqrt(s1 * s1 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * s2 * s2)); };
  // rows: partidos previos {d, h, a}; day: fecha del partido (día EE. UU.). Devuelve el ajuste de margen y el detalle.
  function nbaFatigue(rows, h, a, day) {
    const loc = NBA_ARENA[h]; if (!loc || !NBA_ARENA[a]) return { adj: 0 };
    const info = t => { for (let k = rows.length - 1; k >= 0; k--) { const r = rows[k]; if (r.d >= day) continue; if (r.h === t || r.a === t) {
      const rest = day - r.d; return rest > 30 ? { rest: 4, km: 0 } : { rest: Math.min(rest, 4), km: kmBetween(NBA_ARENA[r.h] || loc, loc) }; } } return { rest: 4, km: 0 }; };
    const H = info(h), A = info(a), cl = x => Math.max(1, Math.min(3, x));
    const adj = -2.79 * ((H.rest === 1) - (A.rest === 1)) + 0.41 * (cl(H.rest) - cl(A.rest)) + 0.64 * (A.km - H.km) / 1000;
    return { adj, home: H, away: A };
  }
  function basketPredict(m, sd, h, a, line, total, adj = 0) {
    const P0 = ptsPredict(m, h, a); if (!P0) return null;
    const P = { ...P0, ph: P0.ph + adj / 2, pa: P0.pa - adj / 2, margin: P0.margin + adj };
    const half = x => { const r = Math.round(x * 2) / 2; return Number.isInteger(r) ? r + 0.5 : r; };
    const L = line ?? half(-P.margin), T = total ?? half(P.total), tsd = teamSD(sd), pw = 1 - normCdf(-P.margin / sd.margin);
    const sp = [], to = [], tt = [];
    for (const l of [L - 3, L, L + 3]) { const s = spreadProbs(P.margin, l, sd.margin);
      sp.push({ key: 'sh' + l, label: `${h} ${sgnL(l)}`, p: s.win, push: s.push }, { key: 'sa' + l, label: `${a} ${sgnL(-l)}`, p: s.lose, push: s.push }); }
    for (const l of [T - 6, T, T + 6]) { const s = totalProbs(P.total, l, sd.total);
      to.push({ key: 'to' + l, label: `Más de ${nfmt(l)}`, p: s.over, push: s.push }, { key: 'tu' + l, label: `Menos de ${nfmt(l)}`, p: s.under, push: s.push }); }
    for (const [nm, mu, k] of [[h, P.ph, 'h'], [a, P.pa, 'a']]) { const l = half(mu), s = totalProbs(mu, l, tsd);
      tt.push({ key: 't' + k + 'o', label: `${nm} más de ${nfmt(l)}`, p: s.over }, { key: 't' + k + 'u', label: `${nm} menos de ${nfmt(l)}`, p: s.under }); }
    return { P, pw, line: L, total: T, groups: [{ title: 'Ganador (prórroga incluida)', rows: [{ key: 'mlh', label: h, p: pw }, { key: 'mla', label: a, p: 1 - pw }] },
      { title: 'Hándicap', rows: sp }, { title: 'Puntos totales', rows: to }, { title: 'Puntos de cada equipo', rows: tt }] };
  }

  return { nbOver, calibrateOU, poisGrid, eloGoals, eloPredict, footballGroups, nbaFatigue, NBA_ARENA, fitFootballSet, footballPredict, footballPick, basketPredict, sum, normCdf, bisect, fairProbs, blend, kelly, fitDC, dcGrid, footballMarkets, fitMarket, marketPredict, MK, GAP, marginDist, ahTerms, ENS, ordLogit, footballRatings, ensemble1x2, rescaleGrid, htft, teamSD, ptsSD, tennisExtras,
    NBA_SD, fitPts, ptsPredict, spreadProbs, totalProbs, runElo, eloProb, holdProb, tiebreakProb, setDist, matchDist, matchWin, tennisFromProb, bo3to5 };
})();
if (typeof module !== 'undefined') module.exports = M;
