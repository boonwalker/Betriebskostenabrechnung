# ImmoFriend

Web-App für private Vermieter: Mietobjekte wie ein Depot im Blick behalten, Mieter verwalten und die jährliche Betriebskostenabrechnung erstellen, inklusive Nachzahlung oder Guthaben je Mieter und druckfertigem Anschreiben.

## Funktionen

- **Anlagen zum Mieterschreiben:** Heizkostenabrechnung (aus den hochgeladenen WEG-Unterlagen wählbar) und Grundsteuer-/Abgabenbescheid als Fotos oder PDF; Seiten einzeln beifügen und schwärzen – für alle oder nur im Schreiben an einen bestimmten Mieter. Die Seiten werden im Ausdruck und im PDF hinter jedes Anschreiben gehängt. Gespeichert werden sie in der Claude-Vorschau im privaten Dateispeicher des Artifacts, sonst in IndexedDB des Geräts (nicht in der Sicherungsdatei).

- **Portfolio-Startseite** mit einer Kachel je Objekt: Vermögenswert (Marktwert − Restschuld + Cashflow seit Erwerb) mit monatlichem Verlauf, Zuwachs gegenüber dem Einstand, Mietrendite, monatlicher Cashflow und Vermietungsstand. Oben steht der Vermögenswert über alle Objekte.
- **Assistent für neue Objekte**: fragt Art, Erwerb (Kauf, Schenkung oder Erbschaft), Darlehen mit Konditionen und Auszahlung, Wohnungen, laufende Kosten und den aktuellen Wert ab. Bei Schenkung/Erbschaft wird die Abschreibung des Rechtsvorgängers fortgeführt (§ 11d EStDV).
- **Objektdetailseite** mit Wertentwicklung (Bewertungen erfassen), Einheiten und Mietern, Wirtschaftlichkeitsrechnung, steuerlicher Schätzung (Anlage V mit AfA nach Baujahr), Finanzierung und Abrechnungen. Fehlende Angaben werden als Checkliste angezeigt.
- **Objektdaten**: Art (Mehrfamilienhaus, Ein-/Zweifamilienhaus, Eigentumswohnung), Baujahr, Kaufpreis und Kaufnebenkosten, Anteil Grund und Boden, Darlehen, Hausgeld (Verwaltervergütung, Erhaltungsrücklage) und weitere nicht umlagefähige Kosten
- **Mieter** mit Ein-/Auszug, Personenzahl, Kaution und Mietverlauf (Kaltmiete, Betriebs- und Heizkostenvorauszahlung, Warmmiete) – Mieterhöhungen und Anpassungen nach § 560 BGB werden monatsgenau berücksichtigt
- **Abrechnung** mit allen 17 Kostenarten nach § 2 BetrKV und den Umlageschlüsseln Wohnfläche, Personen, Wohneinheiten, Verbrauch und direkte Zuordnung
  - tagesgenaue Aufteilung bei Ein- und Auszug
  - Leerstand bleibt beim Vermieter und wird nicht auf andere Mieter verteilt
  - Vorauszahlungen werden aus dem Mietvertrag berechnet und können durch tatsächlich gezahlte Beträge ersetzt werden
  - Hinweis auf die Abrechnungsfrist (§ 556 Abs. 3 BGB)
  - Kostenpositionen aus dem Vorjahr übernehmen
  - Heizkosten nach HeizkostenV: Grundkosten nach Wohnfläche und 50–70 % nach Verbrauch
  - CO2-Kostenaufteilung nach dem Stufenmodell des CO2KostAufG: Der Vermieteranteil wird abgezogen und im Anschreiben ausgewiesen
  - Arbeitskosten nach § 35a EStG je Mieter (haushaltsnahe Dienstleistungen und Handwerkerleistungen)
- **Belege hochladen** (PDF oder Foto): Claude liest Rechnungen und Bescheide aus, ordnet sie der Kostenart zu und trennt nicht umlagefähige Anteile ab (z. B. Reparaturen). Jede Position wird vor der Übernahme angezeigt und kann geändert werden. Dafür braucht man einen eigenen Anthropic-API-Schlüssel.
- **Anschreiben je Mieter** zum Drucken oder als PDF, optional mit Anpassung der Vorauszahlung (§ 560 Abs. 4 BGB)
- **Datenschutz**: Alle Daten bleiben lokal im Browser. Sicherung und Wiederherstellung über eine JSON-Datei.

### Eigentumswohnungen (WEG)

Für vermietete Eigentumswohnungen arbeitet die App mit drei getrennten Ebenen:

