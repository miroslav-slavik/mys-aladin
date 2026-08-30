/* Meteogram modelled on aladinonline.oblacno.cz: a current-hour block, a row of
   hourly weather icons and one chart that switches between views. The whole
   72 hours fit the screen width, so nothing has to be scrolled to be seen. */
"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

// The vertical axes carry no numbers, so the gutters only keep the curve off
// the edge of the card. Values are read from the labelled extremes, from the
// header while the chart is touched, or from the table.
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 14;
const PLOT_H = 220;
const AXIS_H = 36;
const SVG_H = PAD_T + PLOT_H + AXIS_H;

const DAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];

/* The chart drops the tail of the forecast. Squeezing all 72 hours into the
   width of a phone leaves about four pixels per hour, which is too little to
   read; the last half day is also the least trustworthy part of the run. The
   table still lists every hour. */
const CHART_HOURS = 60;

const state = { series: [], view: "temperature", fromCache: false, generatedAt: 0 };

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
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/* The tooltip names the day rather than dating it: within the range of the
   chart "zítra" is read faster than a number. The chart can reach a fourth
   day, and the run can start before midnight, so the calendar form stays as
   the fallback. */
function dayWord(date) {
  const today = new Date();
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(date) - midnight(today)) / 864e5);
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  if (days === 2) return "pozítří";
  if (days === -1) return "včera";
  return `${DAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}.`;
}

function hhmm(date) {
  return String(date.getHours()).padStart(2, "0") + ":00";
}

/* ---------- smoothing ---------- */

/* Monotone cubic interpolation (Fritsch-Carlson). The reference draws a
   spline, and on hourly data a polyline reads as noisy steps - but a plain
   Catmull-Rom overshoots, which showed as cloud cover above 100 % and below
   zero. A monotone spline cannot leave the range of the data. */
function splinePath(points, close) {
  const n = points.length;
  if (n < 2) return "";
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = (ys[i + 1] - ys[i]) / (dx[i] || 1);
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  let d = `M ${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${xs[i] + h},${ys[i] + m[i] * h} ${xs[i + 1] - h},${ys[i + 1] - m[i + 1] * h} ${xs[i + 1]},${ys[i + 1]}`;
  }
  if (close) d += ` L ${xs[n - 1]},${close} L ${xs[0]},${close} Z`;
  return d;
}

/* ---------- weather icons ---------- */

function iconKind(row) {
  const day = row.date.getHours() >= 6 && row.date.getHours() < 21;
  if (row.precip_mm >= 0.2) return row.t2m <= 0.5 ? "snow" : "rain";
  if (row.cloud_pct >= 85) return "overcast";
  if (row.cloud_pct >= 35) return day ? "partly-day" : "partly-night";
  return day ? "clear-day" : "clear-night";
}

const SUN = "#eda100";
const MOON = "#c3c2b7";
const CLOUD = "#8f8e86";

