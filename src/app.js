const DEFAULT_CENTER = [51.1657, 10.4515];
const DEFAULT_ZOOM = 6;
const OPENLIGADB_SEASON = 2025;
const LEAGUES = [
  { code: "bl1", label: "1. Liga", apiName: "1. Bundesliga" },
  { code: "bl2", label: "2. Liga", apiName: "2. Bundesliga" },
  { code: "bl3", label: "3. Liga", apiName: "3. Liga" },
];
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
const ROUTING_LIMIT = 5;
const SUGGESTION_LIMIT = 5;
const LOCAL_SUGGESTION_LIMIT = 3;
const SUGGESTION_MIN_LENGTH = 2;
const SUGGESTION_DEBOUNCE_MS = 350;

const state = {
  stadiums: [],
  matches: [],
  selectedLeague: "all",
  selectedDate: todayIsoDate(),
  userLocation: null,
  radiusKm: 250,
  suggestions: [],
  activeSuggestionIndex: -1,
  suggestionTimer: null,
  suggestionRequestId: 0,
  markers: new Map(),
  routes: new Map(),
  routeRequestId: 0,
  userMarker: null,
  radiusCircle: null,
};

const elements = {
  locateButton: document.querySelector("#locateButton"),
  resetButton: document.querySelector("#resetButton"),
  addressForm: document.querySelector("#addressForm"),
  addressInput: document.querySelector("#addressInput"),
  addressSuggestions: document.querySelector("#addressSuggestions"),
  dateInput: document.querySelector("#dateInput"),
  todayButton: document.querySelector("#todayButton"),
  leagueButtons: document.querySelectorAll("[data-league]"),
  currentLocation: document.querySelector("#currentLocation"),
  radiusInput: document.querySelector("#radiusInput"),
  radiusLabel: document.querySelector("#radiusLabel"),
  status: document.querySelector("#status"),
  list: document.querySelector("#stadiumList"),
  stadiumCount: document.querySelector("#stadiumCount"),
  matchList: document.querySelector("#matchList"),
  matchCount: document.querySelector("#matchCount"),
  resultTabs: document.querySelectorAll("[data-view]"),
  resultPanels: document.querySelectorAll("[data-panel]"),
  stadiumDetail: document.querySelector("#stadiumDetail"),
  stadiumDetailContent: document.querySelector("#stadiumDetailContent"),
  closeDetailButton: document.querySelector("#closeDetailButton"),
};

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const stadiumIcon = L.divIcon({
  className: "stadium-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const userIcon = L.divIcon({
  className: "user-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

map.whenReady(() => {
  window.setTimeout(() => map.invalidateSize(), 0);
});

window.addEventListener("resize", () => {
  map.invalidateSize();
});

init();

async function init() {
  try {
    elements.dateInput.value = state.selectedDate;
    setStatus("Teams werden aus OpenLigaDB geladen...");
    const [leagueTeamGroups, venues, details, openLigaMatches] = await Promise.all([
      Promise.all(LEAGUES.map(fetchOpenLigaTeams)),
      fetchVenueMapping(),
      fetchStadiumDetails(),
      fetchOpenLigaMatches(),
    ]);
    state.stadiums = mergeTeamsWithVenues(leagueTeamGroups.flat(), venues, details);
    state.matches = normalizeOpenLigaMatches(openLigaMatches, state.stadiums);
    addMarkers();
    render();
    fitAllStadiums();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function fetchOpenLigaTeams(league) {
  const response = await fetch(
    `https://api.openligadb.de/getavailableteams/${league.code}/${OPENLIGADB_SEASON}`,
  );
  if (!response.ok) {
    throw new Error(`${league.label} konnte nicht aus OpenLigaDB geladen werden.`);
  }

  const teams = await response.json();
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error(`OpenLigaDB hat keine Teams für ${league.label} geliefert.`);
  }

  return teams.map((team) => ({
    ...team,
    leagueCode: league.code,
    leagueLabel: league.label,
    leagueApiName: league.apiName,
  }));
}

async function fetchVenueMapping() {
  const response = await fetch("data/venue-mapping.json");
  if (!response.ok) {
    throw new Error("Lokale Stadion-Geodaten konnten nicht geladen werden.");
  }

  return response.json();
}

async function fetchStadiumDetails() {
  const response = await fetch("data/stadium-details.json");
  if (!response.ok) {
    throw new Error("Lokale Stadiondetails konnten nicht geladen werden.");
  }

  return response.json();
}

async function fetchMatches() {
  const response = await fetch("data/matches.json");
  if (!response.ok) {
    throw new Error("Lokale Spieldaten konnten nicht geladen werden.");
  }

  const matches = await response.json();
  if (!Array.isArray(matches)) return [];
  return matches;
}

async function fetchOpenLigaMatches() {
  try {
    const leagueMatches = await Promise.all(
      LEAGUES.map(async (league) => {
        const response = await fetch(
          `https://api.openligadb.de/getmatchdata/${league.code}/${OPENLIGADB_SEASON}`,
        );
        if (!response.ok) {
          throw new Error(`${league.label} Spielplan konnte nicht geladen werden.`);
        }
        const matches = await response.json();
        return Array.isArray(matches) ? matches : [];
      }),
    );

    return leagueMatches.flat();
  } catch (error) {
    console.warn("Live-Spielplan nicht erreichbar, lokale Spieldaten werden genutzt.", error);
    return fetchMatches();
  }
}

function normalizeOpenLigaMatches(matches, stadiums) {
  const stadiumByClub = new Map();
  stadiums.forEach((stadium) => {
    [stadium.club, stadium.shortName].forEach((name) => {
      const normalized = normalizeName(name);
      if (normalized) stadiumByClub.set(normalized, stadium);
    });
  });

  return matches
    .map((match) => {
      if (match.date && match.homeClub && match.stadium) return match;

      const homeClub = match.team1?.teamName || "";
      const stadium = stadiumByClub.get(normalizeName(homeClub));
      const matchDate = parseOpenLigaDate(match.matchDateTime || match.matchDateTimeUTC);
      if (!stadium || !matchDate) return null;

      return {
        id: String(match.matchID),
        date: matchDate.date,
        time: matchDate.time,
        competition: match.group?.groupName || match.leagueName || "Ligaspiel",
        homeClub,
        awayClub: match.team2?.teamName || "",
        stadium: stadium.stadium,
        ticketUrl: stadium.ticketUrl || "",
        status: match.matchIsFinished ? "beendet" : "geplant",
        leagueCode: match.leagueShortcut || stadium.leagueCode,
      };
    })
    .filter(Boolean);
}

function parseOpenLigaDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}

function mergeTeamsWithVenues(teams, venues, details) {
  const venueByTeam = new Map();
  const detailByStadium = new Map(
    details.map((detail) => [normalizeName(detail.stadium), detail]),
  );

  venues.forEach((venue) => {
    venue.teamNames.forEach((teamName) => {
      venueByTeam.set(normalizeName(teamName), venue);
    });
  });

  return teams
    .map((team) => {
      const venue =
        venueByTeam.get(normalizeName(team.teamName)) ||
        venueByTeam.get(normalizeName(team.shortName));

      if (!venue) return null;

      const detail = detailByStadium.get(normalizeName(venue.stadium)) || {};

      return {
        teamId: team.teamId,
        club: team.teamName,
        shortName: team.shortName,
        leagueCode: team.leagueCode,
        leagueLabel: team.leagueLabel,
        leagueApiName: team.leagueApiName,
        stadium: venue.stadium,
        city: venue.city,
        capacity: venue.capacity,
        lat: venue.lat,
        lng: venue.lng,
        address: detail.address || "",
        websiteUrl: detail.websiteUrl || "",
        ticketUrl: detail.ticketUrl || "",
        imageUrl: detail.imageUrl || "",
        notes: detail.notes || "Noch kein manueller Detailtext gepflegt.",
      };
    })
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addMarkers() {
  state.stadiums.forEach((stadium) => {
    const marker = L.marker([stadium.lat, stadium.lng], { icon: stadiumIcon })
      .addTo(map)
      .bindPopup(popupHtml(stadium));

    state.markers.set(stadium.stadium, marker);
  });
}

function render() {
  const stadiums = sortedStadiums();
  elements.list.replaceChildren(...stadiums.map(createStadiumItem));
  updateStadiumCount(stadiums);
  renderMatches(stadiums);
  updateMarkerVisibility(stadiums);
  updateRadiusUi();
  updateStatus(stadiums);
}

function updateStadiumCount(stadiums) {
  if (!elements.stadiumCount) return;
  const visibleCount = stadiums.filter(
    (stadium) => stadium.distanceKm === null || stadium.distanceKm <= state.radiusKm,
  ).length;
  elements.stadiumCount.textContent = String(visibleCount);
}

function sortedStadiums() {
  const withDistance = filteredStadiums().map((stadium) => ({
    ...stadium,
    distanceKm: state.userLocation
      ? distanceInKm(state.userLocation.lat, state.userLocation.lng, stadium.lat, stadium.lng)
      : null,
  }));

  return withDistance.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    return a.stadium.localeCompare(b.stadium, "de");
  });
}

function filteredStadiums() {
  if (state.selectedLeague === "all") return state.stadiums;
  return state.stadiums.filter((stadium) => stadium.leagueCode === state.selectedLeague);
}

function createStadiumItem(stadium) {
  const isOutsideRadius =
    stadium.distanceKm !== null && stadium.distanceKm > state.radiusKm;
  const route = state.routes.get(stadium.stadium);
  const nextMatch = nextMatchForStadium(stadium.stadium);

  const item = document.createElement("li");
  item.className = `stadium-card${isOutsideRadius ? " is-hidden" : ""}`;
  item.tabIndex = 0;
  item.innerHTML = `
    <header>
      <div class="club-line">
        <h2>${escapeHtml(stadium.stadium)}</h2>
        <div class="meta">${escapeHtml(stadium.club)}</div>
      </div>
      <span class="distance">${formatDistance(stadium.distanceKm)}</span>
    </header>
    <div class="meta">
      <span class="league-badge">${escapeHtml(stadium.leagueLabel)}</span>
      <span>${escapeHtml(stadium.city)}</span>
      <span>${stadium.capacity.toLocaleString("de-DE")} Plätze</span>
    </div>
    ${nextMatch ? `<div class="route-meta">Naechstes Spiel: ${formatMatchDate(nextMatch)} · ${escapeHtml(nextMatch.homeClub)} - ${escapeHtml(nextMatch.awayClub)}</div>` : ""}
    ${route ? `<div class="route-meta">Auto: ${formatDuration(route.durationSeconds)} · ${formatDrivingDistance(route.distanceMeters)}</div>` : ""}
    <div class="card-actions">
      <button class="small-button" type="button" data-action="details">Details</button>
      ${stadium.ticketUrl ? `<a class="text-link" href="${escapeHtml(stadium.ticketUrl)}" target="_blank" rel="noreferrer">Tickets</a>` : ""}
    </div>
  `;

  item.addEventListener("click", () => focusStadium(stadium));
  item.querySelector("[data-action='details']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openStadiumDetail(stadium);
  });
  item.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusStadium(stadium);
    }
  });

  return item;
}

