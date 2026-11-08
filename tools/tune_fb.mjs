// Ajuste de parámetros con validación temporal (entrena con el pasado, comprueba con lo que vino después). Uso: node tools/<fichero>.mjs
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
import path from 'node:path'; import { fileURLToPath } from 'node:url'; const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = req(ROOT + '/app/model.js'), F = req(ROOT + '/docs/data/football.json');
const C = { SP1: 'ES', SP2: 'ES', E0: 'EN', E1: 'EN', I1: 'IT', I2: 'IT', D1: 'DE', D2: 'DE', F1: 'FR', F2: 'FR' };
const rows = F.date.map((d, k) => ({ d, div: F.divs[F.div[k]], h: F.teams[F.h[k]], a: F.teams[F.a[k]], hg: F.hg[k], ag: F.ag[k], hc: F.hc[k], ac: F.ac[k], hy: F.hy[k], ay: F.ay[k], hr: F.hr[k], ar: F.ar[k] }));
const xis = (process.argv[2] || '0.001,0.0015,0.0025').split(',').map(Number), field = process.argv[3] || 'g';
const start = Date.parse('2025-09-01') / 864e5, end = Date.parse('2026-11-01') / 864e5;
const res = Object.fromEntries(xis.map(x => [x, [0, 0]]));
for (const c of [...new Set(Object.values(C))]) {
  const cr = rows.filter(r => C[r.div] === c);
  for (let t = start; t < end; t += 28) {
    const test = cr.filter(r => r.d >= t && r.d < t + 28); if (!test.length) continue;
    const train = cr.filter(r => r.d < t && r.d >= t - 3 * 365);
    for (const xi of xis) {
      const tr = field === 'g' ? train : train.filter(r => r.hc != null).map(r => ({ ...r, hg: r.hc, ag: r.ac }));
      const m = M.fitDC ? M.fitDC(tr, t, xi) : M.fitFootballSet(tr, t, xi).ft;
      for (const r of test) {
        const G = M.dcGrid ? M.dcGrid(m, r.h, r.a) : null; if (!G) continue;
        let p;
        if (field === 'g') { const k = M.footballMarkets(G); p = r.hg > r.ag ? k.H : r.hg === r.ag ? k.D : k.A; }
        else { if (r.hc == null) continue; const tot = r.hc + r.ac; p = 0; for (let i = 0; i < G.length; i++) for (let j = 0; j < G[i].length; j++) if (i + j === tot) p += G[i][j]; }
        res[xi][0] -= Math.log(Math.max(p, 1e-6)); res[xi][1]++;
      }
    }
  }
}
for (const x of xis) console.log(field, x, (res[x][0] / res[x][1]).toFixed(5), res[x][1]);