function drawIcon(kind, size) {
  const svg = el("svg", { width: size, height: size, viewBox: "0 0 24 24" });
  const sun = (cx, cy, r) => {
    el("circle", { cx, cy, r, fill: SUN }, svg);
    for (let a = 0; a < 8; a++) {
      const t = (a * Math.PI) / 4;
      el("line", {
        x1: cx + Math.cos(t) * (r + 1.6), y1: cy + Math.sin(t) * (r + 1.6),
        x2: cx + Math.cos(t) * (r + 3.4), y2: cy + Math.sin(t) * (r + 3.4),
        stroke: SUN, "stroke-width": 1.6, "stroke-linecap": "round",
      }, svg);
    }
  };
  const moon = (cx, cy, r) => {
    const path = el("path", {
      d: `M ${cx + r * 0.5},${cy - r} a ${r},${r} 0 1,0 ${r * 0.75},${r * 1.7} a ${r * 0.95},${r * 0.95} 0 1,1 ${-r * 0.75},${-r * 1.7} Z`,
      fill: MOON,
    }, svg);
    return path;
  };
  const cloud = (dy, fill) => {
    el("path", {
      d: `M 6.5,${17 + dy} a 3.6,3.6 0 0,1 0.4,-7.2 a 4.6,4.6 0 0,1 8.7,-1.2 a 3.6,3.6 0 0,1 1.2,7 Z`,
      fill: fill || CLOUD,
    }, svg);
  };

  switch (kind) {
    case "clear-day": sun(12, 12, 4.6); break;
    case "clear-night": moon(12, 12, 5); break;
    case "partly-day": sun(15.5, 8, 3.4); cloud(0); break;
    case "partly-night": moon(15.5, 8, 3.6); cloud(0); break;
    case "overcast": cloud(0, "#6f6e68"); cloud(-3, CLOUD); break;
    case "rain":
      cloud(-2);
      for (const x of [8.5, 12, 15.5]) {
        el("line", { x1: x, y1: 17, x2: x - 1.2, y2: 21, stroke: "#3987e5", "stroke-width": 1.6, "stroke-linecap": "round" }, svg);
      }
      break;
    case "snow":
      cloud(-2);
      for (const x of [8.5, 12, 15.5]) {
        el("circle", { cx: x, cy: 19.5, r: 1.1, fill: "#c3c2b7" }, svg);
      }
      break;
  }
  return svg;
}

function drawIconRow(fullSeries) {
  // The icon row spans the same hours as the chart below it.
  const series = fullSeries.slice(0, CHART_HOURS);
  const row = document.getElementById("iconRow");
  row.textContent = "";
  const width = row.clientWidth || 340;
  // Big enough to read at a glance on a phone; the row then holds an icon
  // every six hours, which is close enough to follow the chart below.
  const size = 32;
  // Fit whole icons across the row; step up in whole hours so the marks stay
  // on a regular grid rather than drifting against the chart below.
  const fit = Math.max(4, Math.floor((width + 2) / (size + 2)));
  const step = Math.max(3, Math.ceil(series.length / fit));
  for (let i = 0; i < series.length; i += step) {
    row.appendChild(drawIcon(iconKind(series[i]), size));
  }
}

/* ---------- chart views ---------- */

const VIEWS = {
  temperature: {
    label: "Teplota",
    unit: "°C",
    value: (row) => row.t2m,
    color: "var(--temp-line)",
    fill: "var(--temp)",
    pad: [2, 4],
    withRain: true,
    format: (v) => v.toFixed(1),
  },
  wind: {
    label: "Vítr",
    unit: "m/s",
    value: (row) => row.wind_ms,
    color: "var(--wind)",
    fill: "var(--wind)",
    pad: [0, 2],
    zeroBased: true,
    arrows: true,
    format: (v) => v.toFixed(1),
  },
  clouds: {
    label: "Oblačnost",
    unit: "%",
    value: (row) => row.cloud_pct,
    color: "var(--cloud)",
    fill: "var(--cloud)",
    fixed: [0, 100],
    format: (v) => String(Math.round(v)),
  },
};