function focusStadium(stadium) {
  const marker = state.markers.get(stadium.stadium);
  map.setView([stadium.lat, stadium.lng], 13);
  marker?.openPopup();
}

function openStadiumDetail(stadium) {
  const upcomingMatches = matchesForStadium(stadium.stadium).slice(0, 4);
  elements.stadiumDetailContent.innerHTML = `
    <article class="detail-content">
      <div class="detail-hero">
        <h2>${escapeHtml(stadium.stadium)}</h2>
        <p>${escapeHtml(stadium.club)} · ${escapeHtml(stadium.city)}</p>
      </div>
      <div class="detail-grid">
        <div class="detail-row">
          <span>Adresse</span>
          <strong>${escapeHtml(stadium.address || `${stadium.city}, Deutschland`)}</strong>
        </div>
        <div class="detail-row">
          <span>Kapazitaet</span>
          <strong>${stadium.capacity.toLocaleString("de-DE")} Plaetze</strong>
        </div>
        <div class="detail-row">
          <span>Liga</span>
          <strong>${escapeHtml(stadium.leagueLabel)}</strong>
        </div>
        <div class="detail-row">
          <span>Hinweis</span>
          <strong>${escapeHtml(stadium.notes)}</strong>
        </div>
      </div>
      <div class="detail-actions">
        ${stadium.ticketUrl ? `<a href="${escapeHtml(stadium.ticketUrl)}" target="_blank" rel="noreferrer">Ticketshop</a>` : ""}
        ${stadium.websiteUrl ? `<a href="${escapeHtml(stadium.websiteUrl)}" target="_blank" rel="noreferrer">Website</a>` : ""}
        <a href="https://www.openstreetmap.org/?mlat=${stadium.lat}&mlon=${stadium.lng}#map=15/${stadium.lat}/${stadium.lng}" target="_blank" rel="noreferrer">Karte</a>
      </div>
      <section class="match-section">
        <div class="section-heading">
          <h2>Spiele im Stadion</h2>
          <span>${upcomingMatches.length}</span>
        </div>
        <ol class="match-list">
          ${upcomingMatches.length > 0 ? upcomingMatches.map(matchHtml).join("") : '<li class="match-card">Keine Spiele ab dem gewaehlten Datum gepflegt.</li>'}
        </ol>
      </section>
    </article>
  `;
  elements.stadiumDetail.classList.add("is-open");
}

