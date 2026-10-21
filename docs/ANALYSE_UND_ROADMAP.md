# Analyse, Zielmodell und Roadmap

Stand: Oktober 2026 · Grundlage: Projektbriefing „Intelligente Betriebskostenabrechnungs-App“ und Testfall WE 09

## 1. Bestandsaufnahme

### Tech-Stack und Architektur (beibehalten)

- React 18 + TypeScript + Vite, reine Browser-App ohne Server. Daten liegen in `localStorage`, Sicherung als JSON-Datei.
- Fachlogik ist von der Oberfläche getrennt und getestet (Vitest):
  - `src/lib/calc.ts`: Mieterabrechnung (Umlage, Zeitanteile, Leerstand, HeizkostenV, CO2KostAufG, § 35a)
  - `src/lib/finance.ts`: Rendite, Cashflow, AfA, Steuer-Schätzung
  - `src/lib/extract.ts`: Belegauslesen über die Claude API (strukturierte Ausgabe, Zod-Validierung)
  - `src/lib/model.ts`: Datenmodell-Fabriken und Migration älterer Speicherstände
- Die Trennung von Logik und Oberfläche ist die richtige Grundlage für die geforderte Modularität und bleibt erhalten.

### Was funktioniert

| Briefing | Stand |
|---|---|
| A – Objekte, Wohnungen, Mieter | ✅ mehrere Objekte und Einheiten, Mietzeiträume, Mietverlauf mit Vorauszahlungen (BK/HK getrennt), Personen, Kaution |
| D – Berechnung | ✅ Zeitraum, tagesgenaue Mieterwechsel, Leerstand beim Vermieter, Umlageschlüssel (Fläche, Personen, Einheiten, Verbrauch, direkt), HeizkostenV 50–70 %, CO2-Stufenmodell, § 35a, Frist § 556 Abs. 3 BGB |
| E – PDF | ✅ Anschreiben je Mieter über die Druckfunktion des Browsers mit nachvollziehbarer Berechnung |
| B – Import | ⚠️ teilweise: einzelne Rechnungen werden ausgelesen und als Positionen übernommen |
| I – Cashflow | ⚠️ teilweise: Rendite-Sicht mit Hausgeld-Anteilen, aber ohne Jahreshistorie |

### Was fehlt oder nur teilweise vorhanden ist

1. **Keine WEG-Ebene.** Hausgeld-Jahresabrechnung, Wirtschaftsplan und Mieterabrechnung sind nicht als getrennte Ebenen modelliert. Kosten werden direkt in die Mieterabrechnung getippt. Damit ist die zentrale Anforderung „drei Ebenen nie vermischen“ nicht technisch abgesichert.
2. **Keine dreistufige Klassifikation.** Es gibt nur „umlagefähiger Betrag“. Nicht umlagefähige Anteile werden beim Import verworfen statt dokumentiert, und einen Status „Prüfung erforderlich“ gibt es nicht. Eine Kontrollsumme gegen die Bewirtschaftungskosten ist nicht möglich.
3. **Keine Herkunft und kein Prüfstatus.** Positionen haben nur einen Dateinamen. Es fehlen Seite, Zeile, Originalbezeichnung, Konfidenz, Kennzeichnung „KI-Vorschlag / Regel / manuell“ und die Unterscheidung zwischen Original und Korrektur.
4. **Kein Entwurf/Freigabe.** Die App zeigt immer ein Ergebnis „Nachzahlung …“ an, auch wenn Ist-Kosten oder tatsächlich gezahlte Vorauszahlungen fehlen (verstößt gegen Testfall 5). Freigegebene Abrechnungen sind nicht eingefroren.
5. **Eigentumswohnung nicht sauber abgebildet.** Es fehlen Miteigentumsanteil (MEA), WEG-Kennzahlen (Einheiten, Gesamt-MEA, Gesamtfläche) und Hausverwaltung. § 556a Abs. 3 BGB (Umlage nach dem WEG-Schlüssel, wenn nichts anderes vereinbart ist) wird nicht ausdrücklich unterstützt.
6. **Heizkostenabrechnung des Messdienstes** kann nicht als Ganzes übernommen werden (Grund-/Verbrauchskosten Heizung und Warmwasser). Doppelte Erfassung (z. B. „Strom Wärmepumpe“ zusätzlich zur Heizkostenabrechnung) wird nicht erkannt.
7. **Mietvertrag fehlt als Prüfgrundlage**: welche Kostenarten vereinbart sind, „sonstige Betriebskosten“ namentlich, abweichender Umlageschlüssel.
8. **Wirtschaftsplan, Plan-Ist-Vergleich, Prognose, Vorauszahlungsempfehlung** (Module F–H) fehlen.
9. **Dokumentenarchiv** fehlt: Originale werden nicht gespeichert (`localStorage` ist dafür auch zu klein).

