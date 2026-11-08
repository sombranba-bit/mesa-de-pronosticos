// Ajuste de parámetros con validación temporal (entrena con el pasado, comprueba con lo que vino después). Uso: node tools/<fichero>.mjs
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
import path from 'node:path'; import { fileURLToPath } from 'node:url'; const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = req(ROOT + '/app/model.js');
const X = req(ROOT + '/docs/data/basket_extra.json').comps;
for (const file of Object.keys(X)) {
  const D = X[file];
  const rows = D.date.map((d, k) => ({ d, h: D.teams[D.h[k]], a: D.teams[D.a[k]], hp: D.hp[k], ap: D.ap[k] })).sort((a, b) => a.d - b.d);
  const last = rows[rows.length - 1].d, out = [];
  for (const xi of [0.002, 0.004, 0.007, 0.01]) for (const win of [500, 800, 1100]) {
    let ll = 0, n = 0, se = 0;
    for (let t = last - 400; t < last; t += 7) {
      const test = rows.filter(r => r.d >= t && r.d < t + 7); if (!test.length) continue;
      const m = M.fitPts(rows.filter(r => r.d < t && r.d >= t - win), t, xi);
      const sd = file === 'nba' ? M.NBA_SD : M.ptsSD(m, rows.filter(r => r.d < t));
      for (const r of test) { const P = M.basketPredict(m, sd, r.h, r.a); if (!P) continue; const p = Math.min(Math.max(P.pw, 1e-4), 1 - 1e-4); ll -= Math.log(r.hp > r.ap ? p : 1 - p); n++; }
    }
    out.push([xi, win, +(ll / n).toFixed(5), n]);
  }
  out.sort((a, b) => a[2] - b[2]); console.log(file, JSON.stringify(out.slice(0, 4)), 'actual', JSON.stringify(out.find(x => x[0] === 0.01 && x[1] === 500)));
}