function drawChart(fullSeries, viewName) {
  const series = fullSeries.slice(0, CHART_HOURS);
  const view = VIEWS[viewName];
  const svg = document.getElementById("chart");
  svg.textContent = "";
  const width = Math.max(svg.clientWidth || 340, 240);
  svg.setAttribute("viewBox", `0 0 ${width} ${SVG_H}`);
  svg.setAttribute("height", SVG_H);

  const left = PAD_L;
  const right = width - PAD_R;
  const base = PAD_T + PLOT_H;
  const x = (i) => left + (i * (right - left)) / (series.length - 1);

  const values = series.map(view.value);
  let lo, hi;
  if (view.fixed) {
    [lo, hi] = view.fixed;
  } else if (view.zeroBased) {
    lo = 0;
    hi = Math.max(...values) + view.pad[1];
  } else {
    lo = Math.min(...values) - view.pad[0];
    hi = Math.max(...values) + view.pad[1];
  }
  const y = (v) => base - ((v - lo) / (hi - lo || 1)) * PLOT_H;

  drawNightBands(svg, series, x, base);

  for (const tick of niceTicks(lo, hi, 4)) {
    el("line", { class: "grid-line", x1: left, y1: y(tick), x2: right, y2: y(tick) }, svg);
  }

  const points = series.map((row, i) => [x(i), y(view.value(row))]);
  const areaFill = el("path", { d: splinePath(points, base), fill: view.fill, opacity: 0.55 }, svg);
  areaFill.setAttribute("stroke", "none");
  el("path", { d: splinePath(points, null), fill: "none", stroke: view.color, "stroke-width": 2 }, svg);

  if (view.withRain) drawRain(svg, series, x, base, right);
  if (view.arrows) drawArrows(svg, series, x, base);
  labelExtremes(svg, series, view, x, y);
  drawTimeAxis(svg, series, x, base, left, right);
  drawNow(svg, series, x, base);
  attachCursor(svg, series, x, width);
}

function drawNightBands(svg, series, x, base) {
  let start = null;
  series.forEach((row, i) => {
    const hour = row.date.getHours();
    const night = hour < 6 || hour >= 21;
    if (night && start === null) start = i;
    const last = i === series.length - 1;
    if ((!night || last) && start !== null) {
      const from = x(start);
      const to = x(i);
      el("rect", { class: "night-band", x: from, y: PAD_T, width: Math.max(to - from, 0), height: base - PAD_T }, svg);
      start = null;
    }
  });
}

/* Precipitation keeps its own labelled scale on the right: sharing the
   temperature scale would make the columns unreadable as millimetres. */
function drawRain(svg, series, x, base, right) {
  const max = Math.max(1, ...series.map((r) => r.precip_mm));
  const ticks = niceTicks(0, max, 3).filter((t) => t > 0);
  const top = Math.max(max, ticks[ticks.length - 1] || max);
  const height = PLOT_H * 0.55;
  const scale = (v) => (v / top) * height;
  const spacing = (x(1) - x(0)) || 4;
  const barW = Math.max(1.5, spacing * 0.62);

  series.forEach((row, i) => {
    if (row.precip_mm <= 0) return;
    const h = Math.max(scale(row.precip_mm), 1.5);
    el("rect", { class: "rain-bar", x: x(i) - barW / 2, y: base - h, width: barW, height: h, rx: Math.min(1.5, barW / 2) }, svg);
  });

}

function drawArrows(svg, series, x, base) {
  const step = Math.max(3, Math.round(series.length / 16));
  for (let i = 1; i < series.length; i += step) {
    const cx = x(i);
    const cy = base - 12;
    const angle = ((series[i].wind_dir + 180) % 360) * (Math.PI / 180);
    const dx = Math.sin(angle) * 4.5;
    const dy = -Math.cos(angle) * 4.5;
    const g = el("g", { class: "wind-arrow" }, svg);
    el("line", { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy }, g);
    el("polyline", {
      points: [
        `${cx + dx - dy * 0.5 - dx * 0.5},${cy + dy + dx * 0.5 - dy * 0.5}`,
        `${cx + dx},${cy + dy}`,
        `${cx + dx + dy * 0.5 - dx * 0.5},${cy + dy - dx * 0.5 - dy * 0.5}`,
      ].join(" "),
    }, g);
  }
}

/* Local extremes get a direct label, as in the reference; a number on every
   point would be unreadable at this density. */
