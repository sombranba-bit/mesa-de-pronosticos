"""Descarga resultados y calendario y actualiza docs/data/*.json.
Uso: python pipeline/data.py [--full]   (--full recarga todas las temporadas desde 2019; sin él, solo la actual)
Si una fuente falla se conservan los datos anteriores de esa fuente."""
import io, re, json, sys, math, difflib, datetime as dt
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd, requests
import urllib3.util.connection as _uc
_uc.HAS_IPV6 = False   # algunas máquinas de GitHub no tienen salida IPv6 y cada intento esperaba un minuto: forzar IPv4

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs' / 'data'
FULL = '--full' in sys.argv
NOW = dt.datetime.now(dt.timezone.utc)
TODAY = NOW.date()
SINCE = dt.date(2019, 7, 1)
EPOCH = dt.date(1970, 1, 1)
UA = {'User-Agent': 'Mozilla/5.0 (mesa-de-pronosticos; GitHub Actions)'}
DIVS = {'SP1': 'España - LaLiga', 'SP2': 'España - Segunda', 'E0': 'Inglaterra - Premier', 'E1': 'Inglaterra - Championship',
        'I1': 'Italia - Serie A', 'I2': 'Italia - Serie B', 'D1': 'Alemania - Bundesliga', 'D2': 'Alemania - 2. Bundesliga',
        'F1': 'Francia - Ligue 1', 'F2': 'Francia - Ligue 2', 'N1': 'Países Bajos - Eredivisie', 'P1': 'Portugal - Primeira',
        'SC0': 'Escocia - Premiership', 'SC1': 'Escocia - Championship', 'B1': 'Bélgica - Pro League', 'T1': 'Turquía - Süper Lig', 'G1': 'Grecia - Super League',
        'SP3': 'España - Primera Federación'}   # SP3 no está en football-data: viene de lapreferente.com
FB_FIELDS = ['hth', 'hta', 'hc', 'ac', 'hy', 'ay', 'hr', 'ar', 'oH', 'oD', 'oA', 'oO', 'oU', 'hxg', 'axg', 'ref', 'hst', 'ast', 'il', 'im']
UNDERSTAT = {'SP1': 'La_liga', 'E0': 'EPL', 'I1': 'Serie_A', 'D1': 'Bundesliga', 'F1': 'Ligue_1'}
# API-Football: ids de liga para las bajas (https://www.api-football.com/documentation-v3)
APIF_LEAGUES = {'SP1': 140, 'SP2': 141, 'E0': 39, 'E1': 40, 'I1': 135, 'I2': 136, 'D1': 78, 'D2': 79, 'F1': 61, 'F2': 62, 'N1': 88, 'P1': 94,
                'SC0': 179, 'B1': 144, 'T1': 203, 'G1': 197}
# Alias de nombres frecuentes (otras fuentes -> football-data); el resto se empareja por parecido
ALIAS = {'Atletico Madrid': 'Ath Madrid', 'Athletic Club': 'Ath Bilbao', 'Real Sociedad': 'Sociedad', 'Celta Vigo': 'Celta', 'Rayo Vallecano': 'Vallecano',
         'Deportivo Alaves': 'Alaves', 'Espanyol': 'Espanol', 'Real Betis': 'Betis', 'Real Oviedo': 'Oviedo', 'Manchester United': 'Man United',
         'Manchester City': 'Man City', 'Nottingham Forest': "Nott'm Forest", 'Wolverhampton Wanderers': 'Wolves', 'Newcastle United': 'Newcastle',
         'Tottenham': 'Tottenham', 'West Ham': 'West Ham', 'AC Milan': 'Milan', 'Inter': 'Inter', 'AS Roma': 'Roma', 'Bayern Munich': 'Bayern Munich',
         'Bayern München': 'Bayern Munich', 'Borussia Dortmund': 'Dortmund', 'Borussia M.Gladbach': "M'gladbach", "Borussia Monchengladbach": "M'gladbach",
         'Bayer Leverkusen': 'Leverkusen', 'Eintracht Frankfurt': 'Ein Frankfurt', 'RasenBallsport Leipzig': 'RB Leipzig', 'Paris Saint Germain': 'Paris SG',
         'Paris Saint-Germain': 'Paris SG', 'Olympique Marseille': 'Marseille', 'Olympique Lyonnais': 'Lyon', 'Saint-Etienne': 'St Etienne'}
FIXTURE_DAYS = 10
FB_ROWS = {}


DEAD = set()   # servidores que no responden en esta ejecución: no se reintentan
def get(url):
    host = url.split('/')[2]
    if host in DEAD:
        raise ConnectionError(f'{host} no responde en esta ejecución (se reintenta en la próxima)')
    try:
        r = requests.get(url, headers=UA, timeout=(10, 60))   # 10 s para conectar, 60 s para descargar
    except (requests.ConnectionError, requests.Timeout):
        DEAD.add(host); raise
    r.raise_for_status()
    return r.content


def warn(msg):
    print('AVISO:', msg, flush=True)


def day(d):
    return (d - EPOCH).days


def load(name):
    p = DATA / name
    return json.loads(p.read_text()) if p.exists() else None


def save(name, obj):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / (name + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False))
    tmp.replace(DATA / name)   # escritura atómica: nunca queda un fichero a medias


def num(v, d=2):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x != x else round(x, d)


def ival(v):
    x = num(v, 0)
    return None if x is None else int(x)


# ============================== FÚTBOL (football-data.co.uk) ==============================
def ref_name(v):
    """Nombre de árbitro unificado: 'Michael Oliver, England' y 'M Oliver' -> 'M Oliver'."""
    if v is None or (isinstance(v, float) and v != v):
        return None
    v = str(v).split(',')[0].strip()
    parts = [p for p in v.replace('.', ' ').split() if p]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else f'{parts[0][0]} {" ".join(parts[1:]) if len(parts[0]) == 1 else parts[-1]}'

def season_start(d=TODAY):
    return d.year if d.month >= 7 else d.year - 1


def parse_fd_csv(content, div):
    """CSV de resultados de football-data.co.uk -> lista de partidos."""
    try:
        df = pd.read_csv(io.BytesIO(content), encoding='utf-8-sig')
    except UnicodeDecodeError:
        df = pd.read_csv(io.BytesIO(content), encoding='latin-1')
    df = df.dropna(subset=['HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'])
    dates = pd.to_datetime(df['Date'], dayfirst=True, errors='coerce')
    col = lambda c: df[c] if c in df.columns else pd.Series([None] * len(df), index=df.index)
    out = []
    for i, (idx, r) in enumerate(df.iterrows()):
        if pd.isna(dates.iloc[i]):
            continue
        out.append({'div': div, 'd': day(dates.iloc[i].date()), 'h': str(r.HomeTeam).strip(), 'a': str(r.AwayTeam).strip(),
                    'hg': int(r.FTHG), 'ag': int(r.FTAG),
                    'hth': ival(col('HTHG')[idx]), 'hta': ival(col('HTAG')[idx]), 'hc': ival(col('HC')[idx]), 'ac': ival(col('AC')[idx]),
                    'hy': ival(col('HY')[idx]), 'ay': ival(col('AY')[idx]), 'hr': ival(col('HR')[idx]), 'ar': ival(col('AR')[idx]),
                    'oH': num(col('B365H')[idx]), 'oD': num(col('B365D')[idx]), 'oA': num(col('B365A')[idx]),
                    'oO': num(col('B365>2.5')[idx]), 'oU': num(col('B365<2.5')[idx]),
                    'hst': ival(col('HST')[idx]), 'ast': ival(col('AST')[idx]),
                    'ref': ref_name(col('Referee')[idx])})
    return out


# Goles esperados implícitos en las cuotas de Bet365 de cada partido jugado (1X2 y más/menos 2,5): con ellos se valoran los
# equipos «según el mercado» (el modelo de ratings de cuotas, validado en 17 ligas 2025-26). Rejilla de Poisson, mínimo error.
_IG = None
def implied_goals(rows):
    import numpy as np
    global _IG
    todo = [r for r in rows if r.get('il') is None and all((r.get(k) or 0) > 1 for k in ('oH', 'oD', 'oA', 'oO', 'oU'))]
    if not todo:
        return
    if _IG is None:
        lam = np.arange(0.15, 4.5, 0.025); k = np.arange(11)
        P = np.exp(-lam[:, None]) * lam[:, None] ** k / np.array([math.factorial(i) for i in k])
        J = P[:, None, :, None] * P[None, :, None, :]
        hw = np.tril(np.ones((11, 11)), -1)
        flat = np.c_[(J * hw).sum((2, 3)).ravel(), (J * hw.T).sum((2, 3)).ravel(), (J * (np.add.outer(k, k) > 2.5)).sum((2, 3)).ravel()]
        L1, L2 = np.meshgrid(lam, lam, indexing='ij'); _IG = (flat, L1.ravel(), L2.ravel())
    flat, L1, L2 = _IG
    q = 1 / np.array([[r['oH'], r['oD'], r['oA']] for r in todo]); q /= q.sum(1, keepdims=True)
    qo = 1 / np.array([[r['oO'], r['oU']] for r in todo]); qo = qo[:, 0] / qo.sum(1)
    t = np.c_[q[:, 0], q[:, 2], qo]
    for i in range(0, len(t), 200):
        b = ((t[i:i + 200, None, :] - flat[None]) ** 2).sum(2).argmin(1)
        for r, j in zip(todo[i:i + 200], b):
            r['il'], r['im'] = round(float(L1[j]), 3), round(float(L2[j]), 3)


