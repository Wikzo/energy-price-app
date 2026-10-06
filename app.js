const TIME_ZONE = "Europe/Copenhagen";
const API_BASE = "https://stromligning.dk/api/prices";

// TEMPORARY: two cities while moving from Aarhus to Vejle.
// When Aarhus is no longer needed, delete it from CITIES (and the toggle in index.html).
const CITIES = {
  aarhus: { label: "Aarhus", query: "productId=nrgi_time&supplierId=konstant_c&customerGroupId=c" },
  vejle: { label: "Vejle", query: "productId=altid-energi&supplierId=trefor_el-net_c&customerGroupId=c" },
};
const DEFAULT_CITY = "aarhus";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
});

const headerDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

function localDateKey(date) {
  return dateKeyFormatter.format(date);
}

function localHour(date) {
  return parseInt(hourFormatter.format(date), 10);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatHourRange(startHour, endHour) {
  return `${pad(startHour)}:00–${pad(endHour === 0 ? 24 : endHour)}:00`;
}

function formatPrice(value) {
  return `${value.toFixed(2)} kr`;
}

function formatTimeUntil(deltaHours, now) {
  const nowFractionMs = now.getUTCMinutes() * 60000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const msUntil = deltaHours * 3600000 - nowFractionMs;
  if (msUntil <= 0) return "now";
  const totalMinutes = Math.round(msUntil / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `in ${minutes}m`;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

function classifyTertiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    const rank = sorted.indexOf(v);
    if (rank < n / 3) return "cheap";
    if (rank < (2 * n) / 3) return "mid";
    return "expensive";
  });
}

function findCheapestWindow(hourlyPrices, windowSize, minStart = 0) {
  if (!hourlyPrices || hourlyPrices.length < windowSize) return null;
  let best = null;
  for (let start = minStart; start + windowSize <= hourlyPrices.length; start++) {
    const slice = hourlyPrices.slice(start, start + windowSize);
    const avg = slice.reduce((sum, v) => sum + v, 0) / windowSize;
    if (!best || avg < best.avg) {
      best = { start, end: start + windowSize, avg };
    }
  }
  return best;
}

function computeStats(hours) {
  let minHour = 0;
  let maxHour = 0;
  let sum = 0;
  hours.forEach((v, i) => {
    if (v < hours[minHour]) minHour = i;
    if (v > hours[maxHour]) maxHour = i;
    sum += v;
  });
  return {
    min: { hour: minHour, price: hours[minHour] },
    max: { hour: maxHour, price: hours[maxHour] },
    avg: sum / hours.length,
  };
}

async function fetchPrices(cityKey) {
  const now = new Date();
  const fromDate = new Date(now.getTime() - 24 * 3600 * 1000);
  fromDate.setUTCMinutes(0, 0, 0);
  const from = fromDate.toISOString();
  const to = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
  const url = `${API_BASE}?${CITIES[cityKey].query}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&aggregation=1h&aggregationMethod=mean`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API request failed with status ${res.status}`);
  }
  const data = await res.json();
  return data.prices || [];
}

function buildHourlyArray(entries, dateKey) {
  const hours = new Array(24).fill(null);
  for (const entry of entries) {
    const d = new Date(entry.date);
    if (localDateKey(d) !== dateKey) continue;
    const h = localHour(d);
    hours[h] = entry.price.total;
  }
  return hours;
}

function isComplete(hours) {
  return hours.every((v) => v !== null);
}

function renderStats(prefix, stats) {
  document.getElementById(`${prefix}-min-value`).textContent = formatPrice(stats.min.price);
  document.getElementById(`${prefix}-min-hour`).textContent = `kl. ${pad(stats.min.hour)}`;
  document.getElementById(`${prefix}-max-value`).textContent = formatPrice(stats.max.price);
  document.getElementById(`${prefix}-max-hour`).textContent = `kl. ${pad(stats.max.hour)}`;
  document.getElementById(`${prefix}-avg-value`).textContent = formatPrice(stats.avg);
}

function renderPriceList(listId, hours, colors, currentHour, cheapestWindow) {
  const list = document.getElementById(listId);
  list.innerHTML = "";
  const maxPrice = Math.max(...hours);

  hours.forEach((price, i) => {
    const row = document.createElement("div");
    row.className = "price-row";
    if (currentHour !== null && i === currentHour) row.classList.add("current-hour");
    if (cheapestWindow && i >= cheapestWindow.start && i < cheapestWindow.end) {
      row.classList.add("cheapest-window");
    }

    const hourEl = document.createElement("span");
    hourEl.className = "row-hour";
    hourEl.textContent = formatHourRange(i, i + 1);

    const priceEl = document.createElement("span");
    priceEl.className = "row-price";
    priceEl.textContent = formatPrice(price);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill ${colors[i]}`;
    fill.style.width = `${(price / maxPrice) * 100}%`;
    track.appendChild(fill);

    row.append(hourEl, priceEl, track);
    list.appendChild(row);
  });
}