### Technische Schwachstellen

- **Geldbeträge als Gleitkommazahlen.** Jede Position wird pro Mieter einzeln gerundet. Die Mieteranteile ergeben deshalb nicht immer exakt den verteilten Gesamtbetrag (Cent-Differenzen werden nicht ausgewiesen).
- **Klassifikation nur durch die KI.** Es gibt kein deterministisches, testbares Regelwerk. KI-Vorschläge sind nicht von Prüfentscheidungen unterscheidbar.
- **API-Schlüssel im Browser.** Das ist für die lokale Einzelnutzung vertretbar. Für mehrere Vermieter braucht es später einen Server.
- **Fixe Kostenkategorien.** Rechtliche Sonderfälle (z. B. Kabel-TV seit 01.07.2024 nicht mehr umlagefähig) lassen sich nicht abbilden.

## 2. Fachliches Zielmodell

Die drei Ebenen werden als **getrennte Typen** modelliert. Eine Mieterabrechnung kann technisch nur Ist-Positionen übernehmen, nie Planwerte.

```
Objekt (Property) ── WEG-Daten: Verwaltung, Einheiten, Gesamt-MEA, Gesamtfläche
 └─ Wohnung (Unit) ── Fläche, MEA
     ├─ Mietverhältnis (Tenant) ── Zeitraum, Personen, Mietverlauf (Soll-Vorauszahlungen),
     │                              bestätigte Ist-Vorauszahlungen, Vertragsvereinbarung
     ├─ [A] WEG-Jahresabrechnung (WegAnnualStatement, Eigentümer ↔ WEG, Ist)
     │       ├─ Kennzahlen: Bewirtschaftungskosten Ist/Soll, Über-/Unterdeckung, Rücklagenzuführung
     │       ├─ Positionen (LedgerPosition) ── Originalbezeichnung, Anteil Wohnung, Gesamtbetrag,
     │       │       WEG-Schlüssel, BetrKV-Kategorie, Klassifikation (umlagefähig / nicht / prüfen),
     │       │       Begründung, Quelle (Dokument, Seite, Zeile), Konfidenz, Herkunft (Regel/KI/Nutzer),
     │       │       geprüft ja/nein, Originalwert bei Korrektur
     │       └─ Heizkostenabrechnung (HeatingBill) ── Komponenten, Verbrauch, enthaltene Energiekosten
     ├─ [C] Wirtschaftsplan (EconomicPlan, Prognose) ── Planpositionen, Hausgeld, Rücklage
     └─ [B] Mieterabrechnung (Statement, Vermieter ↔ Mieter)
             ├─ Kostenpositionen mit Verweis auf die Ist-Position (sourcePositionId)
             ├─ Status: Entwurf → freigegeben (eingefrorene Kopie der Ergebnisse)
             └─ Freigabe-Prüfung: offene Prüfpositionen, fehlende Ist-Kosten, unbestätigte Vorauszahlungen …
Quelldokument (SourceDocument) ── Typ, Jahr, Datei, Auslesestand
```

Grundregeln:

