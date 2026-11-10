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
3. Secret `ANTHROPIC_API_KEY` setzen. Optional `RECIPE_OCR_MODEL`:
   `claude-haiku-5-5` ist Standard und kostet etwa 0,2 Cent pro Karte; `claude-opus-5-5` liest am sorgfältigsten, kostet aber etwa 5 Cent.
4. Lokal: `.env.local` nach `.env.example` anlegen, `npm install`, `npm run dev`.
5. GitHub Pages: im Repo unter Settings → Pages als Source „GitHub Actions“ wählen. Jeder Push auf `main` deployt.
   Supabase-URL und Publishable Key für den Build stehen in `.env.production` (beide sind öffentlich gedacht).

Anmeldung mit E-Mail und Passwort eines Supabase-Nutzers.

## Automatischer Upload vom Mac

ScanSnap Home speichert die PDFs in einen Ordner. Ein kleiner Hintergrunddienst (launchd) lädt neue PDFs
von dort in den Eingang (`recipe-scans/<user>/inbox/`) und verschiebt sie in den Unterordner `hochgeladen`.
Die Web-App verarbeitet den Eingang, solange die Seite „Hinzufügen“ offen ist. Auf der Rezeptliste erscheint ein Hinweis, wenn neue Scans warten.

Einrichten (einmal im Terminal, im Repo-Ordner):

```bash
bash scripts/mac/install.sh
```

Das Skript fragt nach Ordner, E-Mail und Passwort (landet im Schlüsselbund) und macht einen Testlauf. Protokoll: `~/Library/Logs/hellofresh-rezepte.log`.
Entfernen: `bash scripts/mac/uninstall.sh`.

Liegt der Scan-Ordner unter „Downloads“, „Dokumente“ oder „Schreibtisch“, kann macOS dem Hintergrunddienst den Zugriff verweigern
(„Operation not permitted“ im Protokoll). Dann entweder in Systemeinstellungen → Datenschutz & Sicherheit → Festplattenvollzugriff
`/bin/bash` hinzufügen, oder ScanSnap Home in einen Ordner außerhalb davon speichern lassen (z. B. `~/Scans/Hello Fresh`) und `install.sh` erneut ausführen.

## Kartenlayout

Die Ausschnitte stehen in `LAYOUT` in `src/lib/pdf.ts` als Anteile der Seite, gemessen an Karte 52
(ScanSnap iX1600, 200 dpi). Sollte eine Karte anders aussehen, bleiben Seitenbilder und Text trotzdem erhalten;
in der Detailansicht zeigt „Text“ die ausgelesene Fassung.
