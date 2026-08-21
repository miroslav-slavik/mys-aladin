/* Meteogram for a single location.

   The plot lives in one wide SVG inside a horizontal scroller, so all four
   panels always share the same time axis. The y-axis labels sit in a second,
   fixed SVG on top of the scroller: on a phone the chart is scrolled most of
   the time, and an axis that scrolls away is an axis nobody can read. */
"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

const HOUR_W = 15;
const PAD_L = 40;
const PAD_R = 14;
const PAD_T = 10;

const PANELS = {
  temp: { top: 24, height: 116 },
  rain: { top: 174, height: 72 },
  cloud: { top: 280, height: 26 },
  wind: { top: 340, height: 70 },
};
const ARROW_Y = PANELS.wind.top + PANELS.wind.height + 14;
const AXIS_Y = ARROW_Y + 14;
const SVG_H = AXIS_Y + 30;

const DAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];

const state = { series: [], fromCache: false };

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count) {
  const span = Math.max(max - min, 1e-6);
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || magnitude * 10;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

function hhmm(date) {
  return String(date.getHours()).padStart(2, "0") + ":00";
}

/* ---------- scales ---------- */

function linearPanel(panel, lo, hi) {
  const base = panel.top + panel.height;
  return { ...panel, base, scale: (v) => base - ((v - lo) / (hi - lo || 1)) * panel.height };
}

function buildScales(series) {
  const temps = series.map((row) => row.t2m);
  const tempTicks = niceTicks(Math.min(...temps), Math.max(...temps), 4);
  const temp = linearPanel(
    PANELS.temp,
    Math.min(...temps, tempTicks[0]),
    Math.max(...temps, tempTicks[tempTicks.length - 1])
  );

  const rainMax = Math.max(1, ...series.map((row) => row.precip_mm));
  const rainTicks = niceTicks(0, rainMax, 3);
  const rain = linearPanel(PANELS.rain, 0, Math.max(rainMax, rainTicks[rainTicks.length - 1]));

  const windMax = Math.max(2, ...series.map((row) => row.wind_ms));
  const windTicks = niceTicks(0, windMax, 2);
  const wind = linearPanel(PANELS.wind, 0, Math.max(windMax, windTicks[windTicks.length - 1]));

  return {
    temp: { ...temp, ticks: tempTicks, format: (t) => t.toFixed(0) },
    rain: { ...rain, ticks: rainTicks, format: (t) => (t > 0 && t < 1 ? t.toFixed(1) : t.toFixed(0)) },
    cloud: { ...PANELS.cloud },
    wind: { ...wind, ticks: windTicks, format: (t) => t.toFixed(0) },
  };
}

/* ---------- plot ---------- */

function drawPlot(series, scales) {
  const svg = document.getElementById("meteogram");
  svg.textContent = "";
  const width = PAD_L + series.length * HOUR_W + PAD_R;
  const right = PAD_L + series.length * HOUR_W;
  svg.setAttribute("width", width);
  svg.setAttribute("height", SVG_H);
  svg.setAttribute("viewBox", `0 0 ${width} ${SVG_H}`);
  const x = (index) => PAD_L + index * HOUR_W + HOUR_W / 2;

  drawNightBands(svg, series, x);
  for (const key of ["temp", "rain", "wind"]) {
    for (const tick of scales[key].ticks) {
      el("line", { class: "grid-line", x1: PAD_L, y1: scales[key].scale(tick), x2: right, y2: scales[key].scale(tick) }, svg);
    }
  }

  drawTemperature(svg, series, x, scales.temp);
  drawRain(svg, series, x, scales.rain, right);
  drawCloud(svg, series, x, scales.cloud);
  drawWind(svg, series, x, scales.wind, right);
  drawTimeAxis(svg, series, x, right);
  attachCursor(svg, series, x, width);
}

function drawNightBands(svg, series, x) {
  let start = null;
  series.forEach((row, index) => {
    const hour = row.date.getHours();
    const isNight = hour < 6 || hour >= 21;
    if (isNight && start === null) start = index;
    const last = index === series.length - 1;
    if ((!isNight || last) && start !== null) {
      const from = x(start) - HOUR_W / 2;
      const to = isNight && last ? x(index) + HOUR_W / 2 : x(index) - HOUR_W / 2;
      el("rect", { class: "night-band", x: from, y: PAD_T, width: Math.max(to - from, 0), height: AXIS_Y - PAD_T }, svg);
      start = null;
    }
  });
}

function drawTemperature(svg, series, x, panel) {
  const values = series.map((row) => row.t2m);
  const points = series.map((row, index) => `${x(index)},${panel.scale(row.t2m)}`).join(" ");
  el("polygon", {
    class: "temp-area",
    points: `${x(0)},${panel.base} ${points} ${x(series.length - 1)},${panel.base}`,
  }, svg);
  el("polyline", { class: "temp-line", points }, svg);

  // Direct labels for the extremes only; never a number on every point.
  const hottest = values.indexOf(Math.max(...values));
  const coldest = values.indexOf(Math.min(...values));
  for (const index of [hottest, coldest]) {
    el("circle", { class: "temp-dot", cx: x(index), cy: panel.scale(values[index]), r: 3 }, svg);
    el("text", {
      class: "value-label",
      x: x(index),
      y: panel.scale(values[index]) + (index === hottest ? -8 : 15),
      "text-anchor": "middle",
    }, svg).textContent = `${values[index].toFixed(1)}`;
  }
}

function drawRain(svg, series, x, panel, right) {
  el("line", { class: "axis-line", x1: PAD_L, y1: panel.base, x2: right, y2: panel.base }, svg);
  const barW = HOUR_W - 3; // leaves 3px of surface between neighbouring bars
  series.forEach((row, index) => {
    if (row.precip_mm <= 0) return;
    const height = Math.max(panel.base - panel.scale(row.precip_mm), 2);
    el("rect", {
      class: "rain-bar",
      x: x(index) - barW / 2, y: panel.base - height, width: barW, height,
      rx: Math.min(4, barW / 2), ry: Math.min(4, height / 2),
    }, svg);
  });
}

function drawCloud(svg, series, x, panel) {
  // Magnitude over time in a single row: one hue, more cloud is darker.
  series.forEach((row, index) => {
    const shade = Math.min(Math.max(row.cloud_pct / 100, 0), 1);
    el("rect", {
      x: x(index) - HOUR_W / 2 + 1, y: panel.top,
      width: HOUR_W - 2, height: panel.height,
      fill: `color-mix(in srgb, var(--cloud-1) ${Math.round(shade * 100)}%, var(--cloud-0))`,
    }, svg);
  });
  for (let index = 0; index < series.length; index += 6) {
    el("text", { class: "tick", x: x(index), y: panel.top + panel.height + 13, "text-anchor": "middle" }, svg)
      .textContent = String(series[index].cloud_pct);
  }
}

function drawWind(svg, series, x, panel, right) {
  el("line", { class: "axis-line", x1: PAD_L, y1: panel.base, x2: right, y2: panel.base }, svg);
  el("polyline", {
    class: "wind-line",
    points: series.map((row, index) => `${x(index)},${panel.scale(row.wind_ms)}`).join(" "),
  }, svg);

  // Direction is angular, so it gets arrows on their own row rather than a
  // second y scale. The arrow flies with the wind, away from where it comes from.
  for (let index = 1; index < series.length; index += 3) {
    const cx = x(index);
    const angle = ((series[index].wind_dir + 180) % 360) * (Math.PI / 180);
    const dx = Math.sin(angle) * 5;
    const dy = -Math.cos(angle) * 5;
    const group = el("g", { class: "wind-arrow" }, svg);
    el("line", { x1: cx - dx, y1: ARROW_Y - dy, x2: cx + dx, y2: ARROW_Y + dy }, group);
    el("polyline", {
      points: [
        `${cx + dx - dy * 0.45 - dx * 0.45},${ARROW_Y + dy + dx * 0.45 - dy * 0.45}`,
        `${cx + dx},${ARROW_Y + dy}`,
        `${cx + dx + dy * 0.45 - dx * 0.45},${ARROW_Y + dy - dx * 0.45 - dy * 0.45}`,
      ].join(" "),
    }, group);
  }
}

function drawTimeAxis(svg, series, x, right) {
  el("line", { class: "axis-line", x1: PAD_L, y1: AXIS_Y, x2: right, y2: AXIS_Y }, svg);
  series.forEach((row, index) => {
    const hour = row.date.getHours();
    if (hour % 6 !== 0) return;
    el("line", { class: "grid-line", x1: x(index), y1: AXIS_Y, x2: x(index), y2: AXIS_Y + 4 }, svg);
    el("text", { class: "tick", x: x(index), y: AXIS_Y + 15, "text-anchor": "middle" }, svg)
      .textContent = String(hour).padStart(2, "0");
    if (hour === 0) {
      el("text", { class: "day-label", x: x(index), y: AXIS_Y + 27, "text-anchor": "middle" }, svg)
        .textContent = `${DAYS[row.date.getDay()]} ${row.date.getDate()}.${row.date.getMonth() + 1}.`;
    }
  });
}

/* ---------- fixed axis overlay ---------- */

function drawAxis(scales) {
  const svg = document.getElementById("axis");
  svg.textContent = "";
  svg.setAttribute("width", PAD_L);
  svg.setAttribute("height", SVG_H);
  svg.setAttribute("viewBox", `0 0 ${PAD_L} ${SVG_H}`);
  el("rect", { class: "axis-backdrop", x: 0, y: 0, width: PAD_L, height: SVG_H }, svg);

  for (const key of ["temp", "rain", "wind"]) {
    for (const tick of scales[key].ticks) {
      el("text", {
        class: "tick", x: PAD_L - 5, y: scales[key].scale(tick) + 3, "text-anchor": "end",
      }, svg).textContent = scales[key].format(tick);
    }
  }
  el("text", { class: "tick", x: PAD_L - 5, y: scales.cloud.top + scales.cloud.height / 2 + 3, "text-anchor": "end" }, svg)
    .textContent = "%";
}

/* ---------- cursor and readout ---------- */

function attachCursor(svg, series, x, width) {
  const cursor = el("line", { class: "cursor-line", x1: 0, y1: PAD_T, x2: 0, y2: AXIS_Y, visibility: "hidden" }, svg);
  const readout = document.getElementById("readout");
  const hint = readout.dataset.hint;

  const show = (event) => {
    const rect = svg.getBoundingClientRect();
    const offset = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.min(series.length - 1, Math.max(0, Math.round((offset - PAD_L - HOUR_W / 2) / HOUR_W)));
    const row = series[index];
    cursor.setAttribute("visibility", "visible");
    cursor.setAttribute("x1", x(index));
    cursor.setAttribute("x2", x(index));
    readout.innerHTML =
      `<strong>${DAYS[row.date.getDay()]} ${hhmm(row.date)}</strong>` +
      `<span>${row.t2m.toFixed(1)} °C</span>` +
      `<span>${row.precip_mm.toFixed(1)} mm</span>` +
      `<span>${row.cloud_pct} %</span>` +
      `<span>${row.wind_ms.toFixed(1)} m/s</span>` +
      `<span>${row.wind_dir}°</span>`;
  };

  const hide = () => {
    cursor.setAttribute("visibility", "hidden");
    readout.textContent = hint;
  };

  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
  readout.textContent = hint;
}

/* ---------- table view ---------- */

function fillTable(series) {
  const body = document.querySelector("#dataTable tbody");
  body.textContent = "";
  let previousDay = null;
  for (const row of series) {
    const tr = document.createElement("tr");
    if (previousDay !== null && row.date.getDate() !== previousDay) tr.className = "day-start";
    previousDay = row.date.getDate();
    const cells = [
      `${DAYS[row.date.getDay()]} ${hhmm(row.date)}`,
      row.t2m.toFixed(1),
      row.precip_mm.toFixed(1),
      String(row.cloud_pct),
      `${row.wind_ms.toFixed(1)} · ${row.wind_dir}`,
    ];
    cells.forEach((text, column) => {
      const cell = document.createElement(column === 0 ? "th" : "td");
      if (column === 0) cell.scope = "row";
      cell.textContent = text;
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  }
}

/* ---------- data ---------- */

function formatMoment(iso) {
  return new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/* The badge says the forecast on screen may be older than the newest run. Being
   offline is the reliable signal: a cached fallback can also reach the page as
   an ordinary successful response, so the header alone would miss cases. */
function updateOfflineBadge() {
  document.getElementById("offline").hidden = navigator.onLine && !state.fromCache;
}

window.addEventListener("online", () => {
  updateOfflineBadge();
  load();
});
window.addEventListener("offline", updateOfflineBadge);

function render(forecast, fromCache) {
  const location = forecast.locations[0];
  state.series = location.series.map((row) => ({ ...row, date: new Date(row.time) }));
  const series = state.series;

  document.getElementById("place").textContent = location.name;
  document.getElementById("runline").textContent =
    `Běh modelu ${formatMoment(forecast.run_id)} · ${series.length} h předpovědi`;
  document.getElementById("updated").textContent = `Aktualizováno ${formatMoment(forecast.generated_at)}`;
  state.fromCache = fromCache;
  updateOfflineBadge();

  const total = series.reduce((sum, row) => sum + row.precip_mm, 0);
  document.getElementById("summary").textContent =
    `Srážky celkem ${total.toFixed(1)} mm · teplota ${Math.min(...series.map((r) => r.t2m)).toFixed(1)} až ` +
    `${Math.max(...series.map((r) => r.t2m)).toFixed(1)} °C`;

  const scales = buildScales(series);
  drawPlot(series, scales);
  drawAxis(scales);
  fillTable(series);

  // Open at the current hour rather than at the start of a run made hours ago.
  const now = Date.now();
  const index = series.findIndex((row) => row.date.getTime() >= now);
  if (index > 1) document.getElementById("scroller").scrollLeft = (index - 1) * HOUR_W;
}

async function load() {
  const url = "data/forecast.json";
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // The service worker marks a cached fallback, which still reaches us as a
    // successful response.
    render(await response.json(), response.headers.get("X-From-Cache") === "1");
  } catch (networkError) {
    const cached = await caches.match(url).catch(() => null);
    if (cached) {
      render(await cached.json(), true);
      return;
    }
    const box = document.getElementById("error");
    box.hidden = false;
    box.textContent = `Předpověď se nepodařilo načíst: ${networkError.message}`;
  }
}

document.getElementById("viewToggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const showTable = button.getAttribute("aria-pressed") === "false";
  button.setAttribute("aria-pressed", String(showTable));
  button.textContent = showTable ? "Graf" : "Tabulka";
  document.getElementById("chartView").hidden = showTable;
  document.getElementById("tableView").hidden = !showTable;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}

load();