- Beträge werden intern in **Cent** gerechnet. Verteilungen nutzen das Verfahren der größten Reste, damit die Anteile exakt den Gesamtbetrag ergeben.
- **Klassifikation** kommt aus einem deterministischen Regelwerk (`classify.ts`) mit Begründung. KI und Nutzer können sie überschreiben, wobei Herkunft und Prüfstatus erhalten bleiben. Wartungspositionen, Dachwartung, Hauswart und Unbekanntes gehen standardmäßig auf „Prüfung erforderlich“.
- **Hausgeld-Über-/Unterdeckung und Rücklage** gehören nur zur Eigentümer-Ebene und werden nie in die Mieterabrechnung übernommen.
- **Heizkosten** kommen bei der Eigentumswohnung aus der Heizkostenabrechnung des Messdienstes (Wohnungsanteil). Energie- und Wartungskosten der Heizanlage (z. B. Strom Wärmepumpe, Wartung Heizung) sind darin enthalten und werden als Doppelerfassung erkannt.
- **Vermietetes Wohnungseigentum** (§ 556a Abs. 3 BGB): Ohne abweichende Vereinbarung gilt der WEG-Schlüssel. Der Wohnungsanteil aus der Einzelabrechnung wird deshalb direkt der Wohnung zugeordnet.

## 3. Roadmap

### Priorität 1 – zuverlässige Mieterabrechnung für die Eigentumswohnung (MVP)

| # | Aufgabe | Akzeptanztest |
|---|---|---|
| 1.1 | Geldrechnung in Cent mit exakter Verteilung (größte Reste) | Summe der Anteile = Gesamtbetrag |
| 1.2 | WEG-Ebene: Jahresabrechnung mit Positionen, Klassifikation, Herkunft, Prüfstatus, Kontrollsumme | TF 1, 4, 7 |
| 1.3 | Regelbasierte Klassifikation mit Begründung (BetrKV, Sonderfälle) | TF 7 |
| 1.4 | Heizkostenabrechnung als eigenes Objekt mit Komponentenprüfung und Erkennung doppelter Energiekosten | TF 2 |
| 1.5 | Übernahme geprüfter Ist-Positionen in die Mieterabrechnung (nie Planwerte), mit Duplikatschutz | TF 4, 6 |
| 1.6 | Entwurf/Freigabe mit Freigabe-Prüfung; Entwurfs-Wasserzeichen; eingefrorene Freigabe | TF 5 |
| 1.7 | WEG-Kennzahlen und MEA an Objekt und Wohnung | – |
| 1.8 | KI-Import für Jahres-/Einzelabrechnung mit Seite, Zeile, Konfidenz → Positionen zur Prüfung | – |
| 1.9 | Mietvertrag: vereinbarte Kostenarten; nicht vereinbarte Positionen werden nicht umgelegt | – |
| 1.10 | Tatsächlich gezahlte Vorauszahlungen je Monat erfassen und bestätigen | TF 5 |

### Priorität 2 – Wirtschaftsplan und Kostenanalyse

- 2.1 Wirtschaftsplan als eigene Ebene (Import, Hausgeld, Rücklage) – TF 3
- 2.2 Zuordnung Plan → Ist-Kategorien, Plan-Ist- und Vorjahresvergleich mit Erklärung der Treiber – TF 6
- 2.3 Prognose der umlagefähigen Kosten und der Nachzahlung (deutlich als Prognose gekennzeichnet)
- 2.4 Vorauszahlungsempfehlung (Hinweis auf die Voraussetzungen von § 560 Abs. 4 BGB)

### Priorität 3 – erweiterte Vermieterverwaltung

- Dokumentenarchiv (IndexedDB, später Server), Kostenhistorie über Jahre, Cashflow-Dashboard je Jahr, Auffälligkeitserkennung, mehrere Vermieter (Server, Konten, Verschlüsselung)

## 4. Umgesetzt in diesem Schritt

