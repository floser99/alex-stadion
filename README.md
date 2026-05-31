# Fussballstadien in deiner Naehe

Statische Web-App, die die Teams aus 1. Bundesliga, 2. Bundesliga und 3. Liga 2025/26 aus OpenLigaDB laedt, mit lokalen Stadion-Geodaten zusammenfuehrt und nach Entfernung zum Browser-Standort sortiert.

## Starten

Die App braucht einen lokalen Webserver, weil `fetch()` bei direktem Oeffnen der Datei in vielen Browsern blockiert wird.

```powershell
python -m http.server 5173
```

Danach im Browser oeffnen:

```text
http://localhost:5173
```

## Technik

- Karte: Leaflet, Open-Source-JavaScript-Library
- Kartenkacheln: OpenStreetMap Standard-Tiles
- Teams: OpenLigaDB `bl1`, `bl2`, `bl3` ueber `https://api.openligadb.de/getavailableteams/{league}/2025`
- Standort: Browser Geolocation API, keine serverseitige Speicherung
- Fahrzeit-Demo: OSRM Demo-API `https://router.project-osrm.org`
- Stadion-Geodaten: `data/venue-mapping.json`
- Manuell pflegbare Stadiondetails: `data/stadium-details.json`
- Manuell pflegbare Spieldaten: `data/matches.json`

## Datenquellen und Hinweise

- Die 56 Teams kommen live aus OpenLigaDB.
- Stadionnamen, Kapazitaeten und Koordinaten bleiben lokal, weil OpenLigaDB diese Daten nicht vollstaendig als Venue-Geodaten liefert.
- Der Liga-Filter kann alle Teams, nur 1. Liga, nur 2. Liga oder nur 3. Liga anzeigen.
- Die Datumsauswahl filtert die lokal gepflegten Spiele ab dem gewaehlten Datum.
- Die Stadiondetails zeigen Adresse, Verein, Kapazitaet, Website, Ticketshop und kommende Spiele.
- OpenLigaDB ist als kostenlose Ergebnis-/Ligadaten-API geeignet und liefert Teams ohne API-Key.
- Die Fahrzeiten werden testweise ueber die oeffentliche OSRM Demo-API fuer maximal fuenf nahe Stadien geladen.
- Fuer produktiven Traffic sollten eigene oder kommerzielle OSM-kompatible Tiles genutzt werden. Die oeffentlichen OSM-Tiles sind fuer moderate Nutzung gedacht und benoetigen sichtbare Attribution.

## Naechste sinnvolle Ausbaustufen

- Saisonumschalter fuer `bl1/2024`, `bl1/2025` usw. ergaenzen.
- Login mit Favoriten und Merkliste fuer Spiele ergaenzen.
- Adminbereich fuer Stadien, Ticketshops und Spiele an die lokalen Datenstrukturen anbinden.
- Stadiondaten serverseitig cachen und regelmaessig mit OSM/Wikidata abgleichen.