function closeStadiumDetail() {
  elements.stadiumDetail.classList.remove("is-open");
}

function renderMatches(stadiums) {
  const visibleStadiums = new Set(
    stadiums
      .filter((stadium) => stadium.distanceKm === null || stadium.distanceKm <= state.radiusKm)
      .map((stadium) => normalizeName(stadium.stadium)),
  );
  const matches = filteredMatches()
    .filter((match) => visibleStadiums.has(normalizeName(match.stadium)))
    .slice(0, 5);

  elements.matchCount.textContent = String(matches.length);
  if (matches.length === 0) {
    elements.matchList.innerHTML = '<li class="match-card">Keine passenden Spiele ab dem gewaehlten Datum gepflegt.</li>';
    return;
  }

  elements.matchList.innerHTML = matches.map(matchHtml).join("");
  elements.matchList.querySelectorAll("[data-stadium]").forEach((button) => {
    button.addEventListener("click", () => {
      const stadium = state.stadiums.find(
        (item) => normalizeName(item.stadium) === normalizeName(button.dataset.stadium),
      );
      if (!stadium) return;
      focusStadium(stadium);
      openStadiumDetail(stadium);
    });
  });
}

function matchHtml(match) {
  return `
    <li class="match-card">
      <header>
        <span class="match-title">${escapeHtml(match.homeClub)} - ${escapeHtml(match.awayClub)}</span>
        <span class="match-date">${formatMatchDate(match)}</span>
      </header>
      <div class="match-meta">
        <span>${escapeHtml(match.competition)}</span>
        <span>${escapeHtml(match.stadium)}</span>
        <span>${escapeHtml(match.status)}</span>
      </div>
      <div class="match-actions">
        <button class="small-button" type="button" data-stadium="${escapeHtml(match.stadium)}">Stadion</button>
        ${match.ticketUrl ? `<a class="text-link" href="${escapeHtml(match.ticketUrl)}" target="_blank" rel="noreferrer">Tickets</a>` : ""}
      </div>
    </li>
  `;
}