| Roadmap | Stand | Wo |
|---|---|---|
| 1.1 Cent-Arithmetik, exakte Verteilung | ✅ | `src/lib/money.ts`, `calc.ts` |
| 1.2 WEG-Jahresabrechnung mit Positionen, Herkunft, Prüfstatus, Kontrollsumme | ✅ | `src/lib/weg.ts`, `src/pages/WegEditor.tsx` |
| 1.3 Regelbasierte Klassifikation mit Begründung | ✅ | `src/lib/classify.ts` |
| 1.4 Heizkostenabrechnung, Erkennung doppelter Energiekosten | ✅ | `weg.ts` (`checkAnnual`), `WegEditor.tsx` |
| 1.5 Übernahme geprüfter Ist-Positionen, Duplikatschutz, Sperre für Planwerte | ✅ | `weg.ts` (`transferToStatement`) |
| 1.6 Entwurf/Freigabe, Freigabe-Prüfung, eingefrorene Freigabe, Entwurfs-Wasserzeichen | ✅ | `src/lib/release.ts`, `StatementEditor.tsx`, `PrintView.tsx` |
| 1.7 WEG-Kennzahlen und MEA | ✅ | `PropertyEditor.tsx` |
| 1.8 KI-Import Jahresabrechnung/Wirtschaftsplan mit Seite, Zeile, Konfidenz | ✅ (mit simulierter API-Antwort getestet) | `extract.ts`, `wegImport.ts`, `WegImport.tsx` |
| 1.9 Mietvertrag: vereinbarte Kostenarten, Umlagemaßstab, Fälligkeit | ✅ | `src/lib/lease.ts`, `Tenants.tsx` |
| 1.10 Vorauszahlungen bestätigen | ✅ einfache Form (Gesamtbetrag + Bestätigung) | `StatementEditor.tsx` |
| Mieterwechsel: Vermieter je Mieter, Vertragsmaßstab je Mieter, § 9b HeizkostenV | ✅ | `calc.ts`, `degreeDays.ts`, `Tenants.tsx` |
| Freigabe je Mietverhältnis (allgemeine und eigene Blocker, eingefrorenes Ergebnis je Mieter) | ✅ | `release.ts`, `StatementEditor.tsx`, `PrintView.tsx` |
| Erwerb per Kauf, Schenkung oder Erbschaft, Assistent für neue Objekte, monatliche Vermögensentwicklung | ✅ | `wealth.ts`, `PropertyWizard.tsx` |
| 2.1–2.4 Wirtschaftsplan, Plan-Ist, Prognose, Vorauszahlungsempfehlung | ✅ Grundversion | `weg.ts`, `WegEditor.tsx` |

### Akzeptanztests (automatisiert, `src/lib/we09.test.ts`)

| Testfall | Ergebnis |
|---|---|
| 1 – Jahresabrechnung 2024: 1.056,35 / 377,09 / 34,99 = 1.468,43 € | ✅ |
| 2 – Heizkosten 417,86 €, keine zusätzliche Umlage enthaltener Energiekosten | ✅ |
| 3 – Wirtschaftsplan 2025: 1.228,20 / 695,56 / 1.923,76 / 160,31 € | ✅ |
| 4 – Überdeckung 110,65 € ist kein Mieterguthaben, kein Doppelimport | ✅ |
| 5 – ohne Ist-Kosten 2025 und bestätigte Vorauszahlungen keine Freigabe | ✅ |
| 6 – Plan-Ist-Vergleich ja, Plan als Abrechnungsgrundlage nein | ✅ |
| 7 – Dachwartung und weitere unklare Positionen gehen auf „Prüfung erforderlich“ | ✅ |

Zusätzlich im Browser geprüft: Testfall WE 09 laden → Jahresabrechnung prüfen → Mieterabrechnung 2024 erstellen → Vorauszahlungen bestätigen → freigeben → PDF; Abrechnung 2025 ohne Ist-Daten zeigt die fehlenden Angaben; KI-Import mit simulierter Antwort.

### Abgleich mit den Originaldokumenten (Fotos, Oktober 2026)

Die Testwerte des Briefings wurden mit den Originalen nachgerechnet und stimmen. Zusätzlich ergaben die Originale:

| Erkenntnis | Umsetzung |
|---|---|
| Jeder Anteil der Einzelabrechnung ergibt sich exakt aus „Gesamt × Anteil ÷ Basis“ (MEA, WE, cbm). | Schlüsselbasis je Position; `checkKeyMath` rechnet jeden Anteil nach und erkennt Tipp- und Auslesefehler. |
| Die Gesamtkosten der WEG summieren sich auf 25.274,93 €. | Kontrollsumme auch über die Spalte „Gesamt“ (`buildingTotal`). |
| Die Heizkostenabrechnung enthält laut Kostenaufstellung nur Wärmestrom (8.375,41 €) und Heizungswartung (154,70 €). „Wartung Wohnungsstationen“ rechnet die WEG gesondert nach Wohneinheiten ab (2024: 0 €, Plan 2025: 56,36 €). | Kostenaufstellung der Heizkostenabrechnung (`includedCosts`). Heizungsbezogene Positionen gelten nur dann als enthalten, wenn sie dort stehen. Sonst muss der Vermieter sie ausdrücklich bewerten. |
| Gesamtheizkosten: 8.530,10 € (Einzelabrechnung) gegenüber 8.530,11 € (Heizkostenabrechnung). | Wird als Rundungsdifferenz ohne Auswirkung auf den Anteil ausgewiesen. |
| Wirtschaftsplan 2025: Rücklage 18,38 € + Kosten 141,94 € = 160,32 €, Hausgeld laut Plan 160,31 €. | Prüfung der monatlichen Aufteilung (`checkPlan`). |
| Wartung Dach 714 € umfasst Rechnungen vom 19.12.2023 und 28.11.2024, bezahlt 2025. | Bemerkungen aus dem Dokument je Position (`note`), werden bei prüfpflichtigen Positionen angezeigt. |
| Wasser und Abwasser verteilt die WEG im Ist nach Verbrauch (cbm), im Plan nach MEA. Die Treppenhausreinigung im Ist nach Gemeinschaftsflächen-Gruppen (alle/Bestand/Neubau je MEA: 21,32 € + 104,78 € = 126,10 €), im Plan nach MEA. | Erklärt Plan-Ist-Abweichungen. Das Anschreiben zeigt die Schlüsselbasis aus dem Dokument. |

Die Fotos enthalten Namen anderer Eigentümer und Kontonummern. Sie werden deshalb nicht im Repository gespeichert, der Testfall enthält nur die Beträge der WE 09.

### Mietvertrag WE 09 (Stand 10.07.2025)

| Vertragsinhalt | Folge in der App |
|---|---|
| Mietbeginn 01.08.2025, 1 Person | 2025 werden 153 von 365 Tagen abgerechnet. Den Rest des Jahres (Leerstand) trägt der Vermieter. Für die Heizkosten ist eine Zwischenablesung zum 01.08.2025 nötig (§ 9b HeizkostenV). |
| 480 € Nettokaltmiete + 20 € Stellplatz + 130 € Vorauszahlung für Betriebs- und Heizkosten (§ 3 Nr. 1) | Mietverlauf mit Zuschlag. Vorauszahlungen 2025: 5 × 130 € = 650 €. |
| § 2 Nr. 1–16 BetrKV vereinbart. Sonstige Betriebskosten namentlich: Schnee/Eis, Dachrinnenreinigung, Blitzschutz/Steigleitungen, Lüftung, Trockenleitungen, Elektro, Trinkwasserprüfung, Treppenhausreinigung (§ 3 Nr. 2–3) | Jede Position wird gegen die Vereinbarung geprüft. „Wartung Dach“ ist nur ähnlich vereinbart (Dachrinnenreinigung) und wird nur nach Bestätigung übernommen. Nicht vereinbarte sonstige Kosten werden ausgeschlossen. |
| Maßstab: Grundsteuer laut Einzelbescheid, sonst Verbrauch, im Übrigen Miteigentumsanteile (§ 6 Nr. 3) | Abweichende Vereinbarung im Sinne von § 556a Abs. 3 BGB. Positionen mit anderem WEG-Schlüssel werden auf MEA umgerechnet (Treppenhausreinigung 2024: 104,13 € statt 126,10 €). Heizkosten folgen der Heizkostenabrechnung. |
| Nachzahlung/Guthaben fällig bis Ende des Folgemonats (§ 6 Nr. 4) | Formulierung im Anschreiben. |

