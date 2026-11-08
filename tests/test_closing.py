"""Cuotas de cierre de football-data: se leen y se guardan aparte."""
import sys, pathlib, tempfile, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'pipeline'))
import data as D
csv = b"Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,PSCH,PSCD,PSCA,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5\nE2,01/11/2026,15:00,Wigan,Barnsley,1,0,2.1,3.3,3.5,2.05,3.4,3.6,2.0,3.3,3.5,1.9,1.95\n"
r = D.parse_fd_csv(csv, 'E2'); assert r[0]['close'] == [2.05, 3.4, 3.6, 1.9, 1.95], r[0]['close']   # Pinnacle de cierre y, si falta (más/menos), la media
D.CLOSING = pathlib.Path(tempfile.mkdtemp()) / 'c.json'; D.TODAY = D.dt.date(2026, 11, 8)
D.save_closing(r); assert json.loads(D.CLOSING.read_text()) == {'2026-11-01|Wigan|Barnsley': [2.05, 3.4, 3.6, 1.9, 1.95]}
print('ok cuotas de cierre')
