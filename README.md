# Wordle Deutsch

Errate das deutsche Wort mit fünf Buchstaben in sechs Versuchen.

- **Profile ohne Anmeldung:** Seite öffnen, Profil wählen (oder neu anlegen), losspielen.
- **Tagesrätsel:** ein Wort pro Tag, für alle gleich, neues Wort um Mitternacht (deutsche Zeit).
- **Endlos-Modus:** beliebig viele zufällige Wörter mit eigener Statistik.
- **Statistik pro Profil:** Spiele, Siegquote, Serie, Verteilung der Versuche – mit Supabase auf allen Geräten gleich.
- QWERTZ-Tastatur mit Ä, Ö, Ü (ß wird als SS geschrieben), schwerer Modus, hoher Kontrast, helles/dunkles Design, Ergebnis teilen.

Reine statische Webseite (HTML, CSS, JavaScript) – läuft kostenlos auf GitHub Pages.

## Seite auf GitHub Pages veröffentlichen

1. Auf GitHub das Repository öffnen → **Settings** → links **Pages**.
2. Bei **Build and deployment** → **Source**: „Deploy from a branch“.
3. **Branch**: `main` und Ordner `/ (root)` wählen → **Save**.
4. Nach ca. 1–2 Minuten ist die Seite erreichbar unter
   **https://dibs999.github.io/wordle/**

Jeder weitere Push auf `main` aktualisiert die Seite automatisch.

## Profile geräteübergreifend speichern (Supabase)

Ohne diese Einrichtung werden Profile nur im jeweiligen Browser gespeichert.
Mit Supabase (kostenloser Tarif) sind Profile und Statistiken auf allen Geräten gleich.

1. **Projekt anlegen:** Auf [supabase.com](https://supabase.com) mit „Continue with GitHub“ anmelden →
   **New project** → Name z. B. `wordle`, Region **Central EU (Frankfurt)**, ein Datenbank-Passwort
   generieren lassen (wird für das Spiel nicht gebraucht) → **Create new project**.
2. **Tabelle anlegen:** Im Projekt links **SQL Editor** → **New query** → den kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**. Supabase warnt dann eventuell vor
   „destructive operations“. Das ist normal: Das Skript ersetzt nur seine eigenen Zugriffsregeln und
   löscht keine Daten. Mit **Run query** bestätigen. Danach erscheint „Success. No rows returned“.
3. **Zugangsdaten kopieren:**
   - **Project URL:** oben im Projekt auf **Connect** klicken (oder **Project Settings** → **Data API**).
     Nur den Teil bis `.supabase.co` nehmen, z. B. `https://abcdefgh.supabase.co` – ohne `/rest/v1/`.
   - **Publishable key:** **Project Settings** → **API Keys**. Er beginnt mit `sb_publishable_…`
     (bei älteren Projekten heißt er **anon public**).

   ⚠️ Niemals den **secret** bzw. **service_role** Key verwenden – der gehört nicht in eine Webseite.
4. **Eintragen:** In [`js/config.js`](js/config.js) beide Werte einsetzen:
   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
   Dann committen und pushen. Fertig – der Hinweis „Profile werden nur in diesem Browser gespeichert“
   verschwindet, und alle Geräte sehen dieselben Profile.

**Gut zu wissen**

- Es gibt keine Anmeldung: Wer den Link kennt, kann Profile sehen, anlegen und mit ihnen spielen.
  Für Familie und Freunde gedacht.
- Profile löschen oder umbenennen: im Supabase-Dashboard unter **Table Editor** → `profiles`.
- Kostenlose Supabase-Projekte werden nach etwa einer Woche ohne Nutzung pausiert. Dann im
  Dashboard auf **Restore project** klicken.
- Profile, die vor der Einrichtung nur im Browser angelegt wurden, erscheinen auf diesem Gerät unter
  „Nur auf diesem Gerät gespeichert“ und lassen sich mit **Online übernehmen** samt Statistik hochladen.
- Nach einem Update kann es bis zu 10 Minuten dauern, bis jeder Browser die neue Version lädt
  (GitHub Pages lässt Dateien so lange zwischenspeichern). Neu laden mit Strg+F5 hilft sofort.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org).

```bash
npm start
```

Dann http://localhost:8080 öffnen. (Ein Doppelklick auf `index.html` funktioniert nicht,
weil der Browser JavaScript-Module nur über einen Webserver lädt.)

Tests der Spiellogik:

```bash
npm test
```

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seite mit Profilauswahl, Spielfeld und Dialogen |
| `css/style.css` | Gestaltung inkl. dunklem Design und hohem Kontrast |
| `js/app.js` | Bedienung, Animationen, Statistik, Teilen |
| `js/game.js` | Spiellogik (Auswertung, Tageswort, Serien) |
| `js/store.js` | Speichern der Profile (Supabase oder Browser) |
| `js/config.js` | Supabase-Zugangsdaten |
| `js/words.js` | Wortlisten (Lösungswörter und erlaubte Wörter) |
| `supabase/schema.sql` | Tabelle und Zugriffsregeln für Supabase |

## Wortlisten

- **Erlaubte Wörter:** alle Wörter mit fünf Buchstaben aus
  [enz/german-wordlist](https://github.com/enz/german-wordlist) (Lizenz CC0), einer Wortliste nach
  Scrabble-Regeln mit allen Beugungsformen und ohne Namen. ß ist als SS geschrieben.
- **Lösungswörter:** eine Auswahl geläufiger Grundformen, die alle auch in dieser Liste vorkommen.