function renderDay({ hours, listId, statsPrefix, currentHour, cheapestWindow }) {
  const colors = classifyTertiles(hours);
  const stats = computeStats(hours);

  renderStats(statsPrefix, stats);
  renderPriceList(listId, hours, colors, currentHour, cheapestWindow);
}

async function main() {
  const statusEl = document.getElementById("status-message");
  const currentDateEl = document.getElementById("current-date");

  const todaySection = document.getElementById("today-section");
  const tomorrowSection = document.getElementById("tomorrow-section");
  const tabToday = document.getElementById("tab-today");
  const tabTomorrow = document.getElementById("tab-tomorrow");
  const todayCheapBadge = document.getElementById("today-cheap-badge");
  const tomorrowCheapBadge = document.getElementById("tomorrow-cheap-badge");
  const resultEl = document.getElementById("cheapest-result");

  const MIN_WINDOW = 1;
  const MAX_WINDOW = 24;
  let windowSize = 1;
  let activeTab = "today";
  let activeCity = DEFAULT_CITY;

  const headingEl = document.getElementById("page-title");
  const cityButtons = document.querySelectorAll(".city-btn");

  const windowValueEl = document.getElementById("window-value");
  const decrementBtn = document.getElementById("window-decrement");
  const incrementBtn = document.getElementById("window-increment");

  let now, todayHours, tomorrowHours, currentHour, todayComplete, tomorrowComplete;

  function updateStepperButtons() {
    decrementBtn.disabled = windowSize <= MIN_WINDOW;
    incrementBtn.disabled = windowSize >= MAX_WINDOW;
  }

  function updateTabs() {
    todaySection.hidden = activeTab !== "today";
    tomorrowSection.hidden = activeTab !== "tomorrow";
    tabToday.classList.toggle("active", activeTab === "today");
    tabTomorrow.classList.toggle("active", activeTab === "tomorrow");
    tabToday.setAttribute("aria-selected", String(activeTab === "today"));
    tabTomorrow.setAttribute("aria-selected", String(activeTab === "tomorrow"));
  }

  function updateCity() {
    const label = CITIES[activeCity].label;
    headingEl.textContent = `Elpriser — ${label} (DK1)`;
    cityButtons.forEach((btn) => {
      const isActive = btn.dataset.city === activeCity;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateResult(windowResult, complete, deltaHoursToStart) {
    if (!complete) {
      resultEl.textContent = "";
    } else if (windowResult) {
      const timeUntil = formatTimeUntil(deltaHoursToStart, now);
      resultEl.textContent = "Cheapest ";
      const windowSizeEl = document.createElement("strong");
      windowSizeEl.textContent = `${windowSize}h`;
      resultEl.appendChild(windowSizeEl);
      resultEl.append(` in a row: ${formatHourRange(windowResult.start, windowResult.end)} (avg ${windowResult.avg.toFixed(2)} kr/kWh) `);
      const timeUntilEl = document.createElement("strong");
      timeUntilEl.className = "time-until";
      timeUntilEl.textContent = timeUntil;
      resultEl.appendChild(timeUntilEl);
    } else {
      resultEl.textContent = `Not enough hours left today for a ${windowSize}h window.`;
    }
  }

  function render() {
    now = new Date();
    windowValueEl.textContent = windowSize;
    updateStepperButtons();
    updateTabs();

    let todayWindow = null;
    if (todayComplete) {
      todayWindow = findCheapestWindow(todayHours, windowSize, currentHour);
      renderDay({
        hours: todayHours,
        listId: "today-list",
        statsPrefix: "today",
        currentHour,
        cheapestWindow: activeTab === "today" ? todayWindow : null,
      });
    }

    let tomorrowWindow = null;
    if (tomorrowComplete) {
      tomorrowWindow = findCheapestWindow(tomorrowHours, windowSize, 0);
      renderDay({
        hours: tomorrowHours,
        listId: "tomorrow-list",
        statsPrefix: "tomorrow",
        currentHour: null,
        cheapestWindow: activeTab === "tomorrow" ? tomorrowWindow : null,
      });
    }

    if (activeTab === "today") {
      updateResult(todayWindow, todayComplete, todayWindow ? todayWindow.start - currentHour : 0);
    } else {
      updateResult(tomorrowWindow, tomorrowComplete, tomorrowWindow ? 24 - currentHour + tomorrowWindow.start : 0);
    }
  }

  async function loadData() {
    statusEl.hidden = true;
    statusEl.classList.remove("error");

    let entries;
    try {
      entries = await fetchPrices(activeCity);
    } catch (err) {
      statusEl.hidden = false;
      statusEl.classList.add("error");
      statusEl.textContent = `Couldn't load prices: ${err.message}`;
      throw err;
    }

    now = new Date();
    currentDateEl.textContent = headerDateFormatter.format(now);
    const todayKey = localDateKey(now);
    const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 3600 * 1000));

    todayHours = buildHourlyArray(entries, todayKey);
    tomorrowHours = buildHourlyArray(entries, tomorrowKey);
    currentHour = localHour(now);

    todayComplete = isComplete(todayHours);
    tomorrowComplete = isComplete(tomorrowHours);

    if (!todayComplete) {
      statusEl.hidden = false;
      statusEl.classList.add("error");
      statusEl.textContent = "Today's prices are incomplete or unavailable.";
    }

    if (activeTab === "tomorrow" && !tomorrowComplete) {
      activeTab = "today";
    }
    tabTomorrow.disabled = !tomorrowComplete;

    todayCheapBadge.hidden = true;
    tomorrowCheapBadge.hidden = true;
    if (todayComplete && tomorrowComplete) {
      const todayFutureMin = Math.min(...todayHours.slice(currentHour));
      const tomorrowMin = Math.min(...tomorrowHours);
      todayCheapBadge.hidden = !(todayFutureMin < tomorrowMin);
      tomorrowCheapBadge.hidden = !(tomorrowMin < todayFutureMin);
    }
  }

  async function refresh() {
    try {
      await loadData();
    } catch {
      return; // error already surfaced via statusEl
    }
    render();
  }

  cityButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.city === activeCity) return;
      activeCity = btn.dataset.city;
      updateCity();
      refresh();
    });
  });

  decrementBtn.addEventListener("click", () => {
    if (windowSize > MIN_WINDOW) {
      windowSize--;
      render();
    }
  });

  incrementBtn.addEventListener("click", () => {
    if (windowSize < MAX_WINDOW) {
      windowSize++;
      render();
    }
  });

  tabToday.addEventListener("click", () => {
    activeTab = "today";
    render();
    refresh();
  });

  tabTomorrow.addEventListener("click", () => {
    activeTab = "tomorrow";
    render();
    refresh();
  });

  updateCity();
  await refresh();
}

main();