function filteredMatches() {
  const selectedDate = state.selectedDate || todayIsoDate();
  const activeStadiums = new Set(
    filteredStadiums().map((stadium) => normalizeName(stadium.stadium)),
  );

  return state.matches
    .filter((match) => match.date >= selectedDate)
    .filter((match) => activeStadiums.has(normalizeName(match.stadium)))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

function matchesForStadium(stadiumName) {
  return filteredMatches().filter(
    (match) => normalizeName(match.stadium) === normalizeName(stadiumName),
  );
}

function nextMatchForStadium(stadiumName) {
  return matchesForStadium(stadiumName)[0] || null;
}

function updateMarkerVisibility(stadiums) {
  const visibleStadiumNames = new Set(stadiums.map((stadium) => stadium.stadium));

  state.stadiums.forEach((stadium) => {
    const marker = state.markers.get(stadium.stadium);
    if (!marker) return;
    if (map.hasLayer(marker) && !visibleStadiumNames.has(stadium.stadium)) {
      marker.removeFrom(map);
    }
  });

  stadiums.forEach((stadium) => {
    const marker = state.markers.get(stadium.stadium);
    const shouldShow =
      stadium.distanceKm === null || stadium.distanceKm <= state.radiusKm;

    if (!marker) return;
    if (shouldShow && !map.hasLayer(marker)) marker.addTo(map);
    if (!shouldShow && map.hasLayer(marker)) marker.removeFrom(map);
  });
}

function updateRadiusUi() {
  elements.radiusLabel.textContent = `${state.radiusKm} km`;
}

function updateStatus(stadiums) {
  const leagueLabel = currentLeagueLabel();

  if (!state.userLocation) {
    setStatus(`${stadiums.length} Stadien · ${leagueLabel} · Standort noch nicht aktiv`);
    updateCurrentLocationLabel();
    return;
  }

  const visibleCount = stadiums.filter(
    (stadium) => stadium.distanceKm <= state.radiusKm,
  ).length;
  const nearest = stadiums[0];

  setStatus(
    `${visibleCount} Stadien im Radius · ${leagueLabel} · am nächsten: ${nearest.stadium} (${formatDistance(nearest.distanceKm)})`,
  );
  updateCurrentLocationLabel();
}

function currentLeagueLabel() {
  if (state.selectedLeague === "all") return "alle Ligen";
  return LEAGUES.find((league) => league.code === state.selectedLeague)?.label || "Auswahl";
}

async function updateRoutesForNearestStadiums() {
  if (!state.userLocation) return;

  const requestId = ++state.routeRequestId;
  state.routes.clear();
  render();

  const targets = sortedStadiums()
    .filter((stadium) => stadium.distanceKm !== null && stadium.distanceKm <= state.radiusKm)
    .slice(0, ROUTING_LIMIT);

  if (targets.length === 0) return;

  setStatus(`Fahrzeiten für die nächsten ${targets.length} Stadien werden geladen...`);

  const results = await Promise.allSettled(
    targets.map(async (stadium) => ({
      stadium,
      route: await fetchDrivingRoute(stadium),
    })),
  );

  if (requestId !== state.routeRequestId) return;

  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    state.routes.set(result.value.stadium.stadium, result.value.route);
  });

  render();
}

