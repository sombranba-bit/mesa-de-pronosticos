# Mesa de Pronósticos

Pronósticos automáticos de fútbol (17 ligas y competiciones europeas) y baloncesto (NBA, Euroliga, EuroCup, ACB y otras ligas europeas), con pronóstico a demanda de tenis.
Cada hora GitHub descarga resultados y calendario, calcula los pronósticos de los próximos 10 días,
guarda cada pronóstico antes del partido y lo compara con el resultado para medir los aciertos.
Todo es gratis. Las claves son opcionales y gratuitas: API-Football (bajas, árbitros, ACB), football-data.org (árbitros y Champions) y The Odds API (cuotas).

La app queda en `https://TU-USUARIO.github.io/mesa-de-pronosticos/`.

## Puesta en marcha (una sola vez, unos 10 minutos)

1. **Crea el repositorio.** En GitHub: *New repository*, nombre `mesa-de-pronosticos`, **público**
   (así GitHub Actions y GitHub Pages son gratis sin límite; los datos no tienen nada personal). No marques
   ninguna opción de README ni licencia.
2. **Sube los ficheros.** En el repositorio vacío, *uploading an existing file* y arrastra **todo** el
   contenido de esta carpeta, incluida la carpeta oculta `.github`. Pulsa *Commit changes*.
3. **Permisos de escritura.** *Settings → Actions → General → Workflow permissions*: marca
   *Read and write permissions* y guarda.
4. **Publica la app.** *Settings → Pages → Build and deployment*: *Deploy from a branch*, rama `main`,
   carpeta `/docs`. Guarda. En un par de minutos la app está en la dirección de arriba.
5. **Primera pasada.** *Actions → Actualizar pronósticos → Run workflow*. Tarda 2-4 minutos.
   Desde ahí se ejecuta solo cada hora.

### Telegram (opcional)

1. En Telegram, habla con **@BotFather**, envía `/newbot` y sigue los pasos. Te da un *token*.
2. Escribe cualquier mensaje a tu bot nuevo.
3. Abre en el navegador `https://api.telegram.org/botTU_TOKEN/getUpdates` y copia el número de `"chat":{"id": ...}`.
4. En GitHub: *Settings → Secrets and variables → Actions → New repository secret*. Crea
   `TELEGRAM_TOKEN` (el token) y `TELEGRAM_CHAT_ID` (el número).

Cada día, a partir de las 8:00, recibirás la apuesta del día, la selección recomendada, los pronósticos del día y los de más confianza.

**Apuesta del día y selección recomendada** (arriba en la pantalla principal): la apuesta del día es el pronóstico con más
probabilidad del día entre todos los deportes; la selección son los de 65% o más (hasta 5, uno por partido), con la probabilidad
de acertarlos todos juntos y su cuota justa. Ambas se evalúan solas y su porcentaje de aciertos aparece debajo.

**Avisos personalizados.** El fichero `config.json` decide qué recibes: hora, tus equipos, competiciones y confianza mínima.
Lo más cómodo es usar la pestaña *Pronósticos → Avisos de Telegram* de la app, copiar el texto que genera y pegarlo en
`config.json` desde GitHub (abrir el fichero → lápiz → pegar → *Commit changes*). Listas vacías significan «todos».

### Bajas, árbitros y más baloncesto (opcional)

1. Regístrate gratis en https://dashboard.api-football.com y copia tu clave (*API Key*).
2. En GitHub crea el secreto `API_FOOTBALL_KEY` con esa clave.

Con esa clave, una vez al día se descargan:
- los lesionados y sancionados de las ligas con partidos en los próximos 8 días;
- el árbitro de cada partido (para ver si es tarjetero);
- la ACB, Lega A, BBL, Betclic Élite, liga griega y liga turca de baloncesto (API-Basketball, misma cuenta).

Cada servicio tiene 100 peticiones diarias gratis y el sistema usa como mucho 90. El plan gratuito de API-Football está limitado en
temporadas: si no da acceso a la actual, el registro de *Actions* lo indicará y las bajas quedarán solo a mano en la app.

### Árbitros de más ligas y Champions (opcional, gratis)

1. Regístrate en https://www.football-data.org/client/register (plan gratuito) y copia el *token* que llega por correo.
2. Crea el secreto `FOOTBALL_DATA_ORG_KEY`.

Da el árbitro designado en LaLiga, Premier, Championship, Serie A, Bundesliga, Ligue 1, Eredivisie y Primeira, y la hora,
el árbitro y el resultado de la Champions (así sus pronósticos también cuentan en «Aciertos»). El resto de ligas sacan el
árbitro de API-Football. SofaScore no se usa: su API no es pública, sus condiciones lo prohíben y bloquea servidores como GitHub.

### Noticias

Sin configurar nada: cada hora se buscan en Google News titulares recientes (48 h) de lesiones, sanciones, alineaciones y
cambios de entrenador de los equipos con partido próximo. Salen en la ficha del partido y como etiqueta en la lista.
Twitter/X no se usa porque su API de lectura es de pago.

### Cuotas: surebets, valor y errores (opcional, separado de los pronósticos)

1. Regístrate gratis en https://the-odds-api.com (500 créditos al mes) y crea el secreto `ODDS_API_KEY`.
2. Para recibirlo por Telegram, añade `"cuotas": true` dentro de `telegram` en `config.json` (o márcalo en *Avisos de Telegram*).

