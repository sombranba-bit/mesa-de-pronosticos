"""Betfair Exchange (API oficial, cuenta de betfair.es): probabilidad «justa» del mercado de intercambio, cada hora.
Precio medio entre la mejor oferta y la mejor demanda, sin margen de casa. Sirve de referencia cuando Pinnacle no ofrece el
partido y, guardando la última lectura antes del inicio, como cuota de cierre para el CLV.
Requiere BETFAIR_USER, BETFAIR_PASS y BETFAIR_APP_KEY (clave de aplicación gratuita «Delay»). Sin ellas no hace nada.
Uso: python pipeline/betfair.py"""
import os, json, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'data' / 'betfair.json'
CLOSE = ROOT / 'data' / 'betfair_close.json'
NOW = dt.datetime.now(dt.timezone.utc)
SPORTS = {'1': 'futbol', '2': 'tenis', '7522': 'baloncesto'}
MAX_SPREAD = 1.10   # oferta/demanda más separadas que un 10 % no dan un precio fiable


def mid(r):
    """Precio medio de un corredor con oferta y demanda; None si falta una o están muy separadas."""
    back = (r.get('back') or [None])[0]; lay = (r.get('lay') or [None])[0]
    if not back or not lay or back <= 1 or lay / back > MAX_SPREAD:
        return None
    return (back + lay) / 2


def fair_codes(market_type, sport, home, away, runners):
    """{'H','D','A'} o {'O','U'} como cuotas justas (suman probabilidad 1). runners: [{name, back:[..], lay:[..]}]."""
    code = {}
    for r in runners:
        n = r['name'].strip().lower()
        if market_type == 'OVER_UNDER_25':
            k = 'O' if n.startswith('over') else 'U' if n.startswith('under') else None
        elif n in ('the draw', 'empate', 'draw'):
            k = 'D'
        else:
            k = 'H' if n == home.lower() else 'A' if n == away.lower() else None
        if k:
            code[k] = mid(r)
    need = {'O', 'U'} if market_type == 'OVER_UNDER_25' else ({'H', 'D', 'A'} if sport == 'futbol' else {'H', 'A'})
    if set(code) != need or any(v is None for v in code.values()):
        return None
    tot = sum(1 / v for v in code.values())
    return {k: round(v * tot, 3) for k, v in code.items()}


def teams(event_name):
    """«Local v Visitante» (fútbol, tenis) o «Visitante @ Local» (baloncesto americano)."""
    if ' @ ' in event_name:
        a, h = event_name.split(' @ ', 1); return h.strip(), a.strip()
    if ' v ' in event_name:
        h, a = event_name.split(' v ', 1); return h.strip(), a.strip()
    return None


def main():
    user, pw, key = (os.environ.get(k) for k in ('BETFAIR_USER', 'BETFAIR_PASS', 'BETFAIR_APP_KEY'))
    if not (user and pw and key):
        return
    import betfairlightweight
    from betfairlightweight import filters
    client = betfairlightweight.APIClient(user, pw, app_key=key, locale='spain')
    try:
        client.login_interactive()
    except Exception as e:
        print('AVISO Betfair (inicio de sesión):', e); return
    try:
        cat = client.betting.list_market_catalogue(
            filter=filters.market_filter(event_type_ids=list(SPORTS), market_type_codes=['MATCH_ODDS', 'OVER_UNDER_25'],
                                         market_start_time={'from': NOW.isoformat(), 'to': (NOW + dt.timedelta(hours=48)).isoformat()}),
            market_projection=['EVENT', 'EVENT_TYPE', 'RUNNER_DESCRIPTION', 'MARKET_START_TIME'], max_results=1000)
        info = {}
        for c in cat:
            t = teams(c.event.name) if c.event else None
            if t and c.event_type and c.event_type.id in SPORTS:
                info[c.market_id] = (SPORTS[c.event_type.id], c.description.market_type if c.description else 'MATCH_ODDS',
                                     t, c.market_start_time, {r.selection_id: r.runner_name for r in c.runners})
        events = {}
        ids = list(info)
        for i in range(0, len(ids), 40):   # 40 mercados por consulta (límite de peso de la API)
            for b in client.betting.list_market_book(market_ids=ids[i:i + 40], price_projection=filters.price_projection(price_data=['EX_BEST_OFFERS'])):
                sport, mtype, (h, a), start, names = info[b.market_id]
                if b.status != 'OPEN' or b.inplay:
                    continue
                runners = [{'name': names.get(r.selection_id, ''), 'back': [p.price for p in r.ex.available_to_back[:1]],
                            'lay': [p.price for p in r.ex.available_to_lay[:1]]} for r in b.runners if r.status == 'ACTIVE']
                f = fair_codes(mtype if mtype == 'OVER_UNDER_25' else 'MATCH_ODDS', sport, h, a, runners)
                if not f:
                    continue
                k = f"{sport}|{h}|{a}"
                ev = events.setdefault(k, {'sport': sport, 'home': h, 'away': a, 'kickoff': start.replace(tzinfo=dt.timezone.utc).isoformat().replace('+00:00', 'Z'), 'fair': {}})
                ev['fair'].update(f)
    except Exception as e:
        print('AVISO Betfair:', e); return
    finally:
        try: client.logout()
        except Exception: pass
    out = list(events.values())
    OUT.write_text(json.dumps({'updated': NOW.isoformat().replace('+00:00', 'Z'), 'events': out}, ensure_ascii=False))
    # cierre: la última lectura antes del inicio se queda congelada (se guardan 30 días)
    close = json.loads(CLOSE.read_text()) if CLOSE.exists() else {}
    for e in out:
        close[f"{e['kickoff'][:10]}|{e['home']}|{e['away']}"] = {'sport': e['sport'], 'kickoff': e['kickoff'], 'fair': e['fair']}
    lim = (NOW - dt.timedelta(days=30)).isoformat()
    close = {k: v for k, v in close.items() if v['kickoff'] >= lim}
    CLOSE.parent.mkdir(exist_ok=True); CLOSE.write_text(json.dumps(close, ensure_ascii=False, separators=(',', ':')))
    print(f'Betfair: {len(out)} partidos con precio del intercambio · {len(close)} cierres guardados')


if __name__ == '__main__':
    main()
