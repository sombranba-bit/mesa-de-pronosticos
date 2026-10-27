"""Cuotas (opcional, separado de los pronósticos): surebets, valor frente a Pinnacle y cuotas anómalas.
Requiere ODDS_API_KEY (The Odds API, plan gratuito de 500 créditos al mes). Dos pasadas al día como máximo,
repartiendo los créditos que quedan entre los días que faltan del mes.
Uso: python pipeline/odds.py"""
import os, json, html, datetime as dt, statistics
from zoneinfo import ZoneInfo
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'data' / 'odds.json'
STATE = ROOT / 'data' / 'state.json'
NOW = dt.datetime.now(dt.timezone.utc)
API = 'https://api.the-odds-api.com/v4'
SPORTS = ['soccer_spain_la_liga', 'soccer_uefa_champs_league', 'soccer_epl', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one',
          'soccer_spain_segunda_division', 'soccer_uefa_europa_league', 'soccer_netherlands_eredivisie', 'soccer_portugal_primeira_liga', 'soccer_efl_champ',
          'soccer_uefa_europa_conference_league', 'soccer_turkey_super_league', 'soccer_belgium_first_div', 'soccer_spl', 'soccer_greece_super_league',
          'basketball_euroleague', 'basketball_nba']
# nuestras ligas -> claves de The Odds API (para pedir primero las de la selección del día)
LEAGUE_KEYS = {'SP1': ['soccer_spain_la_liga'], 'SP2': ['soccer_spain_segunda_division'], 'E0': ['soccer_epl'], 'E1': ['soccer_efl_champ'], 'I1': ['soccer_italy_serie_a'],
               'D1': ['soccer_germany_bundesliga'], 'F1': ['soccer_france_ligue_one'], 'N1': ['soccer_netherlands_eredivisie'], 'P1': ['soccer_portugal_primeira_liga'],
               'T1': ['soccer_turkey_super_league'], 'B1': ['soccer_belgium_first_div'], 'SC0': ['soccer_spl'], 'G1': ['soccer_greece_super_league'],
               'UEFA': ['soccer_uefa_champs_league', 'soccer_uefa_europa_league', 'soccer_uefa_europa_conference_league'], 'nba': ['basketball_nba'], 'euroliga': ['basketball_euroleague']}
VALUE_MIN, SURE_MIN, ANOMALY = 0.03, 0.002, 1.25
EXCHANGES, COMMISSION = ('betfair_ex', 'matchbook', 'smarkets'), 0.05   # en los exchanges se paga comisión sobre la ganancia
STALE_MIN = 20   # cuotas sin actualizar en más de 20 minutos no cuentan (provocan falsas surebets)


def fair(prices):
    """Probabilidades sin margen: Shin para 3 resultados, potencia para 2 (como en la app)."""
    q = [1 / p for p in prices]; s = sum(q); n = len(q)
    if n == 2:
        lo, hi = 0.5, 3.0
        for _ in range(60):
            k = (lo + hi) / 2
            if sum(x ** k for x in q) > 1: lo = k
            else: hi = k
        return [x ** ((lo + hi) / 2) for x in q]
    z = 0.0
    for _ in range(50):
        z = (sum((z * z + 4 * (1 - z) * x * x / s) ** 0.5 for x in q) - 2) / (n - 2)
    p = [((z * z + 4 * (1 - z) * x * x / s) ** 0.5 - z) / (2 * (1 - z)) for x in q]
    t = sum(p); return [x / t for x in p]