async function fetchDrivingRoute(stadium) {
  const from = `${state.userLocation.lng},${state.userLocation.lat}`;
  const to = `${stadium.lng},${stadium.lat}`;
  const params = new URLSearchParams({
    overview: "false",
    alternatives: "false",
    steps: "false",
  });

  const response = await fetch(`${OSRM_ROUTE_URL}/${from};${to}?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Fahrzeit konnte nicht geladen werden.");
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) {
    throw new Error("Keine Route gefunden.");
  }

  return {
    durationSeconds: route.duration,
    distanceMeters: route.distance,
  };
}

function setStatus(message, isError = false) {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function popupHtml(stadium) {
  return `
    <p class="popup-title">${escapeHtml(stadium.stadium)}</p>
    <p class="popup-meta">${escapeHtml(stadium.club)} · ${escapeHtml(stadium.leagueLabel)}<br>${escapeHtml(stadium.city)}<br>${stadium.capacity.toLocaleString("de-DE")} Plätze</p>
    <p class="popup-actions">
      ${stadium.ticketUrl ? `<a class="text-link" href="${escapeHtml(stadium.ticketUrl)}" target="_blank" rel="noreferrer">Tickets</a>` : ""}
      ${stadium.websiteUrl ? `<a class="text-link" href="${escapeHtml(stadium.websiteUrl)}" target="_blank" rel="noreferrer">Website</a>` : ""}
    </p>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDistance(distanceKm) {
  if (distanceKm === null) return "Standort fehlt";
  if (distanceKm < 10) return `${distanceKm.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(distanceKm)} km`;
}

function formatMatchDate(match) {
  const date = new Date(`${match.date}T${match.time || "00:00"}`);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function todayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDrivingDistance(distanceMeters) {
  const distanceKm = distanceMeters / 1000;
  if (distanceKm < 10) return `${distanceKm.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(distanceKm)} km`;
}

function formatDuration(durationSeconds) {
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function distanceInKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus("Dein Browser unterstützt keine Standortfreigabe.", true);
    return;
  }

  setStatus("Standort wird abgefragt...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      state.userLocation = {
        lat,
        lng,
        label: formatCoordinates(lat, lng),
      };
      drawUserLocation();
      render();
      fitVisibleMap();
      updateRoutesForNearestStadiums();

      try {
        const place = await reverseGeocode(lat, lng);
        state.userLocation.label = place.display_name || formatCoordinates(lat, lng);
      } catch {
        state.userLocation.label = `Dein Standort (${formatCoordinates(lat, lng)})`;
      }

      drawUserLocation();
      render();
    },
    () => {
      setStatus("Standort konnte nicht gelesen werden. Prüfe die Browser-Freigabe.", true);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    },
  );
}

