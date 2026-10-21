# Betriebskostenabrechnung

Web-App für private Vermieter: Mietobjekte und Mieter verwalten und die jährliche Betriebskostenabrechnung erstellen, inklusive Nachzahlung oder Guthaben je Mieter und druckfertigem Anschreiben.

## Funktionen

- **Objekte & Wohneinheiten** mit Wohnflächen
- **Mieter** mit Ein-/Auszug, Personenzahl und monatlicher Vorauszahlung (auch Mieterwechsel im Jahr)
- **Abrechnung** mit allen 17 Kostenarten nach § 2 BetrKV und den Umlageschlüsseln Wohnfläche, Personen, Wohneinheiten, Verbrauch und direkte Zuordnung
  - tagesgenaue Aufteilung bei Ein- und Auszug
  - Leerstand bleibt beim Vermieter und wird nicht auf andere Mieter verteilt
  - Vorauszahlungen werden aus dem Mietvertrag berechnet und können durch tatsächlich gezahlte Beträge ersetzt werden
  - Hinweis auf die Abrechnungsfrist (§ 556 Abs. 3 BGB)
  - Kostenpositionen aus dem Vorjahr übernehmen
- **Belege hochladen** (PDF oder Foto): Claude liest Rechnungen und Bescheide aus, ordnet sie der Kostenart zu und trennt nicht umlagefähige Anteile ab (z. B. Reparaturen). Jede Position wird vor der Übernahme angezeigt und kann geändert werden. Dafür braucht man einen eigenen Anthropic-API-Schlüssel.
- **Anschreiben je Mieter** zum Drucken oder als PDF, optional mit Anpassung der Vorauszahlung (§ 560 Abs. 4 BGB)
- **Datenschutz**: Alle Daten bleiben lokal im Browser. Sicherung und Wiederherstellung über eine JSON-Datei.

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm test           # Tests der Abrechnungslogik
npm run build      # Produktions-Build nach dist/
```

Die Berechnung steckt in `src/lib/calc.ts` und ist von der Oberfläche getrennt. Das Auslesen der Belege steckt in `src/lib/extract.ts`.

## Hinweis

Die App ist eine Hilfe beim Erstellen, aber keine Rechtsberatung. Prüfe Umlageschlüssel und Kostenarten anhand deines Mietvertrags. Heizkosten müssen nach der HeizkostenV zu 50–70 % nach Verbrauch verteilt werden. Dafür legst du zwei Positionen an, eine nach Wohnfläche und eine nach Verbrauch, oder übernimmst die Werte aus der Abrechnung deines Messdienstleisters.