def analyse(event):
    """Devuelve surebets, valor frente a Pinnacle y anomalías de un evento de The Odds API."""
    sure, value, anom = [], [], []
    best_ev = {'sport': event.get('sport_title', ''), 'home': event['home_team'], 'away': event['away_team'], 'kickoff': event['commence_time']}
    markets = {}   # (mercado, línea) -> {resultado: {casa: cuota}}
    fresh = lambda t: not t or (NOW - dt.datetime.fromisoformat(t.replace('Z', '+00:00'))).total_seconds() <= STALE_MIN * 60
    for b in event.get('bookmakers', []):
        exch = any(x in b.get('key', '') for x in EXCHANGES)
        for m in b.get('markets', []):
            if not fresh(m.get('last_update') or b.get('last_update')):
                continue
            for o in m.get('outcomes', []):
                key = (m['key'], o.get('point'))
                price = 1 + (o['price'] - 1) * (1 - COMMISSION) if exch else o['price']
                markets.setdefault(key, {}).setdefault(o['name'], {})[b['title']] = round(price, 3)
    base = {'match': f"{event['home_team']} – {event['away_team']}", 'kickoff': event['commence_time'], 'sport': event.get('sport_title', '')}
    for (mk, point), outs in markets.items():
        label = 'Ganador' if mk == 'h2h' else 'Ambos marcan' if mk == 'btts' else f"Más/menos {str(point).replace('.', ',')}"
        names = list(outs)
        if (mk == 'h2h' and len(names) not in (2, 3)) or (mk in ('totals', 'btts') and len(names) != 2):
            continue
        best = {n: max(outs[n].items(), key=lambda x: x[1]) for n in names}
        inv = sum(1 / best[n][1] for n in names)
        if inv < 1 - SURE_MIN and all(len(outs[n]) >= 2 for n in names):
            sure.append({**base, 'market': label, 'profit': round(1 / inv - 1, 4),
                         'legs': [{'outcome': n, 'book': best[n][0], 'odds': best[n][1], 'stake': round((1 / best[n][1]) / inv, 4)} for n in names]})
        pin = {n: outs[n].get('Pinnacle') for n in names}
        if all(pin.values()):
            fp = dict(zip(names, fair([pin[n] for n in names])))
            for n in names:
                for book, price in outs[n].items():
                    ev = price * fp[n] - 1
                    if book != 'Pinnacle' and ev >= VALUE_MIN:
                        value.append({**base, 'market': label, 'outcome': n, 'book': book, 'odds': price, 'fair': round(1 / fp[n], 3), 'ev': round(ev, 4)})
        for n in names:
            prices = outs[n]
            if len(prices) < 4:
                continue
            for book, price in prices.items():
                others = [p for b2, p in prices.items() if b2 != book]
                med = statistics.median(others)
                if price >= ANOMALY * med:
                    anom.append({**base, 'market': label, 'outcome': n, 'book': book, 'odds': price, 'median': round(med, 3), 'ratio': round(price / med, 3)})
        # mejor cuota por resultado (para los pronósticos), descartando las anómalas: suelen ser errores o cuotas viejas
        code = ({event['home_team']: 'H', 'Draw': 'D', event['away_team']: 'A'} if mk == 'h2h' else {'Yes': 'BY', 'No': 'BN'} if mk == 'btts'
                else {'Over': 'O', 'Under': 'U'} if point == 2.5 else {})
        for n in names:
            if n not in code: continue
            prices = outs[n]; med = statistics.median(prices.values())
            ok = {b2: p for b2, p in prices.items() if len(prices) < 3 or p < ANOMALY * med}
            if ok:
                b2, p = max(ok.items(), key=lambda x: x[1]); best_ev[code[n]] = [p, b2, len(prices)]
        if all(pin.values()):   # cuota justa de Pinnacle (sin margen): referencia para el valor y el CLV del registro de apuestas
            for n, f in zip(names, fair([pin[n] for n in names])):
                if n in code: best_ev.setdefault('fair', {})[code[n]] = round(1 / f, 3)
    es = {'Draw': 'Empate', 'Over': 'Más', 'Under': 'Menos', 'Yes': 'Sí', 'No': 'No'}   # nombres de la fuente en español
    for x in sure:
        for l in x['legs']: l['outcome'] = es.get(l['outcome'], l['outcome'])
    for x in value + anom: x['outcome'] = es.get(x['outcome'], x['outcome'])
    return sure, value, anom, best_ev


BTTS_MAX = 8   # partidos por pasada (1 crédito cada uno)
_n = lambda s: ''.join(c for c in __import__('unicodedata').normalize('NFD', str(s).lower()) if c.isalnum() or c == ' ')
GENERIC = {'club', 'real', 'sporting', 'city', 'united', 'olympique', 'stade', 'racing', 'deportivo', 'athletic', 'union', 'borussia', 'calcio', 'football'}


def same_team(a, b):
    A = [t for t in _n(a).split() if len(t) >= 3 and t not in GENERIC]; B = [t for t in _n(b).split() if len(t) >= 3 and t not in GENERIC]
    return any(x == y or (len(x) >= 4 and len(y) >= 4 and (x.startswith(y) or y.startswith(x))) for x in A for y in B)