async function searchAddress(event) {
  event.preventDefault();

  const query = elements.addressInput.value.trim();
  if (!query) {
    setStatus("Gib zuerst eine Adresse oder Stadt ein.", true);
    elements.addressInput.focus();
    return;
  }

  setStatus("Adresse wird gesucht...");

  try {
    const result =
      state.suggestions[state.activeSuggestionIndex] ||
      state.suggestions.find((suggestion) => suggestion.display_name === query) ||
      (await geocodeAddress(query));
    applyAddressResult(result);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function applyAddressResult(result) {
  const lat = Number(result.lat);
  const lng = Number(result.lon ?? result.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setStatus("Der ausgewÃ¤hlte Ort hat keine gÃ¼ltigen Koordinaten.", true);
    return;
  }

  state.userLocation = {
    lat,
    lng,
    label: result.display_name,
  };
  elements.addressInput.value = result.display_name;
  closeSuggestions();
  drawUserLocation();
  render();
  fitVisibleMap();
  updateRoutesForNearestStadiums();
}

async function geocodeAddress(query) {
  const queryVariants = createAddressQueryVariants(query);

  for (const variant of queryVariants) {
    const results = await searchNominatim(variant, 5);
    if (results.length > 0) return results[0];
  }

  throw new Error("Keine passende Adresse gefunden.");
}

async function fetchAddressSuggestions(query) {
  const queryVariants = createAddressQueryVariants(query).slice(0, 2);
  const remoteResults = [];

  for (const variant of queryVariants) {
    const results = await searchNominatim(variant, SUGGESTION_LIMIT);
    remoteResults.push(...results);
  }

  return remoteResults.map((suggestion) => ({
    ...suggestion,
    kind: "address",
    label: primaryPlaceLabel(suggestion.display_name),
    detail: secondaryPlaceLabel(suggestion.display_name),
  }));
}

async function searchNominatim(query, limit) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(limit),
    countrycodes: "de",
    addressdetails: "1",
    namedetails: "1",
    dedupe: "1",
    "accept-language": "de",
  });
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Adresssuche ist gerade nicht erreichbar.");
  }

  const results = await response.json();
  if (!Array.isArray(results)) return [];

  return results.filter(
    (result) => Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon)),
  );
}