function labelExtremes(svg, series, view, x, y) {
  const values = series.map(view.value);
  const window = 3;
  const found = [];
  for (let i = window; i < values.length - window; i++) {
    const slice = values.slice(i - window, i + window + 1);
    const isMax = values[i] === Math.max(...slice);
    const isMin = values[i] === Math.min(...slice);
    if (!isMax && !isMin) continue;
    found.push({ index: i, value: values[i], isMax });
  }

  // Label the most pronounced extremes first, then fill in while there is room.
  // Left-to-right greedy would spend the space on a mild early bump and drop
  // the day's peak.
  const middle = (Math.min(...values) + Math.max(...values)) / 2;
  found.sort((a, b) => Math.abs(b.value - middle) - Math.abs(a.value - middle));

  // Where the forecast starts is worth a number of its own, so the first point
  // is labelled before the extremes compete for the remaining room.
  const placed = [{
    index: 0,
    value: values[0],
    isMax: values[0] >= values[1],
    anchor: "start",
  }];
  for (const point of found) {
    if (placed.length >= 5) break;
    // Labels are spaced in pixels, not in hours: at this density two extremes
    // six hours apart still print on top of each other.
    if (placed.some((other) => Math.abs(x(point.index) - x(other.index)) < 62)) continue;
    placed.push(point);
  }

  for (const point of placed) {
    const top = PAD_T + 10;
    const bottom = PAD_T + PLOT_H - 4;
    // A peak that touches the top of the plot has no room above it, so its
    // label drops below the curve rather than printing over it.
    const above = point.isMax && y(point.value) - 7 >= top;
    const below = !point.isMax && y(point.value) + 14 <= bottom;
    const offset = above ? -7 : below ? 14 : point.isMax ? 14 : -7;
    const anchor = point.anchor || "middle";
    const x0 = anchor === "start"
      ? x(point.index) + 2
      : Math.min(Math.max(x(point.index), PAD_L + 24), x(series.length - 1) - 24);
    el("text", {
      class: "value-label",
      x: x0,
      y: Math.min(Math.max(y(point.value) + offset, top), bottom),
      "text-anchor": anchor,
    }, svg).textContent = `${view.format(point.value)} ${view.unit}`;
  }
}

function drawTimeAxis(svg, series, x, base, left, right) {
  el("line", { class: "axis-line", x1: left, y1: base, x2: right, y2: base }, svg);
  series.forEach((row, i) => {
    const hour = row.date.getHours();
    if (hour % 6 !== 0) return;
    el("line", { class: "grid-line", x1: x(i), y1: PAD_T, x2: x(i), y2: base + 4 }, svg);
    el("text", { class: "tick", x: x(i), y: base + 15, "text-anchor": "middle" }, svg)
      .textContent = String(hour).padStart(2, "0");
    if (hour === 0) {
      // Now that the plot runs to the edge of the card, a midnight close to the
      // right border would push its day name outside the SVG.
      const nearRight = x(i) > right - 46;
      const nearLeft = x(i) < left + 46;
      el("text", {
        class: "day-label",
        x: nearRight ? right : nearLeft ? left : x(i),
        y: base + 27,
        "text-anchor": nearRight ? "end" : nearLeft ? "start" : "middle",
      }, svg).textContent = `${DAYS[row.date.getDay()]} ${row.date.getDate()}.${row.date.getMonth() + 1}.`;
    }
  });
}

function drawNow(svg, series, x, base) {
  const now = Date.now();
  const first = series[0].date.getTime();
  const last = series[series.length - 1].date.getTime();
  if (now < first || now > last) return;
  const position = ((now - first) / (last - first)) * (series.length - 1);
  el("line", { class: "now-line", x1: x(position), y1: PAD_T, x2: x(position), y2: base }, svg);
  el("text", { class: "now-label", x: x(position) + 3, y: PAD_T + 8 }, svg).textContent = "teď";
}

/* ---------- cursor ---------- */

/* Touching the chart moves the reading in the header block to the hour under
   the finger, so the values stay in the one place the eye already knows. The
   tooltip by the line only carries the date and time; lifting the finger puts
   the header back on the current hour. */
