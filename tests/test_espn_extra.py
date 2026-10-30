"""ESPN: detalle de partidos de fútbol (primer gol, goleadores, fueras de juego), cuartos de la NBA y cuartos de la Euroliga."""
import sys, json, pathlib, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import data as d
d.DATA = pathlib.Path(tempfile.mkdtemp()); d.ROOT = pathlib.Path(tempfile.mkdtemp()); (d.ROOT / 'data').mkdir()
soc = {'events': [{'competitions': [{'date': '2026-10-25T19:00Z', 'status': {'type': {'completed': True}}, 'competitors': [
    {'homeAway': 'home', 'id': '1', 'score': '2', 'team': {'id': '1', 'displayName': 'Real Madrid'}, 'statistics': [{'name': 'offsides', 'displayValue': '3'}]},
    {'homeAway': 'away', 'id': '2', 'score': '1', 'team': {'id': '2', 'displayName': 'FC Barcelona'}, 'statistics': [{'name': 'offsides', 'displayValue': '1'}]}],
  'details': [{'scoringPlay': True, 'clock': {'displayValue': "70'"}, 'team': {'id': '1'}, 'athletesInvolved': [{'displayName': 'Mbappé'}]},
              {'scoringPlay': True, 'clock': {'displayValue': "12'"}, 'team': {'id': '2'}, 'athletesInvolved': [{'displayName': 'Lewandowski'}]},
              {'scoringPlay': True, 'clock': {'displayValue': "45'+2'"}, 'team': {'id': '1'}, 'ownGoal': True, 'athletesInvolved': [{'displayName': 'Araujo'}]},
              {'scoringPlay': False, 'clock': {'displayValue': "30'"}, 'team': {'id': '1'}}]}]}]}
nba = {'events': [{'competitions': [{'date': '2026-10-25T23:30Z', 'status': {'type': {'completed': True}}, 'competitors': [
    {'homeAway': 'home', 'team': {'displayName': 'Boston Celtics'}, 'linescores': [{'value': 30}, {'value': 25}, {'value': 28}, {'value': 20}, {'value': 10}]},
    {'homeAway': 'away', 'team': {'displayName': 'New York Knicks'}, 'linescores': [{'value': 25}, {'value': 30}, {'value': 20}, {'value': 28}, {'value': 5}]}]}]}]}
summ = {'boxscore': {'teams': [{'team': {'displayName': 'Real Madrid'}, 'statistics': [{'name': 'offsides', 'displayValue': '3'}, {'name': 'totalPasses', 'displayValue': '512'}, {'name': 'possessionPct', 'displayValue': '58.4'}]},
                               {'team': {'displayName': 'FC Barcelona'}, 'statistics': [{'name': 'offsides', 'displayValue': '1'}, {'name': 'totalPasses', 'displayValue': '430'}, {'name': 'possessionPct', 'displayValue': '41.6'}]}]}}
for c_ in soc['events'][0]['competitions'][0]['competitors']: c_.pop('statistics')
soc['events'][0]['id'] = '99'
d.get = lambda url: json.dumps(summ if '/summary?event=99' in url else soc if '/soccer/esp.1/scoreboard' in url else nba if '/nba/' in url else {'events': []}).encode()
d.update_soccer_espn()
s = d.load('soccer_events.json'); r = s['SP1|2026-10-25|Real Madrid|FC Barcelona']
assert r['st']['H']['pass'] == 512 and r['st']['A']['pos'] == 41.6, r
assert r['offH'] == 3 and r['offA'] == 1 and [g['min'] for g in r['goals']] == [12, 45, 70] and r['goals'][0]['side'] == 'A' and r['goals'][1]['og'] and len(r['goals']) == 3, r
d.update_basket_periods(); q = d.load('basket_periods.json')['nba|2026-10-25|Boston Celtics|New York Knicks']
assert q['q'] == [[30, 25], [25, 30], [28, 20], [20, 28]] and q['ot'] == 1, q
g = {'data': [{'played': True, 'utcDate': '2026-10-23T18:00:00Z', 'local': {'club': {'name': 'Olympiacos'}, 'score': 80, 'partials': {'partials1': 20, 'partials2': 20, 'partials3': 20, 'partials4': 20, 'extraPeriods': {}}},
               'road': {'club': {'name': 'Real Madrid'}, 'score': 75, 'partials': {'partials1': 15, 'partials2': 20, 'partials3': 20, 'partials4': 20}}}]}
d.get = lambda url: json.dumps(g).encode()
d.euroleague_games('E', [{'d': 1, 'h': 'x', 'a': 'y', 'hp': 1, 'ap': 0}])
assert d.BK_PERIODS['euroliga|2026-10-23|Olympiacos|Real Madrid'] == {'q': [[20, 15], [20, 20], [20, 20], [20, 20]], 'ot': 0}, d.BK_PERIODS
print('ok ESPN fútbol, cuartos NBA y Euroliga')
