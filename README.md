# Fußballstadien in deiner Nähe

Statische Web-App, die die Teams aus 1. Bundesliga, 2. Bundesliga und 3. Liga 2025/26 aus OpenLigaDB lädt, mit lokalen Stadion-Geodaten zusammenführt und nach Entfernung zum Browser-Standort sortiert.

## Starten

Die App braucht einen lokalen Webserver, weil `fetch()` bei direktem Öffnen der Datei in vielen Browsern blockiert wird.

```powershell
python -m http.server 5173
```

Danach im Browser öffnen:

```text
http://localhost:5173
```

## Technik

- Karte: Leaflet, Open-Source-JavaScript-Library
- Kartenkacheln: OpenStreetMap Standard-Tiles
- Teams: OpenLigaDB `bl1`, `bl2`, `bl3` über `https://api.openligadb.de/getavailableteams/{league}/2025`
- Standort: Browser Geolocation API, keine serverseitige Speicherung
- Fahrzeit-Demo: OSRM Demo-API `https://router.project-osrm.org`
- Stadion-Geodaten: `data/venue-mapping.json`

## Datenquellen und Hinweise

- Die 56 Teams kommen live aus OpenLigaDB.
- Stadionnamen, Kapazitäten und Koordinaten bleiben lokal, weil OpenLigaDB diese Daten nicht vollständig als Venue-Geodaten liefert.
- Der Liga-Filter kann alle Teams, nur 1. Liga, nur 2. Liga oder nur 3. Liga anzeigen.
- OpenLigaDB ist als kostenlose Ergebnis-/Ligadaten-API geeignet und liefert Teams ohne API-Key.
- Die Fahrzeiten werden testweise über die öffentliche OSRM Demo-API für maximal fünf nahe Stadien geladen.
- Für produktiven Traffic sollten eigene oder kommerzielle OSM-kompatible Tiles genutzt werden. Die öffentlichen OSM-Tiles sind für moderate Nutzung gedacht und benötigen sichtbare Attribution.

## Nächste sinnvolle Ausbaustufen

- Saisonumschalter für `bl1/2024`, `bl1/2025` usw. ergänzen.
- Geocoding über Nominatim oder Photon ergänzen, wenn Nutzer statt Standortfreigabe eine Stadt eingeben wollen.
- Stadiondaten serverseitig cachen und regelmäßig mit OSM/Wikidata abgleichen.