def btts_best(key, events, out, horizon, remaining):
    pred = json.loads((ROOT / 'docs' / 'data' / 'predictions.json').read_text()) if (ROOT / 'docs' / 'data' / 'predictions.json').exists() else {}
    want = [m for m in pred.get('matches', []) if m.get('sport') == 'futbol' and (m.get('pick') or {}).get('code') in ('BY', 'BN') and m['pick']['p'] >= 0.6
            and NOW < dt.datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) <= horizon]
    want.sort(key=lambda m: -m['pick']['p'])
    used = 0
    for m in want:
        if used >= BTTS_MAX or (remaining is not None and remaining < 20): break   # se deja margen para el resto del mes
        mk = dt.datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00'))
        hit = next(((sp, ev) for sp, ev in events if not sp.startswith('basketball') and same_team(m['home'], ev['home_team']) and same_team(m['away'], ev['away_team'])
                    and abs((dt.datetime.fromisoformat(ev['commence_time'].replace('Z', '+00:00')) - mk).total_seconds()) <= 3 * 3600), None)
        if not hit: continue
        sp, ev = hit
        r = requests.get(f"{API}/sports/{sp}/events/{ev['id']}/odds", params={'apiKey': key, 'regions': 'eu', 'markets': 'btts', 'oddsFormat': 'decimal'}, timeout=60)
        if not r.ok: continue
        remaining = float(r.headers.get('x-requests-remaining', 0) or 0); used += float(r.headers.get('x-requests-last', 1) or 1)
        s_, v_, a_, b_ = analyse(r.json()); out['surebets'] += s_; out['value'] += v_; out['anomalies'] += a_
        for b in out['best']:
            if b['home'] == b_['home'] and b['away'] == b_['away'] and b['kickoff'] == b_['kickoff']:
                b.update({k: v for k, v in b_.items() if k in ('BY', 'BN')})
                if b_.get('fair'): b.setdefault('fair', {}).update(b_['fair'])
    print(f'cuotas ambos marcan: {int(used)} partidos consultados')
    return remaining, used


