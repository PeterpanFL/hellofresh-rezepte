# Meine Rezepte

Web-App (PWA) für gescannte HelloFresh-Rezeptkarten: Scan-PDF hochladen, Zutaten und Kochschritte werden als
Bildausschnitte gespeichert und zusätzlich als Text ausgelesen. „Was koche ich?“ sortiert die Rezepte danach,
wie wenige Zutaten fehlen. Läuft im Browser und lässt sich auf iPhone/iPad/Mac auf den Homescreen legen.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/` | React 19 + Vite + Tailwind + React Query, Supabase JS |
| `src/lib/pdf.ts` | PDF → Seitenbilder (pdf.js) und feste Ausschnitte (Titelbild, Zutaten, 6 Schritte) |
| `src/lib/importRecipe.ts` | Import: Bilder hochladen, `recipe-ocr` aufrufen, Ergebnis speichern |
| `supabase/migrations/` | Tabellen `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_pantry`, RLS, Bucket `recipe-scans`, Funktionen `recipe_match` und `recipe_refresh_search` |
| `supabase/functions/recipe-ocr/` | Edge Function: liest Vorder- und Rückseite mit Claude (Structured Outputs) |

Alle Namen beginnen mit `recipe`, damit das Schema neben anderen Apps im selben Supabase-Projekt liegen kann.

## Einrichten

1. Migration `supabase/migrations/001_recipes.sql` im Supabase-Projekt ausführen (SQL-Editor oder `supabase db push`).
2. Edge Function deployen: `supabase functions deploy recipe-ocr --no-verify-jwt`
   (die Funktion prüft den angemeldeten Nutzer selbst, wie `meter-ocr`).
3. Secret `ANTHROPIC_API_KEY` setzen. Optional `RECIPE_OCR_MODEL` (Standard `claude-opus-5-5`;
   `claude-haiku-5-5` ist deutlich günstiger).
4. Lokal: `.env.local` nach `.env.example` anlegen, `npm install`, `npm run dev`.
5. GitHub Pages: im Repo unter Settings → Pages „GitHub Actions“ wählen und unter Settings → Variables
   `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen. Jeder Push auf `main` deployt.
   Die Pages-URL zusätzlich in Supabase unter Authentication → URL Configuration eintragen.

Anmeldung mit E-Mail und Passwort eines Supabase-Nutzers.

## Kartenlayout

Die Ausschnitte stehen in `LAYOUT` in `src/lib/pdf.ts` als Anteile der Seite, gemessen an Karte 52
(ScanSnap iX1600, 200 dpi). Sollte eine Karte anders aussehen, bleiben Seitenbilder und Text trotzdem erhalten;
in der Detailansicht zeigt „Text“ die ausgelesene Fassung.