function attachCursor(svg, series, x, width) {
  const base = PAD_T + PLOT_H;
  const cursor = el("line", { class: "cursor-line", x1: 0, y1: PAD_T, x2: 0, y2: base, visibility: "hidden" }, svg);
  const tip = el("g", { class: "tip", visibility: "hidden" }, svg);
  const box = el("rect", { class: "tip-box", rx: 6, ry: 6 }, tip);
  const dayText = el("text", { class: "tip-day", x: 0, y: 0 }, tip);
  const timeText = el("text", { class: "tip-time", x: 0, y: 0 }, tip);

  const placeTip = (row, cx) => {
    dayText.textContent = dayWord(row.date);
    timeText.textContent = hhmm(row.date);
    const w = Math.max(dayText.getComputedTextLength(), timeText.getComputedTextLength()) + 16;
    const h = 42;
    const left = cx + 8 + w > width - 2 ? cx - 8 - w : cx + 8;
    const top = PAD_T + 2;
    box.setAttribute("x", left);
    box.setAttribute("y", top);
    box.setAttribute("width", w);
    box.setAttribute("height", h);
    dayText.setAttribute("x", left + 8);
    dayText.setAttribute("y", top + 16);
    timeText.setAttribute("x", left + 8);
    timeText.setAttribute("y", top + 34);
    tip.setAttribute("visibility", "visible");
  };

  const show = (event) => {
    const rect = svg.getBoundingClientRect();
    const offset = ((event.clientX - rect.left) / rect.width) * width;
    const spacing = (x(1) - x(0)) || 1;
    const index = Math.min(series.length - 1, Math.max(0, Math.round((offset - x(0)) / spacing)));
    const row = series[index];
    cursor.setAttribute("visibility", "visible");
    cursor.setAttribute("x1", x(index));
    cursor.setAttribute("x2", x(index));
    placeTip(row, x(index));
    showHeader(row);
  };

  const hide = () => {
    cursor.setAttribute("visibility", "hidden");
    tip.setAttribute("visibility", "hidden");
    renderNow(state.series);
  };

  /* The finger rarely travels along a straight line, and a drift upwards or
     downwards used to end the reading: the browser read it as a page scroll,
     took the gesture away and cancelled the pointer. The chart therefore
     claims the whole gesture (touch-action: none in the stylesheet) and
     captures the pointer, so only lifting the finger ends the reading. Just
     the horizontal position is read, so vertical movement changes nothing. */
  let held = null;

  const grab = (event) => {
    held = event.pointerId;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (ignored) {
      // Capture is a convenience; without it the reading still works inside
      // the chart.
    }
    show(event);
  };

  const release = (event) => {
    if (held === null) return;
    if (event.pointerId !== held) return;
    try {
      svg.releasePointerCapture(held);
    } catch (ignored) {
      // Already released, which is exactly the state we want.
    }
    held = null;
    hide();
  };

  svg.addEventListener("pointerdown", grab);
  svg.addEventListener("pointermove", (event) => {
    if (held === null || event.pointerId === held) show(event);
  });
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  // Only a hovering mouse leaves; a held pointer keeps the reading alive.
  svg.addEventListener("pointerleave", () => {
    if (held === null) hide();
  });
}

/* ---------- current hour, table ---------- */

function currentRow(series) {
  const now = Date.now();
  return series.find((row) => row.date.getTime() >= now) || series[0];
}

/* The header shows one hour: the current one, or the one under the finger
   while the chart is being touched. */
function showHeader(row) {
  document.getElementById("nowTemp").textContent = `${row.t2m.toFixed(1)} °C`;
  document.getElementById("nowRain").textContent = `${row.precip_mm.toFixed(1)} mm/h`;
  document.getElementById("nowWind").textContent = `${row.wind_ms.toFixed(1)} m/s`;
  document.getElementById("nowCloud").textContent = `${row.cloud_pct} %`;
  const today = new Date().getDate() === row.date.getDate();
  document.getElementById("when").textContent =
    `${today ? "Dnes" : DAYS[row.date.getDay()]} ${hhmm(row.date)}`;
}

