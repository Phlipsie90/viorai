# ViorAI Angebotsplattform (CRM Tool)

Bestehendes Next.js-Projekt für die Angebotserstellung im Sicherheitsumfeld (u. a. Objektschutz, Revierdienst, Videoturm).

## Lokaler Start

```bash
npm install
npm run dev
```

App lokal unter `http://localhost:3000`.

## Build-Check

```bash
npm run build
```

## Vercel Deployment (test.viorai.com)

Das Projekt ist als **eigenständige App** deploybar (separat von der Landingpage `viorai.com`).

### 1) Projekt in Vercel verbinden

1. Repository in Vercel importieren.
2. Framework: Next.js (automatisch).
3. Build Command: `npm run build` (Standard).
4. Output: automatisch (kein Export-Modus nötig).

### 2) Environment Variables setzen

Pflicht:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `DEEPSEEK_API_KEY`

Optional:

- `DEEPSEEK_MODEL` (Default: `deepseek-chat`)
- `DEEPSEEK_API_URL` (Default: `https://api.deepseek.com/v1/chat/completions`)

Hinweis: Keine Secrets im Frontend verwenden. SMTP/DeepSeek werden nur serverseitig in API-Routes genutzt.

### 3) Domain konfigurieren

In Vercel-Projekt:

- Domain hinzufügen: `test.viorai.com`
- DNS beim Provider setzen (CNAME/Alias auf Vercel)
- SSL wird von Vercel automatisch bereitgestellt

`viorai.com` bleibt bewusst ein separates Projekt.

### 4) Funktionsstatus

- API-Routes laufen auf Node-Runtime:
  - `/api/quotes/send` (SMTP)
  - `/api/ai/generate-offer-text` (DeepSeek)
- PDF-Erzeugung nutzt serverseitiges Laden der Fonts über Dateisystem (`process.cwd()` + `public/fonts/...`) mit Fallback.

## Schnelltest nach Deploy

1. Login funktioniert.
2. Dashboard lädt.
3. Angebot speichern funktioniert.
4. PDF herunterladen funktioniert.
5. Angebot senden (SMTP) funktioniert.
6. KI-Textgenerierung (DeepSeek) funktioniert.
