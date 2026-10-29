"""Fotos de tenistas: las encontradas se guardan; un fallo de Wikipedia (429) no se guarda como «sin foto»."""
import sys, json, pathlib, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import data as d
d.DATA = pathlib.Path(tempfile.mkdtemp())
d.save('tennis_next.json', [{'a': 'Alcaraz C.', 'fa': 'Carlos Alcaraz', 'b': 'Nadie X.', 'fb': 'Xavier Nadie'}, {'a': 'Sinner J.', 'fa': 'Jannik Sinner', 'b': 'Fritz T.', 'fb': 'Taylor Fritz'}])
def fake(full):
    if full == 'Jannik Sinner': raise d.requests.HTTPError('429')
    return {'img': 'https://upload.wikimedia.org/x.jpg', 'page': 'p'} if full == 'Carlos Alcaraz' else None
d.wiki_photo = fake
d.update_player_photos()
c = d.load('players.json')
assert c['Alcaraz C.']['img'] and 'img' not in c['Nadie X.'] and 'Sinner J.' not in c and 'Fritz T.' not in c, c   # tras el 429 se para y sigue en la próxima
d.wiki_photo = lambda full: {'img': 'u'}
d.update_player_photos(); c = d.load('players.json')
assert c['Sinner J.']['img'] == 'u' and 'img' not in c['Nadie X.'], c   # el «sin foto» no se repite hasta pasadas 2 semanas
print('ok fotos de tenistas')
