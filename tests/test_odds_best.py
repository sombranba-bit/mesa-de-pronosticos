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
c = best['cons']   # media sin margen de las 4 casas: suma 1 y queda entre la más alta y la más baja
assert abs(sum(1 / c[k] for k in 'HDA') - 1) < 0.01 and abs(1 / c['O'] + 1 / c['U'] - 1) < 0.01 and 2.0 < c['H'] < 2.6, c
print('ok consenso')

import json
# los exchanges mandan también «h2h_lay» (cuotas para apostar en contra): no deben dar surebets falsas
lay = {'key': 'matchbook', 'title': 'Matchbook', 'last_update': t, 'markets': [{'key': 'h2h_lay', 'outcomes': [{'name': 'Real Madrid', 'price': 9.0}, {'name': 'Draw', 'price': 9.0}, {'name': 'Barcelona', 'price': 9.0}]}]}
s_, v_, a_, b_ = O.analyse({**ev, 'bookmakers': ev['bookmakers'] + [lay]})
assert all('None' not in x['market'] and 'Matchbook' not in json.dumps(x) for x in s_ + v_ + a_) and b_['H'][0] == 2.15, (s_, b_)
print('ok sin h2h_lay')

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

# OddsPapi: tenis de la selección sin cuota -> mejor cuota y Pinnacle sin margen (orden de jugadores invertido)
import os
os.environ['ODDSPAPI_KEY'] = 'x'
k2 = (O.NOW + dt.timedelta(hours=4)).isoformat().replace('+00:00', 'Z')
(O.ROOT / 'docs' / 'data' / 'predictions.json').write_text(json.dumps({'daily': {'bet': {'id': 't1', 'sport': 'tenis', 'home': 'Alcaraz C.', 'away': 'Sinner J.', 'kickoff': k2, 'pick': {'code': 'H', 'p': 0.6}}, 'picks': []}}))
fx = [{'fixtureId': 'f1', 'participant1Name': 'Jannik Sinner', 'participant2Name': 'Carlos Alcaraz', 'startTime': k2, 'tournamentName': 'Paris'}]
od = {'bookmakerOdds': {'pinnacle': {'markets': {'121': {'outcomes': {'121': {'players': {'0': {'price': 1.80}}}, '122': {'players': {'0': {'price': 2.10}}}}}}},
                        'bet365': {'markets': {'121': {'outcomes': {'121': {'players': {'0': {'price': 1.75}}}, '122': {'players': {'0': {'price': 2.20}}}}}}},
                        'demo': {'markets': {'121': {'outcomes': {'121': {'players': {'0': {'price': 9.0}}}, '122': {'players': {'0': {'price': 9.0}}}}}}}}}
class R2:
    def __init__(s, js): s.js = js
    def json(s): return s.js
O.requests.get = lambda url, **kw: R2(fx if url.endswith('/fixtures') else od)
out2, st2 = {'best': []}, {}
assert O.papi_tennis(out2, st2) == 1, out2
b = out2['best'][0]
assert b['home'] == 'Jannik Sinner' and b['A'][:2] == [2.2, 'Bet365'] and b['H'][:2] == [1.8, 'Pinnacle'] and 1.8 < b['fair']['H'] < 1.9 and st2['papi'], b
assert O.papi_tennis(out2, st2) == 0   # ya tiene cuota: no se vuelve a pedir
print('ok OddsPapi tenis')