def main():
    key = os.environ.get('ODDS_API_KEY')
    if not key:
        return
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    local = NOW.astimezone(ZoneInfo('Europe/Madrid')); madrid_h = local.hour
    slot = f"{local.date().isoformat()}-{'am' if madrid_h < 17 else 'pm'}"
    if madrid_h < 9 or st.get('oddsSlot') == slot:
        return
    try:
        act_list = requests.get(f'{API}/sports', params={'apiKey': key}, timeout=60).json(); active = {s['key'] for s in act_list}
    except Exception as e:
        print('AVISO cuotas:', e); return
    # eventos de las próximas 30 h (consulta gratuita) para decidir dónde gastar créditos
    horizon = NOW + dt.timedelta(hours=30); counts = {}
    # prioridad: las competiciones de la selección del día (si no, la simulación se queda sin cuotas); tenis: torneos activos ATP/WTA
    pred = json.loads((ROOT / 'docs' / 'data' / 'predictions.json').read_text()) if (ROOT / 'docs' / 'data' / 'predictions.json').exists() else {}
    daily = pred.get('daily') or {}
    sel = [daily.get('bet')] + (daily.get('picks') or []) + [l for c in (daily.get('combos') or {}).values() if c for l in c.get('legs', [])]
    prio = [k for e in sel if e for k in (LEAGUE_KEYS.get(e.get('league')) or ([x['key'] for x in act_list if x['key'].startswith(f"tennis_{e['league']}_")] if e.get('sport') == 'tenis' else []))]
    tennis = [x['key'] for x in act_list if x['key'].startswith(('tennis_atp_', 'tennis_wta_'))]   # torneos de tenis en juego (1 crédito cada uno)
    order = list(dict.fromkeys([k for k in prio if k in active] + [s for s in SPORTS if s in active] + tennis))
    for sp in order:
        try:
            ev = requests.get(f'{API}/sports/{sp}/events', params={'apiKey': key}, timeout=60).json()
            counts[sp] = sum(1 for e in ev if NOW < dt.datetime.fromisoformat(e['commence_time'].replace('Z', '+00:00')) <= horizon)
        except Exception as e:
            print('AVISO cuotas', sp, e)
    events = []
    remaining, used, out = None, 0, {'surebets': [], 'value': [], 'anomalies': [], 'best': []}
    for sp in [s for s in order if counts.get(s)]:
        if remaining is not None:
            days_left = (dt.date(NOW.year + NOW.month // 12, NOW.month % 12 + 1, 1) - NOW.date()).days
            if used >= max(2, remaining / (2 * days_left)):   # reparto del cupo: dos pasadas al día hasta fin de mes
                break
        try:
            mk = 'h2h' if sp.startswith('tennis_') else 'h2h,totals'   # en tenis basta el ganador (1 crédito)
            r = requests.get(f'{API}/sports/{sp}/odds', params={'apiKey': key, 'regions': 'eu', 'markets': mk, 'oddsFormat': 'decimal'}, timeout=60)
            r.raise_for_status()
        except Exception as e:
            print('AVISO cuotas', sp, e); continue
        remaining = float(r.headers.get('x-requests-remaining', 0) or 0); used += float(r.headers.get('x-requests-last', 2) or 2)
        for ev in r.json():
            events.append((sp, ev))
            if NOW < dt.datetime.fromisoformat(ev['commence_time'].replace('Z', '+00:00')) <= horizon:   # solo antes del partido: en directo las cuotas van con retraso
                s_, v_, a_, b_ = analyse(ev); out['surebets'] += s_; out['value'] += v_; out['anomalies'] += a_; out['best'].append(b_)
    # «Ambos marcan» no viene en la consulta general: se pide partido a partido, solo para los pronósticos de ese mercado
    try:
        r_, u_ = btts_best(key, events, out, horizon, remaining)
        used += u_; remaining = r_ if r_ is not None else remaining
    except Exception as e:
        print('AVISO cuotas ambos marcan:', e)
    out = {'updated': NOW.isoformat().replace('+00:00', 'Z'), 'credits_left': remaining,
           'surebets': sorted(out['surebets'], key=lambda x: -x['profit'])[:40], 'value': sorted(out['value'], key=lambda x: -x['ev'])[:60],
           'anomalies': sorted(out['anomalies'], key=lambda x: -x['ratio'])[:40], 'best': out['best']}
    OUT.write_text(json.dumps(out, ensure_ascii=False))
    st['oddsSlot'] = slot; STATE.parent.mkdir(exist_ok=True); STATE.write_text(json.dumps(st))
    print(f"cuotas: {len(out['surebets'])} surebets, {len(out['value'])} con valor, {len(out['anomalies'])} anómalas · créditos restantes {remaining}")
    # aviso por Telegram si config.json lo pide
    cfg = json.loads((ROOT / 'config.json').read_text()).get('telegram', {}) if (ROOT / 'config.json').exists() else {}
    tok, chat = os.environ.get('TELEGRAM_TOKEN'), os.environ.get('TELEGRAM_CHAT_ID')
    if cfg.get('cuotas') and tok and chat and (out['surebets'] or out['anomalies']):
        e, SEP = html.escape, '━━━━━━━━━━━━━━━━'
        icon = lambda sp: '🏀' if 'basket' in sp.lower() or sp in ('NBA', 'Euroleague') else '⚽'
        lines = ['💱 <b>CUOTAS</b>', '<i>Comprueba antes en tu casa: cambian en minutos</i>']
        if out['surebets']:
            lines += ['', SEP, '✅ <b>SUREBETS</b> <i>(ganancia segura repartiendo la apuesta)</i>']
            for s_ in out['surebets'][:5]:
                lines += ['', f"{icon(s_['sport'])} <b>{e(s_['match'])}</b> · {e(s_['market'])}", f"📈 <b>+{s_['profit']:.1%}</b>".replace('.', ',')]
                lines += [f"   • {e(l['outcome'])}: <b>{l['odds']}</b> en {e(l['book'])} ({l['stake']:.0%} del total)" for l in s_['legs']]
        if out['anomalies']:
            lines += ['', SEP, '⚠️ <b>CUOTAS ANÓMALAS</b> <i>(muy por encima del resto: posible error)</i>']
            for a_ in out['anomalies'][:5]:
                lines += ['', f"{icon(a_['sport'])} <b>{e(a_['match'])}</b> · {e(a_['market'])}", f"   • {e(a_['outcome'])}: <b>{a_['odds']}</b> en {e(a_['book'])} (mediana {a_['median']})"]
        requests.post(f'https://api.telegram.org/bot{tok}/sendMessage', json={'chat_id': chat, 'text': '\n'.join(lines), 'parse_mode': 'HTML'}, timeout=30)


if __name__ == '__main__':
    main()