function createAddressQueryVariants(query) {
  const trimmed = String(query || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return [];

  const variants = new Set([trimmed]);
  const lower = trimmed.toLowerCase();

  if (!/\bdeutschland\b/i.test(trimmed)) {
    variants.add(`${trimmed}, Deutschland`);
  }

  [
    trimmed.replace(/\bstr\./gi, "Straße"),
    trimmed.replace(/\bstr\b/gi, "Straße"),
    trimmed.replace(/\bstrasse\b/gi, "Straße"),
    trimmed.replace(/\bstraße\b/gi, "Strasse"),
  ].forEach((variant) => {
    if (!variant || variant.toLowerCase() === lower) return;
    variants.add(variant);
    if (!/\bdeutschland\b/i.test(variant)) variants.add(`${variant}, Deutschland`);
  });

  return Array.from(variants).slice(0, 6);
}

function handleAddressInput() {
  window.clearTimeout(state.suggestionTimer);
  const query = elements.addressInput.value.trim();

  if (query.length < SUGGESTION_MIN_LENGTH) {
    closeSuggestions();
    return;
  }

  state.suggestions = createLocalSuggestions(query);
  state.activeSuggestionIndex = -1;
  renderSuggestions();

  state.suggestionTimer = window.setTimeout(async () => {
    const requestId = ++state.suggestionRequestId;

    try {
      const remoteSuggestions = await fetchAddressSuggestions(query);
      if (requestId !== state.suggestionRequestId) return;

      state.suggestions = mergeSuggestions(createLocalSuggestions(query), remoteSuggestions);
      state.activeSuggestionIndex = -1;
      renderSuggestions();
    } catch {
      if (requestId !== state.suggestionRequestId) return;
      closeSuggestions();
    }
  }, SUGGESTION_DEBOUNCE_MS);
}

function renderSuggestions() {
  elements.addressSuggestions.replaceChildren();

  if (state.suggestions.length === 0) {
    closeSuggestions();
    return;
  }

  const options = state.suggestions.map((suggestion, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `addressSuggestion-${index}`;
    option.className = `suggestion-option${index === state.activeSuggestionIndex ? " is-active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === state.activeSuggestionIndex));
    option.innerHTML = `
      <span class="suggestion-kind">${escapeHtml(suggestionKindLabel(suggestion.kind))}</span>
      <span class="suggestion-text">
        <strong>${escapeHtml(suggestion.label || suggestion.display_name)}</strong>
        ${suggestion.detail ? `<small>${escapeHtml(suggestion.detail)}</small>` : ""}
      </span>
    `;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyAddressResult(suggestion);
    });
    return option;
  });

  elements.addressSuggestions.replaceChildren(...options);
  elements.addressSuggestions.classList.add("is-open");
  elements.addressInput.setAttribute("aria-expanded", "true");
}

function closeSuggestions() {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  elements.addressSuggestions.replaceChildren();
  elements.addressSuggestions.classList.remove("is-open");
  elements.addressInput.setAttribute("aria-expanded", "false");
  elements.addressInput.removeAttribute("aria-activedescendant");
}

function handleAddressKeydown(event) {
  if (!elements.addressSuggestions.classList.contains("is-open")) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex + 1) % state.suggestions.length;
    updateActiveSuggestion();
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.activeSuggestionIndex =
      (state.activeSuggestionIndex - 1 + state.suggestions.length) % state.suggestions.length;
    updateActiveSuggestion();
  }

  if (event.key === "Enter" && state.activeSuggestionIndex >= 0) {
    event.preventDefault();
    applyAddressResult(state.suggestions[state.activeSuggestionIndex]);
  }

  if (event.key === "Escape") {
    closeSuggestions();
  }
}

function createLocalSuggestions(query) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return [];

  const cityMatches = createCitySuggestions(normalizedQuery);
  const stadiumMatches = state.stadiums
    .filter((stadium) => {
      const fields = [stadium.stadium, stadium.club, stadium.shortName, stadium.city];
      return fields.some((field) => normalizeName(field).includes(normalizedQuery));
    })
    .slice(0, LOCAL_SUGGESTION_LIMIT)
    .map((stadium) => ({
      kind: "stadium",
      lat: String(stadium.lat),
      lon: String(stadium.lng),
      display_name: `${stadium.stadium}, ${stadium.city}`,
      label: stadium.stadium,
      detail: `${stadium.club} · ${stadium.city}`,
    }));

  return mergeSuggestions(cityMatches, stadiumMatches).slice(0, LOCAL_SUGGESTION_LIMIT);
}

function createCitySuggestions(normalizedQuery) {
  const cities = new Map();

  state.stadiums.forEach((stadium) => {
    const key = normalizeName(stadium.city);
    if (!key.includes(normalizedQuery)) return;

    const current = cities.get(key) || {
      kind: "city",
      city: stadium.city,
      latTotal: 0,
      lngTotal: 0,
      count: 0,
    };

    current.latTotal += stadium.lat;
    current.lngTotal += stadium.lng;
    current.count += 1;
    cities.set(key, current);
  });

  return Array.from(cities.values())
    .sort((a, b) => a.city.localeCompare(b.city, "de"))
    .slice(0, LOCAL_SUGGESTION_LIMIT)
    .map((city) => ({
      kind: "city",
      lat: String(city.latTotal / city.count),
      lon: String(city.lngTotal / city.count),
      display_name: `${city.city}, Deutschland`,
      label: city.city,
      detail: `${city.count} ${city.count === 1 ? "Stadion" : "Stadien"} in den Daten`,
    }));
}

function mergeSuggestions(...suggestionGroups) {
  const seen = new Set();
  const merged = [];

  suggestionGroups.flat().forEach((suggestion) => {
    const key = normalizeName(suggestion.display_name || `${suggestion.lat},${suggestion.lon}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(suggestion);
  });

  return merged.slice(0, SUGGESTION_LIMIT);
}

function suggestionKindLabel(kind) {
  if (kind === "city") return "Stadt";
  if (kind === "stadium") return "Stadion";
  return "Adresse";
}

function primaryPlaceLabel(displayName) {
  return String(displayName || "").split(",")[0]?.trim() || "Adresse";
}

function secondaryPlaceLabel(displayName) {
  const parts = String(displayName || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(1, 4).join(", ");
}

function updateActiveSuggestion() {
  Array.from(elements.addressSuggestions.children).forEach((option, index) => {
    const isActive = index === state.activeSuggestionIndex;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });

  if (state.activeSuggestionIndex >= 0) {
    const activeId = `addressSuggestion-${state.activeSuggestionIndex}`;
    elements.addressInput.setAttribute("aria-activedescendant", activeId);
    document.querySelector(`#${activeId}`)?.scrollIntoView({ block: "nearest" });
  }
}

async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    zoom: "14",
    addressdetails: "0",
  });
  const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Standortadresse konnte nicht gelesen werden.");
  }

  return response.json();
}

