import sys, json, tempfile, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import data as D
D.ROOT = pathlib.Path(tempfile.mkdtemp())
ev = {'events': [{'name': 'China Open', 'major': False, 'groupings': [{'grouping': {'slug': 'mens-singles'}, 'competitions': [
  {'id': '1', 'date': '2026-09-28T03:00Z', 'status': {'type': {'name': 'STATUS_FINAL', 'completed': True}},
   'competitors': [{'winner': False, 'athlete': {'displayName': 'Alejandro Davidovich Fokina'}, 'linescores': [{'value': 4.0}, {'value': 3.0}]},
                   {'winner': True, 'athlete': {'displayName': 'Jannik Sinner'}, 'linescores': [{'value': 6.0}, {'value': 6.0}]}]},
  {'id': '2', 'date': '2026-09-29T03:00Z', 'status': {'type': {'name': 'STATUS_SCHEDULED', 'completed': False}}, 'competitors': []},
  {'id': '3', 'date': '2026-10-01T12:30Z', 'timeValid': True, 'status': {'type': {'name': 'STATUS_SCHEDULED', 'state': 'pre', 'completed': False}},
   'competitors': [{'order': 1, 'athlete': {'displayName': 'Jannik Sinner'}}, {'order': 2, 'athlete': {'displayName': 'Alejandro Davidovich Fokina'}}]},
  {'id': '4', 'date': '2026-10-01T14:00Z', 'status': {'type': {'name': 'STATUS_SCHEDULED', 'state': 'pre', 'completed': False}},
   'competitors': [{'order': 1, 'athlete': {'displayName': 'TBD'}}, {'order': 2, 'athlete': {'displayName': 'Jannik Sinner'}}]}]}]}]}
D.get = lambda url: json.dumps(ev).encode()
D.TODAY = D.dt.date(2026, 10, 1); D.NOW = D.dt.datetime(2026, 10, 1, 8, 0, tzinfo=D.dt.timezone.utc)
saved = {}; D.save = lambda n, v: saved.__setitem__(n, v)
base = {k: None for k in D.SETS + list(D.ODDS)}
rows = {(D.day(D.dt.date(2026, 9, 10)), 'Davidovich Fokina A.', 'Sinner J.'): {'d': D.day(D.dt.date(2026, 9, 10)), 'tour': 0, 'surf': 0, 'bo': 3, 'completed': 1, 'w': 'Davidovich Fokina A.', 'l': 'Sinner J.', 'tourn': 'x', **base, 'bW': 2.0}}
n = D.update_tennis_espn(rows)
assert n == 1, n
r = [r for r in rows.values() if r['tourn'] == 'China Open'][0]
assert r['w'] == 'Sinner J.' and r['l'] == 'Davidovich Fokina A.' and r['W1'] == 6 and r['L2'] == 3 and r['surf'] == 0 and r['completed'] == 1, r
nx = saved['tennis_next.json']
assert len(nx) == 1 and nx[0]['a'] == 'Sinner J.' and nx[0]['b'] == 'Davidovich Fokina A.' and nx[0]['kickoff'] == '2026-10-01T12:30Z' and nx[0]['noTime'] is False, nx
assert D.update_tennis_espn(rows) == 0   # mismo tramo de 3 horas: no repite
print('ok ESPN tenis')
