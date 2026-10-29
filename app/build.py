"""Construye la app. Sin argumentos: docs/index.html para GitHub Pages (lee los datos de docs/data/).
Con --embed SALIDA: página única con los datos incrustados."""
import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
APP, DATA = ROOT / 'app', ROOT / 'docs' / 'data'
html = (APP / 'template.html').read_text()
model = (APP / 'model.js').read_text().replace("if (typeof module !== 'undefined') module.exports = M;", '')
html = html.replace('/*MODEL_JS*/', model, 1).replace('/*UI_JS*/', (APP / 'ui.js').read_text(), 1)
if '--embed' in sys.argv:
    out = Path(sys.argv[sys.argv.index('--embed') + 1])
    for key, name in [('FB', 'football'), ('NB', 'nba'), ('EL', 'euroliga'), ('TN', 'tennis'), ('PR', 'predictions'), ('PF', 'performance'), ('CE', 'clubelo'), ('IJ', 'injuries'), ('BX', 'basket_extra'), ('NW', 'news'), ('OD', 'odds'), ('CR', 'crests'), ('HI', 'historial')]:
        p = DATA / f'{name}.json'
        txt = p.read_text() if p.exists() else ''
        assert '</' not in txt, f'{name}.json contiene </ y rompería la página'
        html = html.replace(f'/*DATA_{key}*/', txt, 1)
else:   # GitHub Pages sirve el fichero tal cual: necesita su propio esqueleto (codificación, viewport, reset)
    out = ROOT / 'docs' / 'index.html'
    html = ('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;font-size:14px}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + html + '</body></html>')
out.write_text(html)
print('escrito', out, f'{len(html) / 1e6:.1f} MB')