def fb_rows_from_json(F):
    rows = []
    for k, d in enumerate(F['date']):
        r = {'div': F['divs'][F['div'][k]], 'd': d, 'h': F['teams'][F['h'][k]], 'a': F['teams'][F['a'][k]], 'hg': F['hg'][k], 'ag': F['ag'][k]}
        for f in FB_FIELDS:
            r[f] = F[f][k] if f in F else None
        rows.append(r)
    return rows


def fb_to_json(rows):
    rows = sorted(rows, key=lambda r: (r['d'], r['div'], r['h']))
    teams = sorted({r['h'] for r in rows} | {r['a'] for r in rows})
    ix = {t: i for i, t in enumerate(teams)}
    divs = list(DIVS)
    out = {'divs': divs, 'divNames': list(DIVS.values()), 'teams': teams, 'date': [r['d'] for r in rows], 'div': [divs.index(r['div']) for r in rows],
           'h': [ix[r['h']] for r in rows], 'a': [ix[r['a']] for r in rows], 'hg': [r['hg'] for r in rows], 'ag': [r['ag'] for r in rows]}
    for f in FB_FIELDS:
        out[f] = [r.get(f) for r in rows]
    return out


def update_football():
    prev = load('football.json')
    rows = {(r['d'], r['h'], r['a']): r for r in fb_rows_from_json(prev)} if prev else {}
    cur = season_start()
    seasons = range(SINCE.year, cur + 1) if FULL or not prev else ([cur - 1, cur] if TODAY.month in (7, 8) else [cur])
    got = 0
    for y in seasons:
        code = f'{y % 100:02d}{(y + 1) % 100:02d}'
        for div in [x for x in DIVS if x != 'SP3']:
            try:
                for r in parse_fd_csv(get(f'https://www.football-data.co.uk/mmz4281/{code}/{div}.csv'), div):
                    rows[(r['d'], r['h'], r['a'])] = r; got += 1
            except Exception as e:
                warn(f'fútbol {div} {code}: {e}')
    try:
        update_xg(rows)
    except Exception as e:
        warn(f'xG: {e}')
    implied_goals(rows.values())
    global SP3_FIXTURES
    try:
        SP3_FIXTURES = update_sp3(rows)
    except Exception as e:
        warn(f'Primera Federación: {e}')
    if rows:   # nunca se sobrescribe con un fichero vacío
        save('football.json', fb_to_json([r for r in rows.values() if r['d'] >= day(SINCE)]))
    print(f'fútbol: {got} partidos descargados, {len(rows)} en total')
    global FB_ROWS
    FB_ROWS = rows
    fixtures = []
    try:
        df = pd.read_csv(io.BytesIO(get('https://www.football-data.co.uk/fixtures.csv')), encoding='utf-8-sig')
        london = ZoneInfo('Europe/London')
        for _, r in df.iterrows():
            if r.get('Div') not in DIVS or pd.isna(r.get('HomeTeam')):
                continue
            d = pd.to_datetime(r['Date'], dayfirst=True, errors='coerce')
            if pd.isna(d):
                continue
            hh, mm = (str(r.get('Time')) if not pd.isna(r.get('Time')) else '15:00').split(':')[:2]
            ko = dt.datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=london).astimezone(dt.timezone.utc)
            fixtures.append({'league': r['Div'], 'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': str(r.HomeTeam).strip(), 'a': str(r.AwayTeam).strip()})
    except Exception as e:
        warn(f'calendario de fútbol: {e}')
        fixtures = None
    if fixtures is not None and SP3_FIXTURES is not None:
        fixtures += SP3_FIXTURES
    return fixtures


