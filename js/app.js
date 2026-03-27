const API_KEY = CONFIG.API_KEY;
const USE_DUMMY_COORDS = false;
const DUMMY_COORDS = { latitude: 52.0760895, longitude: 5.0941584 };

const STRINGS = {
  loading:          "Laden…",
  warning:          "Melding",
  noZone:           "Geen parkeerzone gevonden op deze locatie.",
  zoneLookupFailed: "Ophalen zone is niet gelukt.",
  rateFailed:       "Ophalen tarief is niet gelukt.",
  locationDenied:   "Toegang tot je lokatie geweigerd.",
  locationUnavail:  "Lokatie niet beschikbaar.",
  free:             "Gratis",
  retry:            "↻ Opnieuw proberen",
  pullRefresh:      "Vernieuwen",
};

document.getElementById('map').style.height = window.screen.height + 'px';
document.getElementById('time').textContent = STRINGS.loading;

let currentMarker = null;

const map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
  dragging: false,
  touchZoom: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
}).setView([52.0760895, 5.0941584], 16);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png").addTo(map);

function showError(msg, showRetry = false) {
  document.getElementById("card").classList.add("error");
  document.getElementById("zone").textContent = "";
  document.getElementById("price").textContent = "";
  document.getElementById("time").textContent = "";
  document.getElementById("errorTitle").textContent = STRINGS.warning;
  document.getElementById("errorMsg").textContent = msg;
  document.getElementById("retry-btn").hidden = !showRetry;
}

document.getElementById("retry-btn").textContent = STRINGS.retry;
document.getElementById("retry-btn").onclick = () => {
  document.getElementById("time").textContent = STRINGS.loading;
  getParking();
};

let isFetching = false;

async function getParking() {
  if (isFetching) return;
  isFetching = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const lat = USE_DUMMY_COORDS ? DUMMY_COORDS.latitude : USE_DUMMY_COORDS ? DUMMY_COORDS.latitude : pos.coords.latitude;
      const lng = USE_DUMMY_COORDS ? DUMMY_COORDS.longitude : USE_DUMMY_COORDS ? DUMMY_COORDS.longitude : pos.coords.longitude;
      map.setView([lat, lng], 16);
      if (currentMarker) currentMarker.remove();
      currentMarker = L.marker([lat, lng]).addTo(map);

      // First endpoint
      // console.time("fetch-zone");
      const zoneRes = await fetch(
        `https://cloud.prettigparkeren.nl/PrettigParkeren/v6/zoneBySector?lat=${lat}&lng=${lng}&api_key=${API_KEY}`
      );
      // console.timeEnd("fetch-zone");

      if (!zoneRes.ok) throw new Error(STRINGS.zoneLookupFailed);
      const zoneData = await zoneRes.json();

      const zonecode = zoneData.zonecode;
      if (!zonecode) {
        showError(STRINGS.noZone);
        return;
      }

      const zLat = zoneData.location.latitude;
      const zLng = zoneData.location.longitude;
      const country = zoneData.country_code;

      document.getElementById("card").classList.remove("error");
      document.getElementById("errorTitle").textContent = "";
      document.getElementById("errorMsg").textContent = "";
      document.getElementById("retry-btn").hidden = true;
      const zoneEl = document.getElementById("zone");
      const copyIcon = `<svg class="copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      zoneEl.innerHTML = `Zone <span class="zone-code">${zonecode}</span> ${copyIcon}`;
      zoneEl.onclick = () => {
        navigator.clipboard.writeText(zonecode);
        zoneEl.classList.add("copied");
        setTimeout(() => zoneEl.classList.remove("copied"), 500);
      };

      // Current time — ISO weekday: Mon=1 … Sun=7
      const now = new Date();
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      const h = now.getHours();
      const m = now.getMinutes();

      // Second endpoint
      const rateRes = await fetch(
        `https://cloud.prettigparkeren.nl/PrettigParkeren/v6/searchZoneSign?zonecode=${zonecode}&lat=${zLat}&lng=${zLng}&includeRates=1&wd=${wd}&h=${h}&m=${m}&country_code=${country}&api_key=${API_KEY}`
      );

      if (!rateRes.ok) throw new Error(STRINGS.rateFailed);
      const rateData = await rateRes.json();

      if (!rateData || !rateData.rates || !Array.isArray(rateData.rates)) {
        document.getElementById("price").textContent = "";
        document.getElementById("time").textContent = "";
        return;
      }

      const current = rateData.rates.find(r => r.is_current === "1");

      if (current) {
        const price = (parseInt(current.rate_1st_hour) / 100).toFixed(2);
        const start = formatTime(current.time_start);
        const end = formatTime(current.time_end);

        document.getElementById("price").textContent = "€" + price;
        document.getElementById("time").textContent = `${start} - ${end}`;
      } else {
        document.getElementById("price").textContent = STRINGS.free;
        document.getElementById("time").textContent = "";
      }
    } catch (err) {
      showError("Error: " + err.message, true);
    } finally {
      isFetching = false;
    }
  }, () => {
    isFetching = false;
    showError(STRINGS.locationUnavail);
  }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
}

function formatTime(t) {
  return t.slice(0,2) + ":" + t.slice(2);
}

async function start() {
  if (navigator.permissions) {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "denied") {
      showError(STRINGS.locationDenied);
      return;
    }
  }
  getParking();
}

start();

// Re-fetch when app comes to foreground
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    getParking();
  }
});

// Pull-to-refresh
let touchStartY = 0;
const PULL_THRESHOLD = 80;
const pullIndicator = document.getElementById("pull-indicator");
document.getElementById("pull-indicator-text").textContent = STRINGS.pullRefresh;

document.addEventListener("touchstart", (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  const pullDistance = e.touches[0].clientY - touchStartY;
  if (window.scrollY === 0 && pullDistance >= 20) {
    pullIndicator.classList.add("visible");
  }
}, { passive: true });

document.addEventListener("touchend", (e) => {
  pullIndicator.classList.remove("visible");
  const pullDistance = e.changedTouches[0].clientY - touchStartY;
  if (window.scrollY === 0 && pullDistance >= PULL_THRESHOLD) {
    getParking();
  }
}, { passive: true });