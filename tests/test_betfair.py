"""Betfair: precio medio sin margen y nombres de equipos."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import betfair as B

r = lambda n, b, l: {'name': n, 'back': [b], 'lay': [l]}
f = B.fair_codes('MATCH_ODDS', 'futbol', 'Real Madrid', 'Barcelona', [r('Real Madrid', 2.0, 2.04), r('Barcelona', 3.6, 3.7), r('The Draw', 3.9, 4.0)])
assert set(f) == {'H', 'D', 'A'} and abs(sum(1 / v for v in f.values()) - 1) < 1e-3, f
assert B.fair_codes('MATCH_ODDS', 'futbol', 'Real Madrid', 'Barcelona', [r('Real Madrid', 2.0, 2.6), r('Barcelona', 3.6, 3.7), r('The Draw', 3.9, 4.0)]) is None   # horquilla demasiado abierta
assert B.fair_codes('MATCH_ODDS', 'tenis', 'A B', 'C D', [r('A B', 1.5, 1.52)]) is None   # falta un jugador
ou = B.fair_codes('OVER_UNDER_25', 'futbol', 'x', 'y', [r('Under 2.5 Goals', 2.1, 2.12), r('Over 2.5 Goals', 1.9, 1.92)])
assert ou['O'] < ou['U'], ou
assert B.teams('Boston Celtics @ Miami Heat') == ('Miami Heat', 'Boston Celtics') and B.teams('Sinner v Alcaraz') == ('Sinner', 'Alcaraz')
print('ok betfair')