# ============================== PRIMERA FEDERACIÓN (lapreferente.com, gratis) ==============================
# Calendario completo de cada grupo en una página. Los equipos que vienen de Segunda se enlazan con su histórico de
# football-data (p. ej. «Real Zaragoza» -> «Zaragoza»), así el modelo de España cubre las tres categorías juntas.
SP3_FIXTURES = None
# shortcut: desactivado, lapreferente.com bloquea a los servidores de GitHub (403); reactivar con {2026: (26708, 26709), 2025: (22269, 22270)} si cambia
SP3_COMPS = {}
DAYS_ES = {'L': 0, 'M': 1, 'X': 2, 'J': 3, 'V': 4, 'S': 5, 'D': 6}
def parse_lapreferente(page):
    """[(fecha jornada, hora 'L-HH:MM' o None, local, visitante, goles local o None, goles visitante o None)]."""
    import html as H
    toks = [t for t in (H.unescape(x).strip() for x in re.split(r'<[^>]+>', re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', page))) if t]
    head = re.compile(r'^JORNADA\s+(\d+)\s*-\s*(\d{1,2})/(\d{1,2})/(\d{4})$', re.I)
    score, when = re.compile(r'^(\d{1,2})\s*-\s*(\d{1,2})$'), re.compile(r'^([LMXJVSD])\s*-\s*(\d{1,2}:\d{2})$')
    team = lambda t: bool(re.search(r'[A-Za-zÀ-ÿ]{3}', t)) and not head.match(t) and not when.match(t) and len(t) <= 45
    out, jd, used = [], None, set()
    for i, t in enumerate(toks):
        if i in used:
            continue   # hora ya asignada al partido anterior
        m = head.match(t)
        if m:
            jd = dt.date(int(m.group(4)), int(m.group(3)), int(m.group(2))); continue
        if jd is None or i == 0 or i + 1 >= len(toks):
            continue
        sm, wm = score.match(t), when.match(t)
        if (sm or wm or t == '-') and team(toks[i - 1]) and team(toks[i + 1]):
            hg, ag = (int(sm.group(1)), int(sm.group(2))) if sm else (None, None)
            hm = None
            if wm:
                hm = wm.group(1) + '-' + wm.group(2)
            else:   # la hora puede ir en la celda siguiente
                nx = toks[i + 2] if i + 2 < len(toks) else ''
                if when.match(nx):
                    hm = nx.replace(' ', ''); used.add(i + 2)
            out.append((jd, hm, toks[i - 1], toks[i + 1], hg, ag))
    return out
SP3_SKIP = re.compile(r'(?i)\bB$|castilla|fabril|madrile|\bB\b')
def sp3_name(raw, known):
    """Nombre de lapreferente -> nombre de football-data si el equipo viene de Segunda o Primera (nunca para filiales)."""
    if SP3_SKIP.search(raw):
        return raw
    return pick_team(raw, known) or raw
def update_sp3(rows):
    """Resultados y próximos partidos de Primera Federación (cada 3 horas; la temporada anterior, una sola vez)."""
    if not SP3_COMPS:
        return []
    have_prev = any(r['div'] == 'SP3' and r['d'] < day(dt.date(season_start(), 7, 1)) for r in rows.values())
    if not daily_once('sp3Date', 3) and any(r['div'] == 'SP3' for r in rows.values()):   # fuera de tramo: calendario anterior
        return [f for f in (load('fixtures.json') or {}).get('football', []) if f['league'] == 'SP3' and f['kickoff'] > (NOW - dt.timedelta(hours=3)).isoformat()[:16]]
    import time
    known = {t for r in rows.values() if r['div'] in ('SP1', 'SP2') for t in (r['h'], r['a'])}
    cur = season_start(); fx, got = [], 0
    mad = ZoneInfo('Europe/Madrid')
    for y in sorted(SP3_COMPS):
        if y > cur or (y < cur and have_prev):
            continue
        for comp in SP3_COMPS[y]:
            try:
                games = parse_lapreferente(get(f'https://www.lapreferente.com/C{comp}-1/primera-federacion/calendario.html').decode('utf-8', 'replace'))
            except Exception as e:
                warn(f'Primera Federación {comp}: {e}'); continue
            finally:
                time.sleep(2)
            if len(games) < 100:   # una temporada tiene 380 partidos por grupo
                warn(f'Primera Federación {comp}: solo {len(games)} partidos leídos (¿ha cambiado la página?)'); continue
            for jd, hm, h, a, hg, ag in games:
                h, a = sp3_name(h, known), sp3_name(a, known)
                if hg is not None:
                    rows[(day(jd), h, a)] = {'div': 'SP3', 'd': day(jd), 'h': h, 'a': a, 'hg': hg, 'ag': ag}; got += 1
                elif y == cur:
                    d_, hh, mm, no_time = jd, 19, 0, True
                    if hm:   # «S-13:00»: sábado más cercano a la fecha de la jornada
                        wd, t = hm.split('-', 1); hh, mm = (int(x) for x in t.split(':')); no_time = False
                        d_ = min((jd + dt.timedelta(days=k) for k in range(-3, 4)), key=lambda x: (x.weekday() != DAYS_ES[wd], abs((x - jd).days)))
                    ko = dt.datetime(d_.year, d_.month, d_.day, hh, mm, tzinfo=mad).astimezone(dt.timezone.utc)
                    if ko > NOW - dt.timedelta(hours=3):
                        fx.append({'league': 'SP3', 'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': h, 'a': a, **({'noTime': True} if no_time else {})})
    print(f'Primera Federación (lapreferente.com): {got} resultados, {len(fx)} partidos próximos')
    return fx


def update_xg(rows):
    """xG por partido de Understat (5 grandes ligas) -> campos hxg/axg de los partidos de football-data."""
    cur = season_start(); got = 0
    byday = {}
    for r in rows.values():
        byday.setdefault((r['div'], r['d']), []).append(r)
    for div, us in UNDERSTAT.items():
        for y in (range(SINCE.year, cur + 1) if FULL else [cur]):
            try:
                raw = requests.get(f'https://understat.com/getLeagueData/{us}/{y}', timeout=60,
                                   headers={**UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': f'https://understat.com/league/{us}/{y}'})
                raw.raise_for_status(); dates = raw.json()['dates']
            except Exception as e:
                warn(f'xG {us} {y}: {e}'); continue
            for g in dates:
                if not g.get('isResult'):
                    continue
                try:
                    d = day(dt.date.fromisoformat(g['datetime'][:10])); xh, xa = float(g['xG']['h']), float(g['xG']['a'])
                except (KeyError, TypeError, ValueError):
                    continue
                cands = byday.get((div, d), []) + byday.get((div, d - 1), []) + byday.get((div, d + 1), [])
                if not cands:
                    continue
                sim = lambda c: difflib.SequenceMatcher(None, ALIAS.get(g['h']['title'], g['h']['title']), c['h']).ratio() + difflib.SequenceMatcher(None, ALIAS.get(g['a']['title'], g['a']['title']), c['a']).ratio()
                best = max(cands, key=sim)
                if sim(best) >= 1.0:   # ambos nombres razonablemente parecidos
                    best['hxg'], best['axg'] = round(xh, 2), round(xa, 2); got += 1
    print(f'xG: {got} partidos con xG')
    return got


# ============================== COMPETICIONES EUROPEAS (ClubElo) ==============================
def update_clubelo():
    """Ratings de ClubElo y partidos próximos entre clubes de distintos países (Champions, Europa League, Conference)."""
    try:
        try:
            ratings = pd.read_csv(io.BytesIO(get(f'http://api.clubelo.com/{TODAY.isoformat()}')))
        except requests.HTTPError:   # el corte del día a veces aún no está publicado: se usa el de ayer
            ratings = pd.read_csv(io.BytesIO(get(f'http://api.clubelo.com/{(TODAY - dt.timedelta(days=1)).isoformat()}')))
        fx = pd.read_csv(io.BytesIO(get('http://api.clubelo.com/Fixtures')))
    except Exception as e:
        warn(f'ClubElo: {e}'); return None
    ratings = ratings.dropna(subset=['Club', 'Elo'])
    country = dict(zip(ratings.Club, ratings.Country)); elo = dict(zip(ratings.Club, ratings.Elo))
    save('clubelo.json', {'date': TODAY.isoformat(), 'clubs': [[c, country[c], round(float(elo[c]), 1)] for c in ratings.Club]})
    out = []
    for _, r in fx.iterrows():
        h, a = r.get('Home'), r.get('Away')
        if h not in elo or a not in elo or country.get(h) == country.get(a):
            continue   # mismo país: liga o copa nacional
        d = pd.to_datetime(r.get('Date'), errors='coerce')
        if pd.isna(d):
            continue
        ko = dt.datetime(d.year, d.month, d.day, 19, 0, tzinfo=dt.timezone.utc)   # ClubElo no da la hora
        out.append({'league': 'UEFA', 'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'noTime': True, 'h': h, 'a': a, 'eh': float(elo[h]), 'ea': float(elo[a])})
    print(f'ClubElo: {len(ratings)} clubes, {len(out)} partidos europeos próximos')
    return out


# ============================== API-SPORTS (opcional: bajas, árbitros, baloncesto europeo) ==============================
import os
API_CALLS = {'n': 0}
def api_key():
    return os.environ.get('API_SPORTS_KEY') or os.environ.get('API_FOOTBALL_KEY')
def api(host, path, **params):
    """Petición a API-Sports. Máximo 90 al día por ejecución diaria (el plan gratuito da 100 por API)."""
    if API_CALLS['n'] >= 90:
        raise RuntimeError('límite diario de peticiones alcanzado')
    API_CALLS['n'] += 1
    r = requests.get(f'https://{host}/{path}', params=params, headers={'x-apisports-key': api_key()}, timeout=60)
    r.raise_for_status(); js = r.json()
    if js.get('errors'):
        raise RuntimeError(js['errors'])
    return js.get('response', [])
def daily_once(key, hours=24):
    """True la primera vez del día (o de cada tramo de `hours` horas) para esa tarea (se apunta en data/state.json)."""
    p = ROOT / 'data' / 'state.json'
    st = json.loads(p.read_text()) if p.exists() else {}
    slot = TODAY.isoformat() + (f'-{NOW.hour // hours}' if hours < 24 else '')
    if st.get(key) == slot:
        return False
    st[key] = slot; p.parent.mkdir(exist_ok=True); p.write_text(json.dumps(st))
    return True


def update_referees(fixtures, rows):
    """Árbitro de cada partido (jugados y próximos) desde API-Football: 1 petición por liga con partidos próximos."""
    if not api_key() or not daily_once('refDate'):
        return
    season, got, nxt = season_start(), 0, 0
    for div, lid in APIF_LEAGUES.items():
        fx = [f for f in fixtures if f['league'] == div]
        if not fx:
            continue
        try:
            games = api('v3.football.api-sports.io', 'fixtures', league=lid, season=season)
        except Exception as e:
            warn(f'árbitros {div}: {e}')
            if 'límite' in str(e) or 'plan' in str(e).lower():
                break
            continue
        known = {r['h'] for r in rows.values() if r['div'] == div} | {r['a'] for r in rows.values() if r['div'] == div}
        name = matcher(known)
        byday = {}
        for r in rows.values():
            if r['div'] == div:
                byday.setdefault(r['d'], []).append(r)
        for g in games:
            ref = ref_name(g['fixture'].get('referee'))
            if not ref:
                continue
            d = day(dt.date.fromisoformat(g['fixture']['date'][:10])); h, a = name(g['teams']['home']['name']), name(g['teams']['away']['name'])
            for r in byday.get(d, []) + byday.get(d - 1, []) + byday.get(d + 1, []):
                if r['h'] == h and r['a'] == a and not r.get('ref'):
                    r['ref'] = ref; got += 1
            for f in fx:
                if f['h'] == h and f['a'] == a and abs(day(dt.date.fromisoformat(f['kickoff'][:10])) - d) <= 1:
                    f['ref'] = ref; nxt += 1
    if got:
        save('football.json', fb_to_json([r for r in rows.values() if r['d'] >= day(SINCE)]))
    print(f'árbitros: {got} partidos jugados y {nxt} próximos con árbitro')


# ============================== BAJAS (API-Football, opcional) ==============================
def update_injuries(fixtures, rows):
    """Una vez al día: lesionados y sancionados de cada liga, y su peso según goles y asistencias.
    Requiere API_FOOTBALL_KEY (clave gratuita). Sin clave no hace nada."""
    if not api_key() or not daily_once('injuriesDate'):
        return
    season, out = season_start(), {}
    soon = {(f['league'], f['h']) for f in fixtures} | {(f['league'], f['a']) for f in fixtures}
    cutoff = (TODAY + dt.timedelta(days=8)).isoformat()
    for div, lid in APIF_LEAGUES.items():
        teams_soon = {t for (l, t) in soon if l == div}
        if not teams_soon:
            continue
        try:
            inj = [x for x in api('v3.football.api-sports.io', 'injuries', league=lid, season=season) if TODAY.isoformat() <= x['fixture']['date'][:10] <= cutoff]
            if not inj:
                continue
            stars = {}
            for path in ('players/topscorers', 'players/topassists'):
                for p in api('v3.football.api-sports.io', path, league=lid, season=season):
                    st = p['statistics'][0]
                    stars[p['player']['id']] = {'g': st['goals']['total'] or 0, 'a': st['goals']['assists'] or 0}
        except Exception as e:
            warn(f'bajas {div}: {e}')
            if 'límite' in str(e) or 'plan' in str(e).lower():
                break
            continue
        name = matcher(teams_soon)
        season_rows = [r for r in rows.values() if r['div'] == div and r['d'] >= day(dt.date(season, 7, 1))]
        for x in inj:
            team = name(x['team']['name'])
            if team not in teams_soon:
                continue
            tg = max(5, sum(r['hg'] for r in season_rows if r['h'] == team) + sum(r['ag'] for r in season_rows if r['a'] == team))
            s_ = stars.get(x['player']['id'], {'g': 0, 'a': 0})
            share = (s_['g'] + 0.5 * s_['a']) / tg * (0.5 if x['player'].get('type') == 'Questionable' else 1)
            e = out.setdefault(f'{div}|{team}', {'players': [], 'share': 0.0})
            if any(p['name'] == x['player']['name'] for p in e['players']):
                continue
            e['players'].append({'name': x['player']['name'], 'reason': x['player'].get('reason') or '', 'type': x['player'].get('type') or '', 'share': round(share, 3)})
            e['share'] += share
    for e in out.values():
        # shortcut: heurístico sin validar (no hay histórico de bajas gratis); la mitad del peso goleador ausente, como mucho -25%
        e['att'] = round(max(0.75, 1 - 0.5 * e['share']), 3)
    if out:   # solo si hay algo: no borrar las bajas que vienen de otras fuentes
        prev = load('injuries.json') or {'teams': {}}
        save('injuries.json', {'updated': NOW.isoformat().replace('+00:00', 'Z'), 'teams': {**prev.get('teams', {}), **out}})
    print(f'bajas: {sum(len(e["players"]) for e in out.values())} jugadores en {len(out)} equipos')



# ============================== BAJAS DE LA PREMIER (Fantasy oficial, gratis y sin clave) ==============================
FPL_NAMES = {'Spurs': 'Tottenham', 'Man Utd': 'Man United', "Nott'm Forest": "Nott'm Forest", 'Wolves': 'Wolves', 'Newcastle': 'Newcastle'}
FPL_TYPE = {'i': 'Lesionado', 's': 'Sancionado', 'u': 'No disponible'}
def update_fpl(fixtures, rows):
    """Cada hora: lesionados, sancionados y dudas de la Premier según el Fantasy oficial (fantasy.premierleague.com).
    El peso de cada baja es su parte de los goles del equipo (goles + media asistencia); una duda pesa (1 - probabilidad de jugar)."""
    season = season_start()
    soon = {f['h'] for f in fixtures if f['league'] == 'E0'} | {f['a'] for f in fixtures if f['league'] == 'E0'}
    soon |= {t for r in rows.values() if r['div'] == 'E0' and r['d'] >= day(dt.date(season, 7, 1)) for t in (r['h'], r['a'])}
    js = json.loads(get('https://fantasy.premierleague.com/api/bootstrap-static/'))
    name = matcher(soon)
    team_of = {t['id']: name(FPL_NAMES.get(t['name'], t['name'])) for t in js['teams']}
    season_rows = [r for r in rows.values() if r['div'] == 'E0' and r['d'] >= day(dt.date(season, 7, 1))]
    goals = lambda t: max(5, sum(r['hg'] for r in season_rows if r['h'] == t) + sum(r['ag'] for r in season_rows if r['a'] == t))
    out = {}
    for p in js['elements']:
        team, st = team_of.get(p['team']), p.get('status')
        if team not in soon or st in ('a', 'n') or (p.get('minutes') or 0) < 90:
            continue   # disponible, cedido o sin minutos esta temporada
        chance = p.get('chance_of_playing_next_round')
        w = 1.0 if st != 'd' else 1 - (chance if chance is not None else 50) / 100
        share = (p.get('goals_scored', 0) + 0.5 * p.get('assists', 0)) / goals(team) * w
        e = out.setdefault(f'E0|{team}', {'players': [], 'share': 0.0})
        e['players'].append({'name': p['web_name'], 'reason': p.get('news') or '', 'type': FPL_TYPE.get(st, f'Duda ({chance if chance is not None else "?"}%)'), 'share': round(share, 3)})
        e['share'] += share
    for e in out.values():
        e['att'] = round(max(0.75, 1 - 0.5 * e['share']), 3)   # mismo ajuste que el resto de bajas
    prev = load('injuries.json') or {'teams': {}}
    teams = {k: v for k, v in prev.get('teams', {}).items() if not k.startswith('E0|')}
    save('injuries.json', {'updated': NOW.isoformat().replace('+00:00', 'Z'), 'teams': {**teams, **out}})
    print(f'bajas Premier (Fantasy oficial): {sum(len(e["players"]) for e in out.values())} jugadores en {len(out)} equipos')


# ============================== BAJAS DEL RESTO DE LIGAS (sportsgambler.com, gratis y sin clave) ==============================
SG_LEAGUES = {'SP1': 'spain-la-liga', 'SP2': 'spain-la-liga-2', 'E1': 'england-championship', 'I1': 'italy-serie-a', 'I2': 'italy-serie-b',
              'D1': 'germany-bundesliga', 'D2': 'germany-2-bundesliga', 'F1': 'france-ligue-1', 'N1': 'netherlands-eredivisie',
              'P1': 'portugal-primeira-liga', 'SC0': 'scottish-premiership', 'B1': 'belgium-first-division-a', 'T1': 'turkey-super-lig', 'G1': 'greece-super-league-1'}
SUSP_WORDS = ('card', 'suspen', 'red ', 'yellow')
def parse_sportsgambler(page):
    """[(equipo, jugador, info, partidos, goles, asistencias, vuelta 'AAAA-MM-DD' o None)] del HTML de una liga.
    Cada equipo empieza con un <h3>; cada fila: nombre, posición (G/D/M/F), partidos, goles, asistencias, motivo, vuelta."""
    import html as H
    num = lambda x: 0 if x == '-' else int(x)
    out = []
    for chunk in re.split(r'(?i)<h3\b[^>]*>', re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', page))[1:]:
        toks = [t for t in (H.unescape(x).strip() for x in re.split(r'<[^>]+>', chunk)) if t]
        if not toks:
            continue
        team, i = toks[0], 1
        while i + 6 < len(toks):
            t = toks[i:i + 7]
            if t[1] in ('G', 'D', 'M', 'F') and all(re.match(r'^(\d+|-)$', x) for x in t[2:5]) and re.match(r'^(\d{4}-\d{2}-\d{2}|-)$', t[6]):
                out.append((team, t[0], t[5], num(t[2]), num(t[3]), num(t[4]), None if t[6] == '-' else t[6])); i += 7
            else:
                i += 1
    return out
SG_ALIAS = {'Deportivo': 'La Coruna', 'Racing Club': 'Santander', 'Espanyol': 'Espanol', "B. M'gladbach": "M'gladbach", 'Hamburger SV': 'Hamburg',
            'Frankfurt': 'Ein Frankfurt', 'AC Milan': 'Milan', 'Inter Milan': 'Inter', 'Atletico Madrid': 'Ath Madrid', 'Athletic Club': 'Ath Bilbao',
            'Celta Vigo': 'Celta', 'Real Betis': 'Betis', 'Real Sociedad': 'Sociedad', 'Rayo Vallecano': 'Vallecano', 'Mainz 05': 'Mainz'}
def pick_team(raw, known):
    """Nombre de otra web -> nombre del histórico: alias, igualdad sin acentos, contenido único o parecido alto (si no, None)."""
    import unicodedata
    asc = unicodedata.normalize('NFD', raw).encode('ascii', 'ignore').decode()
    for x in (raw, asc):
        for al in (SG_ALIAS.get(x), ALIAS.get(x), x):
            if al in known:
                return al
    rk, keys = team_key(asc), {team_key(k): k for k in known}
    if rk in keys:
        return keys[rk]
    inside = [k for kk, k in keys.items() if kk and (kk in rk or rk in kk)]
    if len(inside) == 1:
        return inside[0]
    m = difflib.get_close_matches(rk, list(keys), n=1, cutoff=0.8)
    return keys[m[0]] if m else None
def update_sportsgambler(fixtures, rows):
    """Cada 3 horas: lesionados y sancionados de 14 ligas. Peso de cada baja = su parte de los goles del equipo (goles + media asistencia)."""
    if not daily_once('sgDate', 3):
        return
    import time
    season = season_start()
    prev = load('injuries.json') or {'teams': {}}
    teams_out = {k: v for k, v in prev.get('teams', {}).items() if k.split('|')[0] not in SG_LEAGUES}
    n_ok, n_players = 0, 0
    for div, slug in SG_LEAGUES.items():
        known = {t for r in rows.values() if r['div'] == div and r['d'] >= day(dt.date(season, 7, 1)) for t in (r['h'], r['a'])}
        if not known:
            continue
        try:
            page = get(f'https://www.sportsgambler.com/injuries/football/{slug}/').decode('utf-8', 'replace')
            items = parse_sportsgambler(page)
        except Exception as e:
            warn(f'bajas {div}: {e}'); continue
        finally:
            time.sleep(2)   # ritmo moderado con la web
        if not items and 'No players are currently reported' in page:
            n_ok += 1; continue   # la web no tiene bajas de esta liga ahora mismo (p. ej., Grecia)
        if not items:
            warn(f'bajas {div}: no se ha podido leer la página (¿ha cambiado?)'); continue
        n_ok += 1
        name = lambda x, known=known: pick_team(x, known)
        season_rows = [r for r in rows.values() if r['div'] == div and r['d'] >= day(dt.date(season, 7, 1))]
        goals = lambda t: max(5, sum(r['hg'] for r in season_rows if r['h'] == t) + sum(r['ag'] for r in season_rows if r['a'] == t))
        for team_raw, player, info, apps, g, a, back in items:
            team = name(team_raw)
            if not team or (back and back <= TODAY.isoformat()):
                continue   # equipo no reconocido o ya recuperado
            e = teams_out.setdefault(f'{div}|{team}', {'players': [], 'share': 0.0})
            if any(p['name'] == player for p in e['players']):
                continue
            share = (g + 0.5 * a) / goals(team)
            susp = any(w in info.lower() for w in SUSP_WORDS)
            e['players'].append({'name': player, 'reason': info + (f' · vuelta prevista {back}' if back else ''), 'type': 'Sancionado' if susp else 'Lesionado', 'share': round(share, 3), 'apps': apps})
            e['share'] += share; n_players += 1
    for k, e in teams_out.items():
        if k.split('|')[0] in SG_LEAGUES:
            e['att'] = round(max(0.75, 1 - 0.5 * e['share']), 3)
    if n_ok:
        save('injuries.json', {'updated': NOW.isoformat().replace('+00:00', 'Z'), 'teams': teams_out})
    print(f'bajas (sportsgambler.com): {n_players} jugadores en {n_ok} ligas')


# ============================== FOOTBALL-DATA.ORG (opcional: árbitros y Champions) ==============================
# Plan gratuito con clave (10 peticiones/minuto): árbitro de cada partido en 8 ligas y resultados/horarios de la Champions.
FDORG = {'PD': 'SP1', 'PL': 'E0', 'ELC': 'E1', 'SA': 'I1', 'BL1': 'D1', 'FL1': 'F1', 'DED': 'N1', 'PPL': 'P1', 'CL': 'UEFA'}
_STRIP = re.compile(r'\b(fc|cf|sc|ac|as|ss|ssc|sd|ud|rc|rcd|cd|ca|afc|vfl|vfb|sv|tsg|1\.|fsv|bv|ogc|osc|ls|sl|club|de|calcio|futbol|football)\b|[.\']', re.I)
def team_key(n):
    import unicodedata
    n = unicodedata.normalize('NFD', str(n)).encode('ascii', 'ignore').decode().lower()
    return ' '.join(_STRIP.sub(' ', n).split())
def best_pair(cands, hs, as_):
    """Partido de cands ({'h','a'}) que mejor casa con alguno de los nombres hs/as_ (variantes de otra fuente)."""
    sim = lambda x, ys: max(difflib.SequenceMatcher(None, team_key(ALIAS.get(y, y)), team_key(x)).ratio() for y in ys if y)
    best = max(cands, key=lambda c: sim(c['h'], hs) + sim(c['a'], as_), default=None)
    return best if best and sim(best['h'], hs) + sim(best['a'], as_) >= 1.3 else None

def update_fdorg(rows, fixtures):
    """Árbitros (8 ligas) y Champions desde football-data.org. Requiere FOOTBALL_DATA_ORG_KEY.
    Cada 3 horas: los árbitros se designan pocos días (a veces horas) antes del partido."""
    key = os.environ.get('FOOTBALL_DATA_ORG_KEY')
    if not key or not daily_once('fdorgDate', 3):
        return
    import time
    season, refs, nxt = season_start(), 0, 0
    byday = {}
    for r in rows.values():
        byday.setdefault((r['div'], r['d']), []).append(r)
    clubs = load('clubelo.json') or {'clubs': []}
    top = [(team_key(c[0]), c[0]) for c in clubs['clubs'] if c[2] >= 1550]   # clubes con nivel de Champions
    elo_of = {c[0]: c[2] for c in clubs['clubs']}
    horizon = NOW + dt.timedelta(days=FIXTURE_DAYS)
    uefa = load('uefa.json') or {'results': []}
    res = {(x['d'], x['h'], x['a']): x for x in uefa['results']}
    for i, (code, div) in enumerate(FDORG.items()):
        if i:
            time.sleep(6.5)   # 10 peticiones por minuto
        try:
            r = requests.get(f'https://api.football-data.org/v4/competitions/{code}/matches', params={'season': season}, headers={'X-Auth-Token': key}, timeout=60)
            r.raise_for_status(); games = r.json().get('matches', [])
        except Exception as e:
            warn(f'football-data.org {code}: {e}'); continue
        for g in games:
            ko = dt.datetime.fromisoformat(g['utcDate'].replace('Z', '+00:00')); d = day(ko.date())
            hs = [g['homeTeam'].get('shortName'), g['homeTeam'].get('name')]; as_ = [g['awayTeam'].get('shortName'), g['awayTeam'].get('name')]
            ref = next((ref_name(x['name']) for x in g.get('referees') or [] if x.get('type') == 'REFEREE'), None)
            if div == 'UEFA':   # nombres de ClubElo para casar con los pronósticos europeos
                score = lambda t, vs: max(difflib.SequenceMatcher(None, t[0], team_key(v)).ratio() for v in vs if v)
                bh, ba = max(top, key=lambda t: score(t, hs), default=None), max(top, key=lambda t: score(t, as_), default=None)
                h, a = bh and bh[1], ba and ba[1]
                ft = (g.get('score') or {}).get('fullTime') or {}
                if g['status'] == 'FINISHED' and ft.get('home') is not None:
                    res[(d, h, a)] = {'d': d, 'h': h, 'a': a, 'hg': ft['home'], 'ag': ft['away'], 'ref': ref}
                elif g['status'] in ('SCHEDULED', 'TIMED') and NOW < ko <= horizon:
                    hit = False
                    for f in fixtures.get('uefa', []):
                        if {f['h'], f['a']} == {h, a} and abs(day(dt.date.fromisoformat(f['kickoff'][:10])) - d) <= 1:
                            f['kickoff'] = g['utcDate'].replace('+00:00', 'Z'); f['noTime'] = False; f['competition'] = 'Champions League'; hit = True
                            if ref: f['ref'] = ref
                    # sin calendario de ClubElo (caído): se crea el partido con el último Elo guardado, si los nombres casan con claridad
                    if not hit and bh and ba and score(bh, hs) >= 0.75 and score(ba, as_) >= 0.75:
                        fixtures.setdefault('uefa', []).append({'league': 'UEFA', 'kickoff': g['utcDate'].replace('+00:00', 'Z'), 'noTime': False, 'competition': 'Champions League',
                                                                'h': h, 'a': a, 'eh': float(elo_of[h]), 'ea': float(elo_of[a]), **({'ref': ref} if ref else {})})
                continue
            if not ref:
                continue
            m = best_pair(byday.get((div, d), []) + byday.get((div, d - 1), []) + byday.get((div, d + 1), []), hs, as_)
            if m is not None and not m.get('ref'):
                m['ref'] = ref; refs += 1
            for f in fixtures.get('football', []):
                if f['league'] == div and abs(day(dt.date.fromisoformat(f['kickoff'][:10])) - d) <= 1 and best_pair([f], hs, as_):
                    f['ref'] = ref; nxt += 1
    save('uefa.json', {'results': sorted(res.values(), key=lambda x: x['d'])[-600:]})
    if refs:
        save('football.json', fb_to_json([r for r in rows.values() if r['d'] >= day(SINCE)]))
    print(f'football-data.org: {refs} árbitros nuevos en partidos jugados, {nxt} en próximos, {len(res)} resultados de Champions')


# ============================== ESCUDOS (lista pública de equipos de ESPN, una vez al día) ==============================
ESPN_SLUGS = {'SP1': 'esp.1', 'SP2': 'esp.2', 'E0': 'eng.1', 'E1': 'eng.2', 'I1': 'ita.1', 'I2': 'ita.2', 'D1': 'ger.1', 'D2': 'ger.2',
              'F1': 'fra.1', 'F2': 'fra.2', 'N1': 'ned.1', 'P1': 'por.1', 'SC0': 'sco.1', 'SC1': 'sco.2', 'B1': 'bel.1', 'T1': 'tur.1', 'G1': 'gre.1',
              'UEFA': 'uefa.champions'}
def update_crests(rows, fixtures):
    """crests.json: {equipo: url del escudo}. Fútbol (17 ligas y Champions) y NBA. Sin escudo, la app pone las iniciales."""
    out, n = load('crests.json') or {}, 0
    for k in [k for k, v in out.items() if not k.startswith('b:') and '/nba/' in str(v)]:   # escudos NBA guardados sin prefijo
        out['b:' + k] = out.pop(k)
    before = -1 if any(k.startswith('b:') for k in out) else len(out)   # fuerza a guardar si se ha migrado
    for k, v in EXTRA_CRESTS.items():   # sin peticiones extra: en cada ejecución
        out.setdefault(k, v)
    if not daily_once('crestsDate'):
        if len(out) != before:
            save('crests.json', out); print(f'escudos: {len(out)} equipos')
        return
    season = day(dt.date(season_start(), 7, 1))
    uefa = {f[k] for f in fixtures.get('uefa', []) for k in ('h', 'a')}
    for div, slug in ESPN_SLUGS.items():
        known = uefa if div == 'UEFA' else {t for r in rows.values() if r['div'] == div and r['d'] >= season - 365 for t in (r['h'], r['a'])}
        if not known:
            continue
        try:
            js = json.loads(get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams'))
        except Exception as e:
            warn(f'escudos {div}: {e}'); continue
        for t in js['sports'][0]['leagues'][0]['teams']:
            tm = t['team']; logo = (tm.get('logos') or [{}])[0].get('href')
            name = pick_team(tm.get('displayName', ''), known) or pick_team(tm.get('shortDisplayName', ''), known)
            if name and logo and name not in out:
                out[name] = logo; n += 1
    try:
        js = json.loads(get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'))
        for t in js['sports'][0]['leagues'][0]['teams']:
            tm = t['team']; logo = (tm.get('logos') or [{}])[0].get('href')
            if logo:
                out.pop(tm['displayName'], None)   # versiones antiguas guardaban la NBA sin prefijo
                out['b:' + tm['displayName'].replace('Los Angeles Clippers', 'LA Clippers')] = logo
    except Exception as e:
        warn(f'escudos NBA: {e}')
    # todos los clubes de la Euroliga/EuroCup (incluye equipos ACB que han jugado en Europa, con su escudo)
    off = 0
    while off < 2000:
        try:
            js = json.loads(get(f'https://api-live.euroleague.net/v2/clubs?limit=200&offset={off}'))
        except Exception as e:
            warn(f'escudos Euroliga: {e}'); break
        data = js.get('data') or []
        for c in data:
            cr = (c.get('images') or {}).get('crest')
            if cr and not str(c.get('name', '')).upper().startswith(('U18', 'U16')):
                out.setdefault('b:' + c['name'], cr)
        if len(data) < 200:
            break
        off += 200
    save('crests.json', out)
    print(f'escudos: {len(out)} equipos ({n} nuevos)')


# ============================== NOTICIAS (Google Noticias por RSS, sin clave) ==============================
# Titulares de las últimas 48 h de cada equipo que juega pronto, filtrados por bajas, sanciones, dudas y rotaciones.
# Solo se guardan titular, medio, fecha y enlace. No ajustan el pronóstico: no hay forma gratuita de validarlo.
NEWS_LANG = {'ES': ('es', 'ES', 'es'), 'EN': ('en-GB', 'GB', 'en'), 'SC': ('en-GB', 'GB', 'en'), 'IT': ('it', 'IT', 'it'), 'DE': ('de', 'DE', 'de'),
             'FR': ('fr', 'FR', 'fr'), 'PT': ('pt-PT', 'PT', 'pt'), 'NL': ('nl', 'NL', 'nl'), 'BE': ('fr', 'BE', 'fr'), 'TR': ('tr', 'TR', 'tr'), 'GR': ('en-GB', 'GB', 'en')}
NEWS_KW = {'es': ['lesión', 'lesionado', 'baja', 'sancionado', 'sanción', 'duda', 'rotaciones', 'once', 'convocatoria', 'destituido', 'nuevo entrenador'],
           'en': ['injury', 'injured', 'ruled out', 'suspended', 'suspension', 'doubt', 'team news', 'lineup', 'sacked'],
           'it': ['infortunio', 'infortunato', 'squalificato', 'assente', 'dubbio', 'formazione', 'esonerato'],
           'de': ['verletzt', 'verletzung', 'gesperrt', 'fällt aus', 'fraglich', 'aufstellung', 'entlassen'],
           'fr': ['blessure', 'blessé', 'suspendu', 'forfait', 'incertain', 'composition', 'limogé'],
           'pt': ['lesão', 'lesionado', 'castigado', 'suspenso', 'dúvida', 'convocados', 'despedido'],
           'nl': ['blessure', 'geblesseerd', 'geschorst', 'twijfelgeval', 'opstelling', 'ontslagen'],
           'tr': ['sakatlık', 'sakat', 'cezalı', 'kadro', 'kovuldu']}
NEWS_TAGS = [('Bajas', ['lesi', 'injur', 'ruled out', 'infortun', 'verletz', 'bless', 'lesão', 'geblesseerd', 'sakat', 'baja', 'assente', 'fällt aus', 'forfait']),
             ('Sanción', ['sanci', 'suspen', 'squalific', 'gesperrt', 'castig', 'geschorst', 'cezal']),
             ('Duda', ['duda', 'doubt', 'dubbio', 'fraglich', 'incertain', 'dúvida', 'twijfel']),
             ('Alineación', ['rotacion', 'once', 'lineup', 'team news', 'formazione', 'aufstellung', 'composition', 'convoca', 'opstelling', 'kadro']),
             ('Entrenador', ['destitu', 'entrenador', 'sacked', 'esonera', 'entlassen', 'limog', 'despedido', 'ontslagen', 'kovuldu'])]
SEARCH_NAMES = {'Ath Madrid': 'Atlético de Madrid', 'Ath Bilbao': 'Athletic Club', 'Sociedad': 'Real Sociedad', 'Vallecano': 'Rayo Vallecano',
                'Espanol': 'Espanyol', 'Celta': 'Celta de Vigo', 'Betis': 'Real Betis', 'Man United': 'Manchester United', 'Man City': 'Manchester City',
                "Nott'm Forest": 'Nottingham Forest', 'Ein Frankfurt': 'Eintracht Frankfurt', "M'gladbach": 'Borussia Mönchengladbach',
                'Paris SG': 'Paris Saint-Germain', 'Inter': 'Inter Milan', 'Milan': 'AC Milan', 'Bayern Munich': 'Bayern Munich'}
def update_news(fixtures):
    if not daily_once('newsDate', 3):   # cada 3 horas: las bajas y alineaciones se publican a lo largo del día
        return
    import xml.etree.ElementTree as ET, urllib.parse, email.utils, time
    soon = NOW + dt.timedelta(hours=48)
    teams = {}
    country_of = lambda div: next((c for c, ds in {'ES': ['SP1', 'SP2', 'SP3'], 'EN': ['E0', 'E1'], 'IT': ['I1', 'I2'], 'DE': ['D1', 'D2'], 'FR': ['F1', 'F2'],
                                                  'NL': ['N1'], 'PT': ['P1'], 'SC': ['SC0', 'SC1'], 'BE': ['B1'], 'TR': ['T1'], 'GR': ['G1']}.items() if div in ds), 'EN')
    for f in fixtures.get('football', []):
        if dt.datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00')) <= soon:
            for t in (f['h'], f['a']):
                teams[f"{f['league']}|{t}"] = (t, country_of(f['league']))
    out, n = {}, 0
    for key, (t, c) in list(teams.items())[:80]:
        hl, gl, lang = NEWS_LANG.get(c, ('en-GB', 'GB', 'en'))
        kw = ' OR '.join(f'"{k}"' if ' ' in k else k for k in NEWS_KW[lang][:6])
        q = f'"{SEARCH_NAMES.get(t, t)}" ({kw}) when:2d'
        url = f'https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl={hl}&gl={gl}&ceid={gl}:{lang}'
        try:
            root = ET.fromstring(get(url)); n += 1
        except Exception as e:
            warn(f'noticias {t}: {e}'); continue
        items = []
        for it in root.iter('item'):
            title = (it.findtext('title') or '').strip(); low = title.lower()
            tags = [tag for tag, keys in NEWS_TAGS if any(k in low for k in keys)]
            if not tags or SEARCH_NAMES.get(t, t).split()[0].lower() not in low and t.split()[0].lower() not in low:
                continue   # el titular debe nombrar al equipo y tratar de algo relevante
            try:
                when = email.utils.parsedate_to_datetime(it.findtext('pubDate')).astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
            except Exception:
                when = None
            items.append({'title': title[:180], 'link': it.findtext('link'), 'source': it.findtext('source') or '', 'date': when, 'tags': tags})
        if items:
            out[key] = items[:6]
        time.sleep(1)   # ritmo moderado
    save('news.json', {'updated': NOW.isoformat().replace('+00:00', 'Z'), 'teams': out})
    print(f'noticias: {sum(len(v) for v in out.values())} titulares relevantes de {len(out)} equipos ({n} búsquedas)')

# ============================== REDES: Bluesky y canales públicos de Telegram (gratis, opcional) ==============================
# config.json -> "fuentes": {"bluesky": ["periodista.bsky.social", ...], "telegram": ["canal_publico", ...]}
# Solo información publicada: X/Twitter e Instagram no se usan (API de pago y prohíben leerlas automáticamente).
def social_posts(cfg):
    import html as H
    out = []
    for h in cfg.get('bluesky', [])[:30]:
        try:
            js = json.loads(get(f'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor={h}&limit=50&filter=posts_no_replies'))
            for it in js.get('feed', []):
                p = it['post']; out.append({'text': p['record'].get('text', ''), 'date': p['record'].get('createdAt'),
                                            'link': f"https://bsky.app/profile/{h}/post/{p['uri'].split('/')[-1]}", 'source': f'Bluesky @{h}'})
        except Exception as e:
            warn(f'Bluesky {h}: {e}')
    for c in cfg.get('telegram', [])[:30]:
        try:
            page = get(f'https://t.me/s/{c}').decode('utf-8', 'replace')
            for blk in re.split(r'class="tgme_widget_message_wrap', page)[1:]:
                tm = re.search(r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', blk, re.S)
                dm = re.search(r'<time[^>]*datetime="([^"]+)"', blk); lm = re.search(r'data-post="([^"]+)"', blk)
                if tm and dm:
                    out.append({'text': ' '.join(H.unescape(re.sub(r'<[^>]+>', ' ', tm.group(1))).split()), 'date': dm.group(1),
                                'link': f'https://t.me/{lm.group(1)}' if lm else f'https://t.me/s/{c}', 'source': f'Telegram @{c}'})
        except Exception as e:
            warn(f'Telegram {c}: {e}')
    return out
def update_social(fixtures):
    cfg = (json.loads((ROOT / 'config.json').read_text()) if (ROOT / 'config.json').exists() else {}).get('fuentes', {})
    if not (cfg.get('bluesky') or cfg.get('telegram')) or not daily_once('socialDate', 3):
        return
    soon = NOW + dt.timedelta(hours=48); teams = {}
    for f in fixtures.get('football', []):
        if dt.datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00')) <= soon:
            for t in (f['h'], f['a']):
                teams[f"{f['league']}|{t}"] = t
    news = load('news.json') or {'teams': {}}; added = 0
    for p in social_posts(cfg):
        try:
            when = dt.datetime.fromisoformat(p['date'].replace('Z', '+00:00'))
        except Exception:
            continue
        if NOW - when > dt.timedelta(hours=48):
            continue
        low = p['text'].lower(); tags = [tag for tag, keys in NEWS_TAGS if any(k in low for k in keys)]
        if not tags:
            continue
        for key, t in teams.items():
            if SEARCH_NAMES.get(t, t).split()[0].lower() in low or t.lower() in low:
                items = news['teams'].setdefault(key, [])
                if not any(i.get('link') == p['link'] for i in items):
                    items.insert(0, {'title': p['text'][:180], 'link': p['link'], 'source': p['source'], 'date': when.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z'), 'tags': tags}); added += 1
    save('news.json', {**news, 'updated': NOW.isoformat().replace('+00:00', 'Z')})
    print(f'redes (Bluesky/Telegram): {added} publicaciones relevantes')


# ============================== BALONCESTO ==============================
def bk_rows_from_json(B):
    if not B:
        return []
    return [{'d': d, 'h': B['teams'][B['h'][k]], 'a': B['teams'][B['a'][k]], 'hp': B['hp'][k], 'ap': B['ap'][k],
             'ou': B['ou'][k] if 'ou' in B else None} for k, d in enumerate(B['date'])]


def bk_to_json(rows):
    rows = sorted(rows, key=lambda r: (r['d'], r['h']))
    teams = sorted({r['h'] for r in rows} | {r['a'] for r in rows})
    ix = {t: i for i, t in enumerate(teams)}
    return {'teams': teams, 'date': [r['d'] for r in rows], 'h': [ix[r['h']] for r in rows], 'a': [ix[r['a']] for r in rows],
            'hp': [r['hp'] for r in rows], 'ap': [r['ap'] for r in rows], 'ou': [r.get('ou') for r in rows]}


def matcher(known):
    """Asocia nombres de otra fuente a los del histórico (p. ej. 'Los Angeles Clippers' -> 'LA Clippers')."""
    known = list(known)
    def f(name):
        if not known or name in known:
            return name
        if ALIAS.get(name) in known:
            return ALIAS[name]
        last = name.split()[-1]   # el apodo identifica mejor que la ciudad ('Los Angeles Clippers' -> 'LA Clippers')
        same = [k for k in known if k.split()[-1] == last]
        if len(same) == 1:
            return same[0]
        m = difflib.get_close_matches(name, known, n=1, cutoff=0.85)
        return m[0] if m else name
    return f


def update_nba():
    """Resultados y calendario de la temporada actual desde fixturedownload.com (sin clave)."""
    prev = load('nba.json')
    rows = {(r['d'], r['h'], r['a']): r for r in bk_rows_from_json(prev)}
    fix_name = matcher({r['h'] for r in rows.values()})
    start = TODAY.year if TODAY.month >= 8 else TODAY.year - 1
    eastern = ZoneInfo('America/New_York')
    fixtures, got, ok = [], 0, False
    for y in ([start - 1, start] if FULL else [start]):
        try:
            games = json.loads(get(f'https://fixturedownload.com/feed/json/nba-{y}'))
            ok = True
        except Exception as e:
            warn(f'NBA {y}: {e}')
            continue
        for g in games:
            ko = dt.datetime.strptime(g['DateUtc'].replace('Z', '').strip(), '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc)
            h, a = fix_name(g['HomeTeam']), fix_name(g['AwayTeam'])
            if g.get('HomeTeamScore') is not None and g.get('AwayTeamScore') is not None:
                d = day(ko.astimezone(eastern).date())   # el histórico usa la fecha de EE. UU.
                old = rows.get((d, h, a), {})
                rows[(d, h, a)] = {'d': d, 'h': h, 'a': a, 'hp': int(g['HomeTeamScore']), 'ap': int(g['AwayTeamScore']), 'ou': old.get('ou')}; got += 1
            elif ko > NOW - dt.timedelta(hours=3):
                fixtures.append({'league': 'NBA', 'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': h, 'a': a})
    if got:
        save('nba.json', bk_to_json(rows.values()))
    print(f'NBA: {got} resultados, {len(fixtures)} partidos próximos')
    return fixtures if ok else None


EXTRA_CRESTS = {}   # escudos que llegan con otras descargas (Euroliga/EuroCup, acb.com)
def euroleague_games(code, prev_rows):
    """API oficial de Euroliga (E) y EuroCup (U): https://api-live.euroleague.net/v2/competitions/{code}/seasons/{code}{año}/games"""
    rows = {(r['d'], r['h'], r['a']): r for r in prev_rows}
    start = TODAY.year if TODAY.month >= 8 else TODAY.year - 1
    madrid = ZoneInfo('Europe/Madrid')
    fixtures, got, ok = [], 0, False
    for y in (range(start - 3, start + 1) if FULL or not prev_rows else [start]):
        try:
            games = json.loads(get(f'https://api-live.euroleague.net/v2/competitions/{code}/seasons/{code}{y}/games'))['data']
            ok = True
        except Exception as e:
            warn(f'{code}{y}: {e}')
            continue
        for g in games:
            try:
                h, a = g['local']['club']['name'], g['road']['club']['name']
                for side in ('local', 'road'):   # escudo oficial del club (lo da la propia API)
                    cr = ((g[side]['club'].get('images') or {}).get('crest'))
                    if cr: EXTRA_CRESTS.setdefault('b:' + g[side]['club']['name'], cr)   # «b:» = baloncesto
                raw = g.get('utcDate') or g.get('date')
                ko = dt.datetime.fromisoformat(raw.replace('Z', '+00:00'))
                ko = ko.astimezone(dt.timezone.utc) if ko.tzinfo else ko.replace(tzinfo=madrid if 'T' in raw else dt.timezone.utc).astimezone(dt.timezone.utc)
                hs, as_ = g['local'].get('score'), g['road'].get('score')
            except (KeyError, TypeError, ValueError):
                continue
            if g.get('played') and hs is not None and as_ is not None:
                d = day(ko.astimezone(madrid).date())
                rows[(d, h, a)] = {'d': d, 'h': h, 'a': a, 'hp': int(hs), 'ap': int(as_), 'ou': None}; got += 1
            elif not g.get('played') and ko > NOW - dt.timedelta(hours=3):
                fixtures.append({'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': h, 'a': a})
    return rows, fixtures, got, ok


def update_euroliga():
    rows, fx, got, ok = euroleague_games('E', bk_rows_from_json(load('euroliga.json')))
    if got:
        save('euroliga.json', bk_to_json(rows.values()))
    print(f'Euroliga: {got} resultados, {len(fx)} partidos próximos')
    return [{'league': 'Euroliga', **f} for f in fx] if ok else None


# Otras competiciones de baloncesto -> basket_extra.json. EuroCup sin clave; el resto con API-Basketball (misma clave gratuita de API-Sports).
BASKET_APIS = [('lega', 'Lega Basket Serie A', 'Italy', ['lega a', 'serie a']),
               ('bbl', 'BBL (Alemania)', 'Germany', ['bbl']), ('lnb', 'Betclic Élite (Francia)', 'France', ['lnb', 'pro a', 'elite']),
               ('gbl', 'Liga griega', 'Greece', ['a1', 'basket league']), ('bsl', 'Liga turca', 'Turkey', ['super lig', 'bsl'])]

# ACB: calendario oficial de acb.com (gratis). Se lee el texto de la página: hora, local, siglas, marcador, visitante, siglas.
MESES = {m: i + 1 for i, m in enumerate(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])}
def parse_acb(page):
    """Devuelve [(fecha, 'HH:MM' o None, local, visitante, puntos local o None, puntos visitante o None)] a partir del HTML."""
    import html as H
    page = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', page)
    toks = [t for t in (H.unescape(x).strip() for x in re.split(r'<[^>]+>', page)) if t]
    time_re, abbr_re = re.compile(r'^(\d{1,2}:\d{2}|XX:XX|--:--)$'), re.compile(r'^(?=.*[A-Z])[A-Z0-9&]{2,4}$')   # siglas: con al menos una letra (no un marcador)
    date_re = re.compile(r'(\d{1,2}) de (' + '|'.join(MESES) + r') de (\d{4})', re.I)
    stop = {'Resumen', 'Previa', 'Estadísticas', 'Compra entradas', 'Directo'}
    out, cur = [], None
    for i, t in enumerate(toks):
        m = date_re.search(t)
        if m and not time_re.match(t):
            cur = dt.date(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1))); continue
        if cur is None or not time_re.match(t):
            continue
        seg = []
        for u in toks[i + 1:i + 12]:
            if u in stop or time_re.match(u) or date_re.search(u):
                break
            seg.append(u)
        ab = [k for k, u in enumerate(seg) if abbr_re.match(u)]
        if len(ab) != 2 or ab[0] == 0:
            continue
        home, rest = ' '.join(seg[:ab[0]]), ' '.join(seg[ab[0] + 1:ab[1]])
        sm = re.match(r'^(?:(\d{2,3})\s*-\s*(\d{2,3})|-)\s+(.+)$', rest)
        if not sm:
            continue
        hp, ap = (int(sm.group(1)), int(sm.group(2))) if sm.group(1) else (None, None)
        out.append((cur, t if re.match(r'^\d', t) else None, home, sm.group(3), hp, ap))
    return out
def acb_games(prev_rows):
    rows = {(r['d'], r['h'], r['a']): r for r in prev_rows}; fx, got = [], 0
    page = get('https://www.acb.com/es/liga/calendario').decode('utf-8', 'replace')
    games = parse_acb(page)
    names = {g[2] for g in games} | {g[3] for g in games}
    for tag in re.findall(r'<img\b[^>]*>', page):   # escudos de la propia página, si la imagen lleva el nombre del equipo
        src, alt = re.search(r'\bsrc="([^"]+)"', tag), re.search(r'\b(?:alt|title)="([^"]+)"', tag)
        if src and alt and alt.group(1).strip() in names:
            EXTRA_CRESTS.setdefault('b:' + alt.group(1).strip(), requests.compat.urljoin('https://www.acb.com/', src.group(1)))
    if len(games) < 50:   # una temporada tiene 306 partidos: si salen pocos, la página ha cambiado
        raise RuntimeError(f'solo {len(games)} partidos leídos en acb.com (¿ha cambiado la página?)')
    mad = ZoneInfo('Europe/Madrid')
    for d, hm, h, a, hp, ap in games:
        if hp is not None:
            rows[(day(d), h, a)] = {'d': day(d), 'h': h, 'a': a, 'hp': hp, 'ap': ap, 'ou': None}; got += 1
        else:
            hh, mm = (int(x) for x in hm.split(':')) if hm else (19, 0)
            ko = dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=mad).astimezone(dt.timezone.utc)
            if ko > NOW - dt.timedelta(hours=3):
                fx.append({'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': h, 'a': a, **({} if hm else {'noTime': True})})
    return rows, fx, got
def update_basket_extra():
    extra = load('basket_extra.json') or {'comps': {}}
    comps, fixtures, any_ok = extra['comps'], [], False
    prev = lambda k: bk_rows_from_json(comps[k]) if k in comps else []
    rows, fx, got, ok = euroleague_games('U', prev('eurocup'))
    any_ok |= ok
    if got:
        comps['eurocup'] = {'name': 'EuroCup', **bk_to_json(rows.values())}
    fixtures += [{'league': 'eurocup', **f} for f in fx]
    print(f'EuroCup: {got} resultados, {len(fx)} partidos próximos')
    try:
        rows, fx, got = acb_games(prev('acb'))
        comps['acb'] = {'name': 'Liga ACB', **bk_to_json(rows.values())}
        fixtures += [{'league': 'acb', **f} for f in fx]; any_ok = True
        print(f'Liga ACB (acb.com): {got} resultados, {len(fx)} partidos próximos')
    except Exception as e:
        warn(f'Liga ACB: {e}')
    if api_key() and daily_once('basketDate'):
        st_p = ROOT / 'data' / 'state.json'; st = json.loads(st_p.read_text()) if st_p.exists() else {}
        ids = st.get('basketIds', {})
        start = TODAY.year if TODAY.month >= 8 else TODAY.year - 1
        for key, name, country, tokens in BASKET_APIS:
            try:
                if key not in ids:   # descubrir el id de la liga una sola vez
                    ls = api('v1.basketball.api-sports.io', 'leagues', country=country)
                    cand = [l for l in ls if l.get('type', 'League') == 'League' and any(t in l['name'].lower() for t in tokens)]
                    if not cand:
                        warn(f'baloncesto {name}: liga no encontrada'); continue
                    ids[key] = cand[0]['id']
                rows = {(r['d'], r['h'], r['a']): r for r in prev(key)}; got = 0
                for y in ([start - 1, start] if FULL or key not in comps else [start]):
                    for g in api('v1.basketball.api-sports.io', 'games', league=ids[key], season=f'{y}-{y + 1}'):
                        ko = dt.datetime.fromisoformat(g['date'].replace('Z', '+00:00')).astimezone(dt.timezone.utc)
                        h, a = g['teams']['home']['name'], g['teams']['away']['name']
                        hs, as_ = (g.get('scores') or {}).get('home', {}).get('total'), (g.get('scores') or {}).get('away', {}).get('total')
                        status = (g.get('status') or {}).get('short')
                        if status in ('FT', 'AOT') and hs is not None and as_ is not None:
                            d = day(ko.date()); rows[(d, h, a)] = {'d': d, 'h': h, 'a': a, 'hp': int(hs), 'ap': int(as_), 'ou': None}; got += 1
                        elif status == 'NS' and ko > NOW - dt.timedelta(hours=3):
                            fixtures.append({'league': key, 'kickoff': ko.isoformat().replace('+00:00', 'Z'), 'h': h, 'a': a})
                if rows:
                    comps[key] = {'name': name, **bk_to_json(rows.values())}
                any_ok = True
                print(f'{name}: {got} resultados')
            except Exception as e:
                warn(f'baloncesto {name}: {e}')
                if 'límite' in str(e) or 'plan' in str(e).lower():
                    break
        st = json.loads(st_p.read_text()) if st_p.exists() else {}; st['basketIds'] = ids; st_p.write_text(json.dumps(st))
    if comps:
        save('basket_extra.json', {'comps': comps})
    return fixtures if any_ok else None


# ============================== TENIS (tennis-data.co.uk) ==============================
SURF = ['Hard', 'Clay', 'Grass', 'Carpet']
SETS = ['W1', 'L1', 'W2', 'L2', 'W3', 'L3', 'W4', 'L4', 'W5', 'L5']
ODDS = {'bW': 'B365W', 'bL': 'B365L', 'pW': 'PSW', 'pL': 'PSL', 'mW': 'MaxW', 'mL': 'MaxL'}


def parse_tennis(df, tour):
    df = df.dropna(subset=['Winner', 'Loser'])
    dates = pd.to_datetime(df['Date'], errors='coerce')
    out = []
    for i, (idx, r) in enumerate(df.iterrows()):
        if pd.isna(dates.iloc[i]):
            continue
        row = {'d': day(dates.iloc[i].date()), 'tour': tour, 'surf': SURF.index(r['Surface']) if r.get('Surface') in SURF else 0,
               'bo': 5 if str(r.get('Best of')).startswith('5') else 3, 'completed': 1 if r.get('Comment') == 'Completed' else 0,
               'w': str(r['Winner']).strip(), 'l': str(r['Loser']).strip(), 'tourn': str(r.get('Tournament') or '')}
        for c in SETS:
            row[c] = ival(r.get(c))
        for k, c in ODDS.items():
            row[k] = num(r.get(c))
        out.append(row)
    return out


def tn_rows_from_json(T):
    if not T:
        return []
    rows = []
    for k, d in enumerate(T['date']):
        r = {'d': d, 'tour': T['tour'][k], 'surf': T['surf'][k], 'bo': T['bo'][k], 'completed': T['completed'][k],
             'w': T['players'][T['w'][k]], 'l': T['players'][T['l'][k]], 'tourn': T['tourns'][T['tourn'][k]] if 'tourns' in T else ''}
        for c in SETS + list(ODDS):
            r[c] = T[c][k]
        rows.append(r)
    return rows


def tn_to_json(rows):
    rows = sorted(rows, key=lambda r: r['d'])   # orden estable: respeta el orden de rondas del fichero
    players = sorted({r['w'] for r in rows} | {r['l'] for r in rows})
    tourns = sorted({r['tourn'] for r in rows})
    pix, tix = {p: i for i, p in enumerate(players)}, {t: i for i, t in enumerate(tourns)}
    out = {'players': players, 'surfaces': SURF, 'tourns': tourns, 'date': [r['d'] for r in rows], 'tour': [r['tour'] for r in rows],
           'surf': [r['surf'] for r in rows], 'bo': [r['bo'] for r in rows], 'completed': [r['completed'] for r in rows],
           'w': [pix[r['w']] for r in rows], 'l': [pix[r['l']] for r in rows], 'tourn': [tix[r['tourn']] for r in rows]}
    for c in SETS + list(ODDS):
        out[c] = [r[c] for r in rows]
    return out


def update_tennis():
    prev = load('tennis.json')
    rows = {(r['d'], r['w'], r['l']): r for r in tn_rows_from_json(prev)}
    years = range(SINCE.year, TODAY.year + 1) if FULL or not prev else ([TODAY.year - 1, TODAY.year] if TODAY.month == 1 else [TODAY.year])
    got = 0
    for y in years:
        for tour, path in [(0, f'{y}/{y}.xlsx'), (1, f'{y}w/{y}.xlsx')]:
            # tennis-data.co.uk bloquea a veces los servidores de GitHub (403): copia en GitHub de los mismos datos como respaldo
            mirror = f"https://raw.githubusercontent.com/nick-benelli/Tennis-Data-Pipeline/main/data/raw/uk/{'wta' if tour else 'atp'}/uk_{'wta' if tour else 'atp'}_singles_raw_{y}.csv"
            for src, read in [(f'http://www.tennis-data.co.uk/{path}', lambda b: pd.read_excel(io.BytesIO(b))), (mirror, lambda b: pd.read_csv(io.BytesIO(b), low_memory=False))]:
                try:
                    for r in parse_tennis(read(get(src)), tour):
                        rows[(r['d'], r['w'], r['l'])] = r; got += 1
                    break
                except Exception as e:
                    warn(f'tenis {src}: {e}')
    if got:
        save('tennis.json', tn_to_json([r for r in rows.values() if r['d'] >= day(dt.date(2019, 1, 1))]))
    print(f'tenis: {got} partidos descargados, {len(rows)} en total')


# ============================== PRINCIPAL ==============================
def main():
    old = load('fixtures.json') or {}
    fixtures = {'generated': NOW.isoformat().replace('+00:00', 'Z')}
    for key, fn in [('football', update_football), ('uefa', update_clubelo), ('nba', update_nba), ('euroliga', update_euroliga), ('basket', update_basket_extra)]:
        try:
            fx = fn()
        except Exception as e:   # una fuente rota no debe parar las demás
            warn(f'{key}: {e}'); fx = None
        if fx is None:
            fx = old.get(key, [])   # sin calendario nuevo: se mantiene el anterior
        horizon = NOW + dt.timedelta(days=FIXTURE_DAYS)
        uniq = {(f['kickoff'], f['h'], f['a']): f for f in fx}   # sin duplicados
        fixtures[key] = sorted((f for f in uniq.values() if dt.datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00')) <= horizon), key=lambda f: f['kickoff'])
    for fn in (update_injuries, update_referees, update_fpl, update_sportsgambler):
        try:
            fn(fixtures['football'], FB_ROWS)
        except Exception as e:
            warn(f'{fn.__name__}: {e}')
    try:
        update_fdorg(FB_ROWS, fixtures)
    except Exception as e:
        warn(f'football-data.org: {e}')
    try:
        update_news(fixtures)
    except Exception as e:
        warn(f'noticias: {e}')
    try:
        update_social(fixtures)
    except Exception as e:
        warn(f'redes: {e}')
    try:
        update_crests(FB_ROWS, fixtures)
    except Exception as e:
        warn(f'escudos: {e}')
    try:
        update_tennis()
    except Exception as e:
        warn(f'tenis: {e}')
    save('fixtures.json', fixtures)


if __name__ == '__main__':
    main()