### 2025: Mieterwechsel zum 01.08.2025

Die Wohnung war durchgehend vermietet: an die Vormieterin bis 31.07.2025 (Vermieter: Vater des Eigentümers), ab 01.08.2025 an den neuen Mieter. Das bedeutet für die App:

| Anforderung | Umsetzung |
|---|---|
| Zwei Anschreiben mit unterschiedlichem Vermieter | Vermieter je Mietverhältnis (`Tenant.landlord`). Ohne Angaben ist keine Freigabe möglich. |
| Verschiedene Umlagemaßstäbe im selben Jahr | Kostenpositionen behalten den Anteil laut WEG und zusätzlich den Anteil je Vertragsmaßstab (`leaseAmounts`). Jeder Mieter trägt seinen Anteil nach seinem Vertrag; die Differenz trägt der Vermieter. |
| Nicht vereinbarte Kosten bei nur einem Mieter | Der Anteil dieses Mieters bleibt beim Vermieter und wird nicht auf den anderen umgelegt. |
| Heizkosten beim Nutzerwechsel (§ 9b HeizkostenV) | Bestandteile aus der Heizkostenabrechnung: Grundkosten nach Zeit. Verbrauch nach Zwischenablesung, sonst Heizung nach Gradtagzahlen (Jan–Jul 596,7 ‰, Aug–Dez 403,3 ‰) und Warmwasser nach Zeit. |
| Zählerstände zum Wechseltag (Übergabeprotokoll) | Stände je Zähler an Beginn, Wechsel und Ende. Die App errechnet den Verbrauch je Mieter für Heizung und Warmwasser und verteilt bei Kaltwasser-Ständen auch Wasser und Abwasser nach Verbrauch (§ 6 Nr. 3 Mietvertrag). |

### Grundsteuer WE 09

Der Feststellungsbescheid des Finanzamts vom 05.09.2025 nennt einen Grundsteuerwert von 112.200 € und eine Zurechnung an den neuen Eigentümer erst ab 01.01.2026 (bisher je ½ an die Eltern). Daraus folgt:

- Messbetrag = 112.200 € × 0,31 ‰ = 34,78 €. Mit dem Hebesatz für Wohngrundstücke in Heinsberg ab 2026 (559 %) ergibt sich eine geschätzte Grundsteuer von 194,42 € pro Jahr. Die App nutzt das nur als Plausibilitätsprüfung.
- Umgelegt wird der Jahresbetrag aus dem Grundsteuerbescheid der Stadt für 2025. Dieser ging an die bisherigen Eigentümer.
- Für Aug–Dez 2025 ist zu klären, ob der neue Eigentümer die Grundsteuer intern getragen hat. Nur dann kann er sie seinem Mieter berechnen.

Prognose 2025 aus dem Wirtschaftsplan: erwartete Kosten 495,73 € (1.182,62 € × 153/365) gegenüber 650 € Vorauszahlungen. Voraussichtlich also rund 154 € Guthaben, ohne Heizkosten-Saisoneffekt und ohne Grundsteuer.

### Nächste Schritte

1. **Zahlungseingänge (1.10 ausbauen):** monatliche Ist-Vorauszahlungen statt nur eines Jahresbetrags, optional per Kontoauszug-Import.
2. **Dokumentenarchiv:** Originale in IndexedDB speichern und Herkunftsangaben mit der Seite im Dokument verlinken.
3. **KI-Auslese mit echten Unterlagen testen:** die WE-09-Fotos 2024 mit API-Schlüssel einlesen und das Ergebnis mit `src/lib/fixtures/we09.ts` vergleichen (Genauigkeit messen).
4. **Grundsteuer und separat abgerechnete Kosten** (z. B. Müll) für Eigentumswohnungen: eigene Belege neben der WEG-Abrechnung.
