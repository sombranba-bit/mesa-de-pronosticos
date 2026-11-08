// Ajuste de parámetros con validación temporal (entrena con el pasado, comprueba con lo que vino después). Uso: node tools/<fichero>.mjs
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
import path from 'node:path'; import { fileURLToPath } from 'node:url'; const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = req(ROOT + '/docs/data/tennis.json');
const ll = (p, y) => -Math.log(y ? p : 1 - p);
// Elo paramétrico: k = kA/(n+5)^kE, multiplicado por (1 + boost·min(días sin jugar,365)/365)
function run(o) {
  const TN_MK = { k: o.mk ?? 0.35, wElo: o.wElo ?? 0.199, wMk: o.wMk ?? 0.738 };
  const P = T.players.length, R = new Float64Array(P).fill(1500), S = [0,1,2,3].map(() => new Float64Array(P).fill(1500));
  const N = new Float64Array(P), NS = [0,1,2,3].map(() => new Float64Array(P)), last = new Float64Array(P).fill(-1);
  const Mk = new Float64Array(P), Ms = new Uint8Array(P);
  const K = (n, g) => o.kA / Math.pow(n + 5, o.kE) * (1 + o.boost * Math.min(g < 0 ? 0 : g, 365) / 365);
  const acc = {}; const add = (k, v) => { const y = new Date(T.date[k] * 864e5).getUTCFullYear(); (acc[y] ||= [0, 0]); acc[y][0] += v; acc[y][1]++; };
  for (let k = 0; k < T.date.length; k++) {
    const w = T.w[k], l = T.l[k], s = T.surf[k];
    if (!T.completed[k] && T.W1[k] == null) continue;
    const rw = (1 - o.wS) * R[w] + o.wS * S[s][w], rl = (1 - o.wS) * R[l] + o.wS * S[s][l];
    const p = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    if (N[w] >= 10 && N[l] >= 10) {
      const dm = Ms[w] && Ms[l] ? Mk[w] - Mk[l] : null;
      const q = dm == null ? 1 / (1 + Math.exp(-o.c * Math.log(p / (1 - p)))) : 1 / (1 + Math.exp(-(TN_MK.wElo * Math.log(p / (1 - p)) + TN_MK.wMk * dm)));
      // la mitad de los partidos se presentan con el ganador como «A»: da igual para log-loss
      add(k, ll(Math.min(Math.max(q, 1e-6), 1 - 1e-6), 1)); if (dm == null) { acc.nm = acc.nm || [0, 0]; acc.nm[0] += ll(q, 1); acc.nm[1]++; }
    }
    const ow = T.pW && T.pW[k], ol = T.pL && T.pL[k];
    if (ow > 1 && ol > 1) { const q = Math.min(Math.max((1 / ow) / (1 / ow + 1 / ol), 0.01), 0.99), e = Math.log(q / (1 - q)) - (Mk[w] - Mk[l]); Mk[w] += TN_MK.k * e; Mk[l] -= TN_MK.k * e; Ms[w] = Ms[l] = 1; }
    if (T.completed[k]) {
      const gw = last[w] < 0 ? -1 : T.date[k] - last[w], gl = last[l] < 0 ? -1 : T.date[k] - last[l];
      R[w] += K(N[w], gw) * (1 - p); R[l] -= K(N[l], gl) * (1 - p);
      const ps = 1 / (1 + Math.pow(10, (S[s][l] - S[s][w]) / 400));
      S[s][w] += K(NS[s][w], gw) * (1 - ps); S[s][l] -= K(NS[s][l], gl) * (1 - ps);
      N[w]++; N[l]++; NS[s][w]++; NS[s][l]++; last[w] = last[l] = T.date[k];
    }
  }
  const avg = ys => { let a = 0, n = 0; for (const y of ys) if (acc[y]) { a += acc[y][0]; n += acc[y][1]; } return [+(a / n).toFixed(5), n]; };
  return { tr: avg([2022, 2023, 2024]), te: avg([2025, 2026]) };
}
const base = { kA: 250, kE: 0.4, wS: 0.3, boost: 0, c: 0.75, mk: 0.35, wElo: 0.199, wMk: 0.738 };
console.log('base', JSON.stringify(run(base)));
let best = { ...base }, bt = run(base).tr[0];
for (const key of ['kA', 'kE', 'wS', 'boost', 'mk', 'wElo', 'wMk', 'c', 'kA', 'wS', 'boost', 'mk', 'wElo', 'wMk']) {
  const grid = { kA: [180, 210, 250, 290, 330], kE: [0.3, 0.35, 0.4, 0.45, 0.5], wS: [0.2, 0.3, 0.4, 0.5], boost: [0, 0.25, 0.5, 1, 1.5, 2], mk: [0.25, 0.3, 0.35, 0.45, 0.55], wElo: [0.12, 0.16, 0.2, 0.25, 0.3], wMk: [0.6, 0.68, 0.74, 0.8, 0.88], c: [0.65, 0.7, 0.75, 0.8, 0.85] }[key];
  for (const v of grid) { const o = { ...best, [key]: v }, r = run(o).tr[0]; if (r < bt - 1e-5) { bt = r; best = o; } }
  console.log(key, JSON.stringify(best), bt);
}
console.log('best', JSON.stringify(best), JSON.stringify(run(best)));
