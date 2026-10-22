# ImmoFriend-Proxy (Cloudflare Worker)

Leitet die Belegerkennung der öffentlichen App an die Anthropic-API weiter. Der API-Schlüssel liegt nur hier als
Geheimnis; die App schickt stattdessen einen **Einladungscode** mit. Der Worker prüft:

- Herkunft: nur Aufrufe aus der App (`ALLOWED_ORIGINS`)
- Einladungscode: einer aus `INVITE_CODES` (z. B. ein Code je Freund – einzeln widerrufbar)
- Anfrage: nur `claude-opus-5-5`, höchstens 64.000 Ausgabe-Token, keine Werkzeuge
- optional ein Tageslimit je Code (`DAILY_LIMIT`, braucht die KV-Bindung `USAGE`)

## Einrichten im Cloudflare-Dashboard (ohne Kommandozeile)

1. Konto auf [cloudflare.com](https://dash.cloudflare.com/sign-up) anlegen (kostenlos).
2. **Workers & Pages → Create → Create Worker**, Name `immofriend-proxy`, **Deploy**.
3. **Edit code**: den Inhalt von [`src/index.js`](src/index.js) komplett einfügen, **Deploy**.
4. **Settings → Variables and Secrets → Add**:
   - `ANTHROPIC_API_KEY` – Typ *Secret* – ein eigener Schlüssel nur für ImmoFriend aus der Anthropic Console
   - `INVITE_CODES` – Typ *Secret* – z. B. `anna-4711,ben-2209` (Komma, keine Leerzeichen nötig)
   - `ALLOWED_ORIGINS` – Typ *Text* – `https://boonwalker.github.io`
   - `DAILY_LIMIT` – Typ *Text* – `30`
5. Optional Tageslimit: **Storage & Databases → KV → Create** (Name `immofriend-usage`), dann beim Worker
   **Settings → Bindings → Add → KV namespace**, Variablenname `USAGE`.
6. Die Adresse des Workers steht oben, z. B. `https://immofriend-proxy.<name>.workers.dev`.
   Sie kommt in `.github/workflows/pages.yml` als `VITE_PROXY_URL`.

## Oder per Kommandozeile

```bash
cd worker
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put INVITE_CODES
npx wrangler deploy
```

## Kosten im Griff behalten

- In der [Anthropic Console](https://console.anthropic.com) unter *Limits* ein monatliches Ausgabenlimit setzen.
- Richtwert: etwa 5–15 Cent pro Beleg, bis rund 50 Cent für eine mehrseitige WEG-Abrechnung.
- Einen Code sperren: aus `INVITE_CODES` entfernen und speichern – wirkt sofort.
