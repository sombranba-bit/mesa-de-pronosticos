"""Mejor cuota por resultado: ignora la cuota anómala y guarda la casa."""
import sys, pathlib, datetime as dt
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import odds as O
t = (O.NOW - dt.timedelta(minutes=2)).isoformat()
bk = lambda name, h, d, a, o, u: {'key': name.lower(), 'title': name, 'last_update': t, 'markets': [
    {'key': 'h2h', 'outcomes': [{'name': 'Real Madrid', 'price': h}, {'name': 'Draw', 'price': d}, {'name': 'Barcelona', 'price': a}]},
    {'key': 'totals', 'outcomes': [{'name': 'Over', 'price': o, 'point': 2.5}, {'name': 'Under', 'price': u, 'point': 2.5}]}]}
ev = {'home_team': 'Real Madrid', 'away_team': 'Barcelona', 'commence_time': '2026-10-25T15:00:00Z', 'sport_title': 'La Liga',
      'bookmakers': [bk('Pinnacle', 2.10, 3.6, 3.4, 1.70, 2.20), bk('Codere', 2.05, 3.5, 3.3, 1.72, 2.10), bk('Winamax', 2.15, 3.4, 3.5, 1.68, 2.15), bk('Raro', 4.00, 3.5, 3.3, 1.6, 2.1)]}
best = O.analyse(ev)[3]
assert best['H'][:2] == [2.15, 'Winamax'], best   # 4,00 es anómala
assert best['O'][:2] == [1.72, 'Codere'] and best['U'][:2] == [2.20, 'Pinnacle'] and best['D'][0] == 3.6, best
print('ok mejor cuota')

# «Ambos marcan»: se pide solo para los pronósticos de ese mercado y se añade a la mejor cuota del partido
import json, tempfile
k = (O.NOW + dt.timedelta(hours=5)).isoformat().replace('+00:00', 'Z')
O.ROOT = pathlib.Path(tempfile.mkdtemp()); (O.ROOT / 'docs' / 'data').mkdir(parents=True)
(O.ROOT / 'docs' / 'data' / 'predictions.json').write_text(json.dumps({'matches': [{'sport': 'futbol', 'home': 'Real Madrid', 'away': 'Barcelona', 'kickoff': k, 'pick': {'code': 'BY', 'p': 0.7}}]}))
ev2 = {**ev, 'id': 'e1', 'commence_time': k}
out = {'surebets': [], 'value': [], 'anomalies': [], 'best': [O.analyse(ev2)[3]]}
class Resp:
    ok = True; headers = {'x-requests-remaining': '300', 'x-requests-last': '1'}
    def json(self): return {**ev2, 'bookmakers': [{'key': 'p', 'title': 'Pinnacle', 'last_update': t, 'markets': [{'key': 'btts', 'outcomes': [{'name': 'Yes', 'price': 1.55}, {'name': 'No', 'price': 2.4}]}]},
                                                  {'key': 'c', 'title': 'Codere', 'last_update': t, 'markets': [{'key': 'btts', 'outcomes': [{'name': 'Yes', 'price': 1.6}, {'name': 'No', 'price': 2.3}]}]}]}
calls = []
O.requests.get = lambda url, **kw: calls.append(url) or Resp()
O.btts_best('x', [('soccer_spain_la_liga', ev2)], out, O.NOW + dt.timedelta(hours=30), 400)
assert len(calls) == 1 and out['best'][0]['BY'][:2] == [1.6, 'Codere'] and out['best'][0]['H'][0] == 2.15, out['best'][0]
print('ok ambos marcan')
