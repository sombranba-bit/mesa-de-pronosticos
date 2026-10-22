"""Nombres de ESPN -> ClubElo para las competiciones europeas."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import data as D
clubs = {'Paris SG': 1900, 'Paris FC': 1500, 'Rennes': 1700, 'Sociedad': 1750, 'Celta': 1700, 'Celta B': 1300, 'Milan': 1800, 'Inter': 1900, 'Lech': 1500,
         'Lechia': 1400, 'Bodoe/Glimt': 1750, 'Dinamo Zagreb': 1650, 'Dinamo Bucuresti': 1450, 'Sparta Praha': 1650, 'Sparta Rotterdam': 1500, 'Atletico': 1900}
want = {'Paris Saint-Germain': 'Paris SG', 'Stade Rennais': 'Rennes', 'Real Sociedad': 'Sociedad', 'Celta Vigo': 'Celta', 'AC Milan': 'Milan',
        'Inter Milan': 'Inter', 'Lech Poznan': 'Lech', 'Bodo/Glimt': 'Bodoe/Glimt', 'Dinamo Zagreb': 'Dinamo Zagreb', 'Sparta Prague': 'Sparta Praha',
        'Atletico Madrid': 'Atletico', 'Ararat-Armenia': None}
bad = {n: (D.ce_name(n, clubs), w) for n, w in want.items() if D.ce_name(n, clubs) != w}
assert not bad, bad
print('ok nombres UEFA')

# partidos y resultados desde el marcador (simulado)
import json, tempfile, datetime as dt
tmp = pathlib.Path(tempfile.mkdtemp()); store = {'clubelo.json': {'clubs': [[c, 'X', e] for c, e in clubs.items()]}}
D.load = lambda n: store.get(n); D.save = lambda n, v: store.__setitem__(n, v)
k1 = (D.NOW + dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%MZ'); k0 = (D.NOW - dt.timedelta(days=1)).strftime('%Y-%m-%dT%H:%MZ')
ev = lambda h, a, k, done, sh='0', sa='0': {'date': k, 'competitions': [{'status': {'type': {'completed': done}}, 'competitors': [
    {'homeAway': 'home', 'score': sh, 'team': {'displayName': h}}, {'homeAway': 'away', 'score': sa, 'team': {'displayName': a}}]}]}
pages = {'uefa.europa': {'events': [ev('Celta Vigo', 'AC Milan', k1, False), ev('Real Sociedad', 'Lech Poznan', k0, True, '2', '1')]}}
D.get = lambda url: json.dumps(next((v for s, v in pages.items() if f'/soccer/{s}/' in url), {'events': []})).encode()
fx = {'uefa': []}
D.update_uefa_espn(fx)
f = fx['uefa'][0]
assert len(fx['uefa']) == 1 and f['h'] == 'Celta' and f['a'] == 'Milan' and f['competition'] == 'Europa League' and f['noTime'] is False and f['eh'] == 1700, fx
r = store['uefa.json']['results'][0]
assert (r['h'], r['a'], r['hg'], r['ag']) == ('Sociedad', 'Lech', 2, 1), r
print('ok partidos UEFA')