Dos pasadas al día (desde las 9:00) repartiendo los créditos hasta fin de mes. Busca surebets, cuotas con valor frente a
Pinnacle (≥3%) y cuotas anómalas (≥25% por encima de la mediana de las demás casas). **Importante:** la fuente no incluye
Bet365, Codere ni Winamax; compara casas europeas (Pinnacle, Betfair, Unibet, William Hill…). Las cuotas cambian en minutos:
comprueba siempre antes en tu casa.

### Comprobaciones automáticas

`tests/test_model.mjs` revisa en cada ejecución 112 propiedades del modelo (probabilidades que suman 1, líneas de más/menos
coherentes, hándicaps válidos, efecto de las bajas, cansancio NBA, tenis…). Si alguna falla, la ejecución se para antes de
calcular pronósticos o enviar avisos, y GitHub te avisa por correo.

## Qué hace cada parte

| Parte | Qué hace |
|---|---|
| `pipeline/data.py` | Descarga resultados y calendario: football-data.co.uk (fútbol), Understat (xG), ClubElo (competiciones europeas), API-Football (bajas y árbitros), fixturedownload.com (NBA), API oficial de la Euroliga (Euroliga y EuroCup), API-Basketball (ACB y otras) y tennis-data.co.uk (tenis). Cada noche recarga todas las temporadas desde 2019; el resto de horas solo la actual. Si una fuente falla, conserva los datos anteriores. |
| `pipeline/predict.mjs` | Calcula los pronósticos con `app/model.js` (el mismo código que la app), guarda el historial en `data/history.json`, evalúa los aciertos y envía el resumen a Telegram. |
| `app/` | La app: `model.js` (modelos), `ui.js` (interfaz), `template.html` (diseño). `build.py` genera `docs/index.html`. |
| `config.json` | Qué avisos de Telegram quieres recibir. |
| `.github/workflows/update.yml` | Ejecuta todo cada hora y guarda los cambios. |

## Modelos

- **Fútbol:** conjunto de Dixon-Coles con decaimiento temporal, Elo por resultados, pi-ratings, GAP ratings (tiros a puerta) y ratings de cuotas pasadas (goles implícitos en las cuotas de Bet365 de los partidos jugados). Validado en 17 ligas 2025-26: 1X2 1,0130 → 1,0083, más/menos 2,5 0,6843 → 0,6806. En las 5 grandes, los mercados de goles usan un modelo que mezcla goles y xG. Ajuste por bajas (automático con API-Football o a mano). Mercados: 1X2, doble oportunidad, ambos marcan, goles totales y exactos, par/impar, goles por equipo, portería a cero, margen, hándicap asiático, resultado exacto, descanso, descanso/final, córners y tarjetas.
- **Competiciones europeas:** Elo de ClubElo traducido a goles esperados (fórmula ajustada en 23.000 partidos).
- **Ligas:** España (1ª y 2ª), Inglaterra (Premier y Championship), Italia (A y B), Alemania (1ª y 2ª), Francia (1ª y 2ª), Países Bajos, Portugal, Escocia (1ª y 2ª), Bélgica, Turquía y Grecia.
- **Tarjetas:** se corrige la tendencia reciente de cada liga (validado en la Premier 2022-26). El árbitro se muestra como información; ajustar por él no mejoraba el pronóstico.
- **Baloncesto:** rating de ataque y defensa con factor cancha; margen y total con distribución normal. En la NBA, ajuste por cansancio (partidos seguidos, descanso y kilómetros de viaje).
- **Ficha de partido:** últimos 5 resultados, enfrentamientos directos y en qué se basa el pronóstico (ataque, defensa, Elo, xG).
- **Aciertos:** por deporte, por competición y por mercado (1X2, goles, ambos marcan, córners, tarjetas).
- **Tenis:** Elo general y por superficie calibrado, traducido a un modelo de puntos al saque para sets, juegos y tie-breaks.

## Límites conocidos

- La ACB se lee del calendario oficial de acb.com (gratis, sin clave). Las demás ligas europeas de baloncesto (Lega A, BBL, francesa, griega, turca) dependen de API-Basketball, cuyo plan gratuito no da la temporada actual.
- Bajas: Premier desde el Fantasy oficial (cada hora, con probabilidad de jugar); LaLiga, LaLiga 2, Championship, Serie A y B, Bundesliga y 2. Bundesliga, Ligue 1, Eredivisie, Primeira, Escocia, Bélgica, Turquía y Grecia desde sportsgambler.com (cada 3 horas). Faltan Ligue 2 y la 2ª escocesa. Si la web cambia su diseño, el registro de *Actions* lo indicará y se conservan las últimas bajas leídas.
- Los árbitros fuera de Inglaterra dependen de las claves de football-data.org y API-Football.
- Sin `FOOTBALL_DATA_ORG_KEY`, la Champions no tiene hora ni se evalúa en «Aciertos»; Europa League y Conference nunca se evalúan.
- El ajuste por bajas es una estimación sin validar (no hay histórico gratuito de bajas). La pestaña de aciertos compara el 1X2 con y sin este ajuste para comprobar si ayuda.
- El tenis no tiene calendario gratuito fiable: se pronostica a demanda eligiendo los dos jugadores.
- football-data.co.uk actualiza resultados y calendario un par de veces por semana; la NBA y la Euroliga, a diario.
- GitHub puede retrasar unos minutos las ejecuciones programadas.