function renderNow(series) {
  showHeader(currentRow(series));
}

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

/* ---------- views ---------- */

function selectView(name) {
  state.view = name;
  for (const button of document.querySelectorAll("#views button")) {
    button.classList.toggle("is-active", button.dataset.view === name);
  }
  const table = name === "table";
  document.getElementById("chartView").hidden = table;
  document.getElementById("tableView").hidden = !table;
  if (!table && state.series.length) drawChart(state.series, name);
}

document.getElementById("views").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) selectView(button.dataset.view);
});

/* ---------- data ---------- */

function formatMoment(iso) {
  return new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/* The age of the forecast is always on screen; the badge only marks it as too
   old to trust. Age is the honest signal: navigator.onLine misreports in some
   environments, and a cached response can reach the page looking fresh. */
function formatAge(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${Math.round(hours)} h`;
  return `${Math.floor(hours / 24)} d ${Math.round(hours % 24)} h`;
}

function updateAge() {
  if (!state.generatedAt) return;
  const hours = (Date.now() - state.generatedAt) / 3600e3;
  document.getElementById("age").textContent = formatAge(hours);
  document.getElementById("offline").hidden = !(state.fromCache || hours > 6);
}

function render(forecast, fromCache) {
  const location = forecast.locations[0];
  state.series = location.series.map((row) => ({ ...row, date: new Date(row.time) }));
  state.fromCache = fromCache;
  state.generatedAt = Date.parse(forecast.generated_at);

  document.getElementById("place").textContent = location.label || location.name;
  document.getElementById("runline").textContent =
    `Běh modelu ${formatMoment(forecast.run_id)}, aktualizováno ${formatMoment(forecast.generated_at)}`;
  updateAge();

  renderNow(state.series);
  drawIconRow(state.series);
  fillTable(state.series);
  selectView(state.view);
}

async function load(force = false) {
  // The cache buster is for the CDN in front of Pages: without it a forced
  // reload can be answered with the very copy the user is trying to replace.
  const url = force ? `data/forecast.json?t=${Date.now()}` : "data/forecast.json";
  try {
    const response = await fetch(url, { cache: force ? "reload" : "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json(), response.headers.get("X-From-Cache") === "1");
  } catch (networkError) {
    const cached = await caches.match("data/forecast.json").catch(() => null);
    if (cached) {
      render(await cached.json(), true);
      return;
    }
    const box = document.getElementById("error");
    box.hidden = false;
    box.textContent = `Předpověď se nepodařilo načíst: ${networkError.message}`;
  }
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.series.length) return;
    drawIconRow(state.series);
    if (state.view !== "table") drawChart(state.series, state.view);
  }, 150);
});

window.addEventListener("online", () => load());
window.addEventListener("offline", updateAge);

// The age creeps up while the app sits open on the home screen.
setInterval(updateAge, 60e3);

/* The shell is served from the cache, so a new version of the app reaches the
   screen only once a new service worker takes over. Left to itself that takes
   two openings: the first one installs the update in the background and keeps
   showing the old page. So ask for the update on every opening and reload the
   page as soon as the new worker takes control. */
let registration = null;
let reloading = false;

function watchForUpdates() {
  if (!("serviceWorker" in navigator)) return;
  const controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // On the very first visit the worker takes control of a page that is
    // already the current version; only a replacement is worth a reload.
    if (!controlled || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    registration = reg;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  }).catch(() => {});
}

window.addEventListener("load", watchForUpdates);

load();

const refreshButton = document.getElementById("refresh");
refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.classList.add("is-busy");
  try {
    // The button means "give me the newest of everything", the app itself
    // included, not just the newest forecast.
    if (registration) await registration.update().catch(() => {});
    await load(true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-busy");
  }
});