1. **WEG-Jahresabrechnung** (Ist, Eigentümer ↔ Gemeinschaft): Einzelabrechnung hochladen oder abtippen. Jede Position wird nach BetrKV bewertet (umlagefähig, nicht umlagefähig, Prüfung erforderlich), mit Begründung, Quelle (Dokument, Seite, Zeile) und Prüfstatus. Die Kontrollsumme vergleicht die Positionen mit den Bewirtschaftungskosten. Über-/Unterdeckung und Rücklage bleiben auf der Eigentümer-Ebene.
2. **Mieterabrechnung**: übernimmt nur geprüfte, umlagefähige Ist-Positionen (§ 556a Abs. 3 BGB: Schlüssel der WEG). Heizkosten kommen aus der Heizkostenabrechnung; darin enthaltene Energie- und Wartungskosten werden nicht doppelt umgelegt. Freigeben lässt sie sich erst, wenn nichts mehr offen ist; danach ist sie eingefroren.
3. **Wirtschaftsplan** (Prognose): Plan-Ist-Vergleich, erwartete Nachzahlung und Vorauszahlungsempfehlung – nie Grundlage einer Abrechnung.

Analyse, Zielmodell und Roadmap: [`docs/ANALYSE_UND_ROADMAP.md`](docs/ANALYSE_UND_ROADMAP.md). Der reale Testfall WE 09 liegt anonymisiert in `src/lib/fixtures/we09.ts` und lässt sich unter Einstellungen → „Testfall WE 09 hinzufügen“ laden.

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm test           # Tests: Abrechnung, Rendite, WEG-Akzeptanztests (WE 09)
npm run build      # Produktions-Build nach dist/
```

Die Abrechnung steckt in `src/lib/calc.ts`, die Renditeberechnung in `src/lib/finance.ts` – beide getrennt von der Oberfläche. Das Auslesen der Belege steckt in `src/lib/extract.ts`. Gespeicherte Daten älterer Versionen werden beim Laden automatisch übernommen (`migrate` in `src/lib/model.ts`).

## Als Homebildschirm-App nutzen

Die öffentliche Version liegt auf GitHub Pages: **https://boonwalker.github.io/Betriebskostenabrechnung/**

- iPhone: Link in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Android: in Chrome „App installieren“.
- Die App startet leer und speichert alles nur im Browser des Geräts (kein Konto, kein Server). Sicherungen gibt es unter Einstellungen → Daten; die App erinnert nach 30 Tagen daran.
- Manifest, Icons und Service Worker (`public/`) machen sie installierbar und offline startfähig.
- Bei jedem Push auf `claude/betriebskosten-app` baut `.github/workflows/pages.yml` die App neu und veröffentlicht sie. Einmalig nötig: unter *Settings → Pages* als Quelle „GitHub Actions“ wählen.
- Die Vorführdaten (Testfall WE 09) sind nur im Vorführ-Build enthalten, nicht in der öffentlichen Version.
- Belegerkennung für Freunde: per Einladungscode über einen Cloudflare Worker, der den API-Schlüssel des Betreibers verwahrt (`worker/`, Anleitung in `worker/README.md`). Die App enthält nie einen Schlüssel; wer einen eigenen hat, kann ihn weiter direkt eintragen.

## Hinweis

Die App ist eine Hilfe beim Erstellen, aber keine Rechts- oder Steuerberatung. Prüfe Umlageschlüssel und Kostenarten anhand deines Mietvertrags. Die steuerliche Betrachtung ist eine vereinfachte Jahresschätzung (z. B. ohne Sonder-AfA, Erhaltungsaufwand-Verteilung nach § 82b EStDV oder Zufluss-/Abflussprinzip).

## Vorführversion als Artifact

`VITE_SHOWCASE=1 npx vite build --base=./` baut die Vorführversion (Startdaten: Testfall WE 09). Als Artifact veröffentlicht speichert sie den
gesamten Datenbestand zusätzlich in der Artifact-Datenbank (`appdata/state`, nur für den Eigentümer lesbar, ohne API-Schlüssel). Dieser Stand hat
Vorrang vor dem Browser-Speicher und bleibt bei neuen Versionen erhalten.

Wichtig für Änderungen: den Speicherschlüssel der Vorführversion nicht mehr ändern und Startdaten nicht über neue Schlüssel einspielen –
Datenänderungen per Migration (`migrate`) oder gezielt im Datenbank-Dokument vornehmen, sonst gehen Eingaben verloren.