function updateCurrentLocationLabel() {
  elements.currentLocation.textContent = state.userLocation
    ? state.userLocation.label || formatCoordinates(state.userLocation.lat, state.userLocation.lng)
    : "Noch nicht gesetzt";
}

function formatCoordinates(lat, lng) {
  return `${lat.toFixed(5).replace(".", ",")}, ${lng.toFixed(5).replace(".", ",")}`;
}

function drawUserLocation() {
  const latLng = [state.userLocation.lat, state.userLocation.lng];
  const popupLabel = escapeHtml(state.userLocation.label || "Gewählter Standort");

  if (!state.userMarker) {
    state.userMarker = L.marker(latLng, { icon: userIcon })
      .addTo(map)
      .bindPopup(popupLabel);
  } else {
    state.userMarker.setLatLng(latLng);
    state.userMarker.setPopupContent(popupLabel);
  }

  if (!state.radiusCircle) {
    state.radiusCircle = L.circle(latLng, {
      radius: state.radiusKm * 1000,
      color: "#d71920",
      weight: 1,
      fillColor: "#d71920",
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    state.radiusCircle.setLatLng(latLng);
    state.radiusCircle.setRadius(state.radiusKm * 1000);
  }
}

function fitVisibleMap() {
  const visibleMarkers = sortedStadiums()
    .filter((stadium) => stadium.distanceKm === null || stadium.distanceKm <= state.radiusKm)
    .map((stadium) => [stadium.lat, stadium.lng]);

  if (state.userLocation) {
    visibleMarkers.push([state.userLocation.lat, state.userLocation.lng]);
  }

  if (visibleMarkers.length === 0) {
    map.setView([state.userLocation.lat, state.userLocation.lng], 8);
    return;
  }

  map.fitBounds(visibleMarkers, { padding: [48, 48], maxZoom: 12 });
}

function fitAllStadiums() {
  const stadiumBounds = filteredStadiums().map((stadium) => [stadium.lat, stadium.lng]);
  if (stadiumBounds.length === 0) return;

  map.fitBounds(stadiumBounds, { padding: [42, 42], maxZoom: 7 });
  window.setTimeout(() => map.invalidateSize(), 0);
}

function selectLeague(leagueCode) {
  state.selectedLeague = leagueCode;
  state.routes.clear();
  state.routeRequestId += 1;

  elements.leagueButtons.forEach((button) => {
    const isActive = button.dataset.league === leagueCode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  render();

  if (state.userLocation) {
    fitVisibleMap();
    updateRoutesForNearestStadiums();
  } else {
    fitAllStadiums();
  }
}

function resetMap() {
  state.userLocation = null;
  elements.addressInput.value = "";
  window.clearTimeout(state.suggestionTimer);
  closeSuggestions();
  state.routes.clear();
  state.routeRequestId += 1;

  if (state.userMarker) {
    state.userMarker.remove();
    state.userMarker = null;
  }

  if (state.radiusCircle) {
    state.radiusCircle.remove();
    state.radiusCircle = null;
  }

  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  render();
}

elements.locateButton.addEventListener("click", locateUser);
elements.resetButton.addEventListener("click", resetMap);
elements.addressForm.addEventListener("submit", searchAddress);
elements.addressInput.addEventListener("input", handleAddressInput);
elements.addressInput.addEventListener("keydown", handleAddressKeydown);
elements.addressInput.addEventListener("blur", () => {
  window.setTimeout(closeSuggestions, 120);
});
elements.dateInput.addEventListener("change", (event) => {
  state.selectedDate = event.target.value || todayIsoDate();
  render();
});
elements.todayButton.addEventListener("click", () => {
  state.selectedDate = todayIsoDate();
  elements.dateInput.value = state.selectedDate;
  render();
});
elements.closeDetailButton.addEventListener("click", closeStadiumDetail);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeStadiumDetail();
});
elements.resultTabs.forEach((button) => {
  button.addEventListener("click", () => {
    elements.resultTabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === button.dataset.view);
    });
    elements.resultPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === button.dataset.view);
    });
  });
});
elements.leagueButtons.forEach((button) => {
  button.addEventListener("click", () => selectLeague(button.dataset.league));
});
elements.radiusInput.addEventListener("input", (event) => {
  state.radiusKm = Number(event.target.value);
  if (state.radiusCircle) state.radiusCircle.setRadius(state.radiusKm * 1000);
  render();
  if (state.userLocation) {
    fitVisibleMap();
    updateRoutesForNearestStadiums();
  }
});
