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

const state = {
  series: [],
  view: "temperature",
  fromCache: false,
  generatedAt: 0,
  forecast: null,
  /* The place on screen. A listed one comes from the pipeline at the full
     resolution of the source and carries all five quantities; a point comes
     from the area pack, about two kilometres away and without wind. */
  place: null,
  hasWind: true,
};

/* Bumped together with CACHE in sw.js, and tests/test_web.py insists the two
   agree: the footer is only worth reading if the number in it is the one the
   files were shipped with. */
const APP_VERSION = "v44";

const STORED_PLACE = "mys-aladin.place";
const STORED_FOLLOW = "mys-aladin.follow";
const STORED_RECENT = "mys-aladin.recent";
const RECENT_LIMIT = 6;

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
    freezing: true,
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

  const points = series.map((row, i) => [x(i), y(view.value(row))]);
  const area = splinePath(points, base);
  defineGridClip(svg, width, area);
  drawDayBands(svg, series, x, base);
  drawGrid(svg, series, niceTicks(lo, hi, 4), x, y, left, right, base);

  // Below freezing the temperature is drawn in the cold pair of colours. The
  // change of colour is a gradient with both stops on the same line, so it
  // falls exactly on nought degrees wherever the curve happens to cross it.
  const paint = view.freezing ? defineFreezing(svg, y) : null;
  const areaFill = el("path", {
    d: area,
    fill: paint ? paint.fill : view.fill,
    // With a gradient the transparency is in its stops, not on the path.
    opacity: paint ? 1 : 0.55,
  }, svg);
  areaFill.setAttribute("stroke", "none");
  el("path", {
    d: splinePath(points, null),
    fill: "none",
    stroke: paint ? paint.stroke : view.color,
    "stroke-width": 2,
  }, svg);

  if (view.withRain) drawRain(svg, series, x, base, right);
  if (view.arrows) drawArrows(svg, series, x, base);
  labelExtremes(svg, series, view, x, y);
  drawTimeAxis(svg, series, x, base, left, right);
  drawNow(svg, series, x, base);
  attachCursor(svg, series, x, width);
}

/* Two gradients down the plot, one for the filled area and one for the curve,
   each with its warm and its cold stop on the height of nought degrees. A
   freezing line above the plot leaves the chart all cold, one below it leaves
   it all warm, which is what clamping the offset to the plot does. */
function defineFreezing(svg, y) {
  const defs = el("defs", {}, svg);
  const offset = Math.min(1, Math.max(0, (y(0) - PAD_T) / PLOT_H));
  for (const [id, warm, cold] of [
    ["freezing-fill", "warm-fill", "cold-fill"],
    ["freezing-line", "warm-line", "cold-line"],
  ]) {
    const gradient = el("linearGradient", {
      id,
      gradientUnits: "userSpaceOnUse",
      x1: 0,
      y1: PAD_T,
      x2: 0,
      y2: PAD_T + PLOT_H,
    }, defs);
    el("stop", { offset, class: warm }, gradient);
    el("stop", { offset, class: cold }, gradient);
  }
  return { fill: "url(#freezing-fill)", stroke: "url(#freezing-line)" };
}

/* Everything that belongs behind the chart - the day bands and the grid - is
   cut to the part of the plot the curve does not cover. Rectangle minus the
   area, by the even-odd rule. */
function defineGridClip(svg, width, area) {
  const clip = el("clipPath", { id: "grid-clip" }, el("defs", {}, svg));
  el("path", { d: `M 0,0 H ${width} V ${SVG_H} H 0 Z ${area}`, "clip-rule": "evenodd" }, clip);
}

/* Days are told apart by the ground they stand on, not only by the names under
   the axis: days alternate between the plane of the page and a shade above it,
   today being the plane, so every boundary is a change of ground. The band
   is background like the grid, clipped the same way, so nothing of it shows
   through the filled area.

   Night is no longer shaded behind the curve: the hourly icons carry the moon,
   the axis carries the hours, and one band over another made the chart busier
   than it made it clearer. */
function drawDayBands(svg, series, x, base) {
  const bands = el("g", { "clip-path": "url(#grid-clip)" }, svg);
  const midnight = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = midnight(new Date());

  let start = 0;
  for (let i = 1; i <= series.length; i++) {
    const last = i === series.length;
    if (!last && series[i].date.getDate() === series[start].date.getDate()) continue;
    const day = Math.round((midnight(series[start].date) - today) / 864e5);
    // Alternating, with today on the plane of the page: every boundary between
    // two days is then a change of ground. The modulo also behaves for the
    // hours of yesterday that a late run still carries.
    if ((((day % 2) + 2) % 2) === 1) {
      const from = x(start);
      const to = x(last ? series.length - 1 : i);
      // The chart can end exactly at midnight, which starts a day that is one
      // point wide and worth nothing on screen.
      if (to - from >= 1) {
        el("rect", {
          class: "day-band",
          x: from,
          y: PAD_T,
          width: to - from,
          height: base - PAD_T,
        }, bands);
      }
    }
    start = i;
  }
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

/* The grid is the bottom layer: horizontal guides and the six-hour marks, both
   clipped to the part of the plot the curve does not cover. Everything that
   carries a reading - the filled area, the curve, the numbers, the now line -
   then sits over it, instead of being crossed by lines that show through the
   translucent fill. */
function drawGrid(svg, series, ticks, x, y, left, right, base) {
  const grid = el("g", { "clip-path": "url(#grid-clip)" }, svg);

  for (const tick of ticks) {
    el("line", { class: "grid-line", x1: left, y1: y(tick), x2: right, y2: y(tick) }, grid);
  }
  series.forEach((row, i) => {
    const hour = row.date.getHours();
    if (hour % 6 !== 0) return;
    // Midnight is where one day ends, so it is drawn a shade stronger than the
    // six-hour marks around it.
    el("line", {
      class: hour === 0 ? "day-line" : "grid-line",
      x1: x(i), y1: PAD_T, x2: x(i), y2: base,
    }, grid);
  });
}

function drawTimeAxis(svg, series, x, base, left, right) {
  el("line", { class: "axis-line", x1: left, y1: base, x2: right, y2: base }, svg);
  series.forEach((row, i) => {
    const hour = row.date.getHours();
    if (hour % 6 !== 0) return;
    // The tick mark below the axis is outside the plot, so it is drawn here
    // rather than in the clipped grid.
    el("line", { class: "grid-line", x1: x(i), y1: base, x2: x(i), y2: base + 4 }, svg);
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
/* A character that holds its room without being seen. */
function ghost(character) {
  const span = document.createElement("span");
  span.className = "ghost";
  span.setAttribute("aria-hidden", "true");
  span.textContent = character;
  return span;
}

/* The reading stands still while the temperature changes: the room of the
   minus sign and of the tens digit is kept even when they are not there, so
   the decimal point and the degree sign never move. The number itself stays
   one piece of text; only the kept room precedes it. Figures are tabular, so
   the ghost digit is exactly as wide as the digit it stands in for. */
function showTemperature(value) {
  const text = value.toFixed(1);
  const node = document.getElementById("nowTemp");
  fill(node, `${text} °C`, 2);
  if (!text.startsWith("-")) node.prepend(ghost("-"));
}

/* Every reading of the header is written this way. The whole part is given as
   many places as the largest value needs and fills the places it does not use
   with digits that are not seen, so the unit behind the number never moves. */
function fill(node, text, places) {
  const whole = text.split(" ")[0].replace("-", "").split(".")[0];
  node.textContent = "";
  for (let i = whole.length; i < places; i += 1) node.append(ghost("0"));
  node.append(text);
}

function showHeader(row) {
  showTemperature(row.t2m);
  const rain = document.getElementById("nowRain");
  fill(rain, `${row.precip_mm.toFixed(1)} mm/h`, 1);
  // The same room the temperature keeps for its sign, so that the two
  // readings of the left half begin on one line.
  rain.prepend(ghost("-"));
  const wind = document.getElementById("nowWind");
  if (state.hasWind) {
    fill(wind, `${row.wind_ms.toFixed(1)} m/s`, 3);
  } else {
    // The row stays even where the pack carries no wind, so that the cloud
    // below it keeps the line of the precipitation.
    wind.textContent = "N/A";
  }
  fill(document.getElementById("nowCloud"), `${row.cloud_pct} %`, 3);
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
      [`${DAYS[row.date.getDay()]} ${hhmm(row.date)}`, ""],
      [row.t2m.toFixed(1), ""],
      [row.precip_mm.toFixed(1), ""],
      [String(row.cloud_pct), ""],
      [state.hasWind ? `${row.wind_ms.toFixed(1)} · ${row.wind_dir}` : "", "wind"],
    ];
    cells.forEach(([text, className], column) => {
      const cell = document.createElement(column === 0 ? "th" : "td");
      if (column === 0) cell.scope = "row";
      if (className) cell.className = className;
      cell.textContent = text;
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  }
}

/* ---------- views ---------- */

function selectView(name) {
  // Wind belongs to the listed places only; a point read from the pack has
  // none, and its button is hidden rather than left to draw an empty chart.
  if (name === "wind" && !state.hasWind) name = "temperature";
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
  state.forecast = forecast;
  state.fromCache = fromCache;
  state.generatedAt = Date.parse(forecast.generated_at);

  document.getElementById("runline").textContent =
    `Běh modelu ${formatMoment(forecast.run_id)}, aktualizováno ${formatMoment(forecast.generated_at)}`;
  showWorkflowRun(forecast);
  updateAge();

  // Something is on screen at once, even while the position is being read,
  // which on a phone takes a moment and can fail outright.
  const wanted = promote(state.place || stored(STORED_PLACE) || listedPlaces()[0]);
  selectPlace(wanted);
  setFollowing(following());
  if (following()) followNow();
}

/* ---------- places ---------- */

function listedPlaces() {
  if (!state.forecast) return [];
  return state.forecast.locations.map((location) => ({
    kind: "listed",
    name: location.name,
    label: location.label || location.name,
    lat: location.lat,
    lon: location.lon,
  }));
}

/* A point that has since been added to the repository comes back as a listed
   place, and the app should show that one: same spot, full resolution, wind
   included. The file is written from the point itself, so the coordinates
   match to the metre; a hundred metres of slack is room for the rounding on
   the way through. */
function promote(place) {
  if (!place || place.kind !== "point") return place;
  const listed = listedPlaces().find(
    (one) => Math.abs(one.lat - place.lat) < 1e-3 && Math.abs(one.lon - place.lon) < 1e-3
  );
  return listed || place;
}

/* At home the app should say so. A position within a kilometre of a saved
   place is taken for that place: it is the same kilometre of the grid, and
   the place carries the name the user gave it, the full resolution and the
   wind, none of which a point of its own would have. A kilometre is the step
   of the grid, so nothing finer than that is being claimed. */
const AT_PLACE_KM = 1;

function placeAt(lat, lon) {
  let best = null;
  let closest = AT_PLACE_KM;
  for (const listed of listedPlaces()) {
    const km = AreaPack.distanceKm(lat, lon, listed.lat, listed.lon);
    if (km <= closest) {
      best = listed;
      closest = km;
    }
  }
  return best;
}

function samePlace(one, other) {
  if (!one || !other || one.kind !== other.kind) return false;
  if (one.kind === "listed") return one.name === other.name;
  return Math.abs(one.lat - other.lat) < 1e-4 && Math.abs(one.lon - other.lon) < 1e-4;
}

/* Browser storage is a convenience here, never a source of truth: a private
   window or cleared site data makes it throw or come back empty, and the app
   then simply opens on the first listed place. */
function stored(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch (ignored) {
    return null;
  }
}

function keep(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (ignored) {
    // Nothing to do: the choice lives for this visit only.
  }
}

/* Following the phone is a mode rather than a one-off reading: it is on until
   another place is chosen, and it survives to the next opening. On by default,
   so the app opens on wherever it is. The value is an object because a bare
   false would be indistinguishable from nothing stored at all. */
function following() {
  const kept = stored(STORED_FOLLOW);
  return kept ? Boolean(kept.on) : true;
}

function setFollowing(on) {
  keep(STORED_FOLLOW, { on });
  const action = document.getElementById("useLocation");
  action.classList.toggle("is-on", on);
  document.getElementById("followState").textContent = on ? "zapnuto" : "vypnuto";
}

function rememberRecent(place) {
  // A followed position would fill the list with near-identical points, and it
  // is one tap away in any case.
  if (place.kind !== "point" || place.auto) return;
  const recent = (stored(STORED_RECENT) || []).filter((other) => !samePlace(place, other));
  recent.unshift(place);
  keep(STORED_RECENT, recent.slice(0, RECENT_LIMIT));
}

/* Czech writes a decimal comma, and these two numbers are read by a person
   rather than parsed by anything. */
function decimal(value, places) {
  return value.toFixed(places).replace(".", ",");
}

/* Two decimals are about a kilometre, which is finer than the grid the point
   is looked up in and short enough to sit in the header. */
function coordinateLabel(lat, lon) {
  return `${decimal(lat, 2)} N ${decimal(lon, 2)} E`;
}

function applySeries(rows, hasWind) {
  state.hasWind = hasWind;
  document.body.classList.toggle("no-wind", !hasWind);
  state.series = rows.map((row) => ({ ...row, date: new Date(row.time) }));
  renderNow(state.series);
  drawIconRow(state.series);
  fillTable(state.series);
  selectView(state.view);
}

function describePlace(place, answer) {
  document.getElementById("place").textContent = place.label;
  // The mark says that what is on screen came from the phone, which is not the
  // same as the mode being on: the mode can be on and the reading have failed.
  // An SVG element has no hidden property - that belongs to HTMLElement - so
  // the attribute has to be set rather than assigned.
  document.getElementById("followMark").toggleAttribute("hidden", !place.auto);
  document.getElementById("placeChip").hidden = !answer;
  const line = document.getElementById("gridline");
  line.hidden = !answer;
  if (answer) {
    line.textContent =
      `Mřížka po dvou kilometrech, nejbližší bod ${decimal(answer.distanceKm, 1)} km od místa.`;
  }
}

async function showPlace(place) {
  if (place.kind === "listed") {
    const location = state.forecast.locations.find((one) => one.name === place.name);
    if (!location) throw new Error(`místo ${place.name} v předpovědi není`);
    state.place = place;
    applySeries(location.series, true);
    describePlace(place, null);
  } else {
    const answer = await AreaPack.seriesAt(place.lat, place.lon);
    state.place = place;
    applySeries(answer.rows, false);
    describePlace(place, answer);
    rememberRecent(place);
  }
  keep(STORED_PLACE, state.place);
  renderPlaceLists();
}

function placeProblem(error) {
  if (error instanceof AreaPack.OffGrid) {
    return "Místo leží mimo doménu modelu ALADIN.";
  }
  if (error instanceof AreaPack.MissingPack) {
    return "Předpověď pro místa mimo uložená zatím není publikovaná.";
  }
  return `Místo se nepodařilo zobrazit: ${error.message}`;
}

async function selectPlace(place) {
  if (!place) return;
  try {
    await showPlace(place);
    report("");
    closePanel();
  } catch (error) {
    report(placeProblem(error));
    const fallback = listedPlaces()[0];
    if (fallback && !samePlace(place, fallback) && !state.series.length) {
      await showPlace(fallback).catch(() => {});
    }
  }
}

/* A problem with a place belongs where the user is looking: in the panel when
   it is open, and on the page itself when the place came from the previous
   visit and nobody opened anything. */
function report(message) {
  const box = document.getElementById("error");
  if (panel.open) {
    note(message);
    box.hidden = true;
    return;
  }
  note("");
  box.hidden = !message;
  box.textContent = message;
}

/* ---------- the place panel ---------- */

const panel = document.getElementById("placePanel");
const searchField = document.getElementById("placeSearch");

let names = null;
let namesPromise = null;

/* The municipality list is bundled with the app, so the search works offline
   and asks nothing of anyone at runtime. It is fetched on the first use of
   the panel rather than at start-up, because most openings of the app never
   need it. */
function placeNames() {
  if (!namesPromise) {
    namesPromise = fetch("places.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((document_) => {
        const details = document_.details || [];
        names = document_.places.map(([name, kind, detail, lat, lon]) => ({
          name,
          // A part of a municipality: a quarter of a city, or a village that
          // belongs to a larger one.
          isPart: Boolean(kind),
          detail: details[detail] || "",
          lat,
          lon,
          key: foldAccents(name),
        }));
        return names;
      })
      .catch((error) => {
        namesPromise = null;
        throw error;
      });
  }
  return namesPromise;
}

function foldAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const COORDINATES = /^\s*(-?\d{1,2}(?:[.,]\d+)?)[\s,;]+(-?\d{1,3}(?:[.,]\d+)?)\s*$/;

function parseCoordinates(query) {
  const found = COORDINATES.exec(query);
  if (!found) return null;
  const lat = Number(found[1].replace(",", "."));
  const lon = Number(found[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { kind: "point", label: coordinateLabel(lat, lon), lat, lon };
}

/* A municipality outranks a part of one, and a shorter name outranks a longer:
   someone typing Brno means the city, not Brno-Bystrc. */
function byRank(one, other) {
  return one.isPart - other.isPart || one.name.length - other.name.length;
}

function search(query) {
  const needle = foldAccents(query.trim());
  if (!names || needle.length < 2) return [];
  const starts = [];
  const inside = [];
  for (const place of names) {
    if (place.key.startsWith(needle)) starts.push(place);
    else if (place.key.includes(needle)) inside.push(place);
  }
  return starts.sort(byRank).concat(inside.sort(byRank)).slice(0, 8);
}

/* A point from the phone deserves a name, so it is labelled after the nearest
   place when there is one close enough, and by its coordinates when there is
   not. Parts of municipalities are in the list precisely for this: a position
   in Prague would otherwise be measured against a single point downtown, ten
   kilometres from wherever the phone actually is. */
function nameFor(lat, lon) {
  if (!names) return coordinateLabel(lat, lon);
  let best = null;
  let bestDistance = Infinity;
  for (const place of names) {
    const distance = (place.lat - lat) ** 2 + ((place.lon - lon) * 0.64) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  // Roughly five kilometres, in the squared degrees measured above.
  return best && bestDistance < 0.002 ? best.name : coordinateLabel(lat, lon);
}

/* A point saved before the list knew the parts of municipalities carries its
   coordinates as a name. The list is here now, so give it the name it would
   get today - the selected place and the remembered ones alike. */
function renameFromList() {
  if (!names) return;

  const renamed = (place) => {
    if (!place || place.kind !== "point") return place;
    // Only a place that never got a name of its own is touched.
    if (place.label !== coordinateLabel(place.lat, place.lon)) return place;
    const name = nameFor(place.lat, place.lon);
    return name === place.label ? place : { ...place, label: name };
  };

  const recent = stored(STORED_RECENT) || [];
  const renamedRecent = recent.map(renamed);
  if (renamedRecent.some((place, index) => place !== recent[index])) {
    keep(STORED_RECENT, renamedRecent);
  }

  const current = renamed(state.place);
  if (current !== state.place) {
    state.place = current;
    keep(STORED_PLACE, current);
    document.getElementById("place").textContent = current.label;
  }
}

function note(message, kind = "warning") {
  const element = document.getElementById("panelNote");
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("is-ok", kind === "ok");
}

function placeItem(place, detail) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sheet-item";
  if (samePlace(place, state.place)) button.classList.add("is-current");
  const name = document.createElement("span");
  name.textContent = place.label;
  button.appendChild(name);
  if (detail) {
    const hint = document.createElement("span");
    hint.className = "sheet-detail";
    hint.textContent = detail;
    button.appendChild(hint);
  }
  button.addEventListener("click", () => choosePlace(place));
  item.appendChild(button);
  return item;
}

function fillList(id, items) {
  const list = document.getElementById(id);
  list.textContent = "";
  for (const item of items) list.appendChild(item);
  return list;
}

/* Adding a place means adding a file to the repository, and the app cannot
   write there: it has no credentials, and putting any in a page served to a
   phone would be worse than the inconvenience it saves. So it prepares the
   file and hands it over - to the web editor of GitHub, prefilled, or to the
   clipboard when that is easier. */
const REPO = "https://github.com/miroslav-slavik/mys-aladin";

function slug(text) {
  return foldAccents(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "misto";
}

function placeFile(place) {
  return `${JSON.stringify(
    { name: slug(place.label), label: place.label, lat: place.lat, lon: place.lon },
    null,
    2
  )}\n`;
}

function saveUrl(place) {
  const path = `places/${slug(place.label)}.json`;
  return `${REPO}/new/main?filename=${encodeURIComponent(path)}` +
    `&value=${encodeURIComponent(placeFile(place))}`;
}

function renderSaveBlock() {
  const place = state.place;
  const offer = Boolean(place && place.kind === "point");
  document.getElementById("saveBlock").hidden = !offer;
  if (!offer) return;
  document.getElementById("saveName").textContent = place.label;
  document.getElementById("saveLink").href = saveUrl(place);
}

document.getElementById("copyPlace").addEventListener("click", async () => {
  const place = state.place;
  if (!place || place.kind !== "point") return;
  try {
    await navigator.clipboard.writeText(placeFile(place));
    note(`Obsah souboru places/${slug(place.label)}.json je ve schránce.`, "ok");
  } catch (error) {
    note("Do schránky se zkopírovat nepodařilo, odkaz výše obsah vyplní sám.");
  }
});

function renderPlaceLists() {
  fillList("listedPlaces", listedPlaces().map((place) => placeItem(place, "1 km, s větrem")));
  const recent = stored(STORED_RECENT) || [];
  fillList(
    "recentPlaces",
    recent.map((place) => {
      const coordinates = coordinateLabel(place.lat, place.lon);
      // A place already named by its coordinates needs no second copy of them.
      return placeItem(place, place.label === coordinates ? "" : coordinates);
    })
  );
  document.getElementById("recentLabel").hidden = recent.length === 0;
  renderSaveBlock();
}

function renderResults() {
  const query = searchField.value;
  const coordinates = parseCoordinates(query);
  const items = coordinates
    ? [placeItem(coordinates, "zadané souřadnice")]
    : search(query).map((place) =>
        placeItem(
          { kind: "point", label: place.name, lat: place.lat, lon: place.lon },
          place.detail
        )
      );
  fillList("placeResults", items);
}

/* iOS measures a plain vh against the screen without the browser toolbars, and
   keeps fixed elements anchored to the layout viewport rather than to what is
   on screen. The panel could therefore reach below the edge of the display,
   with the lower part of it unreachable, and disappear behind the keyboard as
   soon as the search field took focus. The visual viewport knows what is
   actually visible, so the sheet is measured and placed from it whenever the
   browser offers one. */
const PANEL_LIFT = 24;

function fitPanel() {
  const view = window.visualViewport;
  if (!view) return;
  const below = Math.max(0, window.innerHeight - (view.height + view.offsetTop));
  // The same lift the stylesheet gives it, kept when the keyboard decides
  // where the bottom of the screen is.
  panel.style.bottom = `${below + PANEL_LIFT}px`;
  panel.style.maxHeight = `${Math.round(view.height) - PANEL_LIFT - 16}px`;
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitPanel);
  window.visualViewport.addEventListener("scroll", fitPanel);
}

function openPanel() {
  fitPanel();
  renderPlaceLists();
  note("");
  searchField.value = "";
  fillList("placeResults", []);
  if (typeof panel.showModal === "function") panel.showModal();
  else panel.setAttribute("open", "");
  placeNames()
    .then(() => {
      renameFromList();
      renderPlaceLists();
      renderResults();
    })
    .catch(() => {
      note("Seznam míst se nepodařilo načíst, souřadnice zadat lze.");
    });
}

function closePanel() {
  if (typeof panel.close === "function" && panel.open) panel.close();
  else panel.removeAttribute("open");
}

document.getElementById("placeButton").addEventListener("click", openPanel);
document.getElementById("closePanel").addEventListener("click", closePanel);
searchField.addEventListener("input", renderResults);
searchField.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const first = document.querySelector("#placeResults .sheet-item");
  if (first) first.click();
});

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("prohlížeč polohu neposkytuje"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) => reject(new Error(error.message)),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

/* Read the position and show it. A saved place within a kilometre wins; short
   of that the place list is loaded, because a point deserves the name of the
   quarter it is in rather than its coordinates. A position that cannot be had leaves the screen as it is: the
   mode stays on, so the next opening tries again. */
async function followNow(announce = false) {
  if (announce) note("Zjišťuji polohu…");
  try {
    const coords = await locate();
    await placeNames().catch(() => {});
    setFollowing(true);
    const lat = Number(coords.latitude.toFixed(4));
    const lon = Number(coords.longitude.toFixed(4));
    const here = placeAt(lat, lon);
    // Either way the place is marked as read from the phone, so that the mode
    // stays on and the list of the lately shown places is left alone.
    await showPlace(
      here
        ? { ...here, auto: true }
        : { kind: "point", auto: true, label: nameFor(lat, lon), lat, lon }
    );
    report("");
    if (announce) closePanel();
  } catch (error) {
    const message = `Polohu se nepodařilo zjistit: ${error.message}`;
    // A refusal on opening would otherwise put a red box on the page at every
    // single start; it belongs in the panel, where the mode can be turned off.
    if (announce) report(message);
    else note(message);
  }
}

/* Anything the user picks themselves ends the following. */
function choosePlace(place) {
  setFollowing(false);
  selectPlace(place);
}

document.getElementById("useLocation").addEventListener("click", () => followNow(true));

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

/* Which run of the workflow wrote the data on screen, as a link to it. The
   field is missing from a forecast built anywhere but in Actions, and from
   one written before this was recorded at all. */
function showWorkflowRun(forecast) {
  const node = document.getElementById("buildRun");
  const run = forecast.workflow_run;
  node.textContent = "";
  if (!run) {
    node.textContent = "běh workflow neuveden";
    return;
  }
  const name = `${run.workflow || "forecast"} #${run.number}`;
  if (!run.id) {
    node.textContent = name;
    return;
  }
  const link = document.createElement("a");
  link.href = `${REPO}/actions/runs/${run.id}`;
  link.rel = "noreferrer";
  link.textContent = name;
  node.append(link);
}

/* Which version is on screen, and which cache it came out of. The two differ
   exactly when a new version has installed but the page still runs the old
   one, which is the moment worth being able to see. */
function showBuild() {
  document.getElementById("appVersion").textContent = APP_VERSION;
  const name = document.getElementById("cacheName");
  const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!worker) {
    name.textContent = "bez service workeru";
    return;
  }
  const channel = new MessageChannel();
  const answered = setTimeout(() => {
    // An older worker knows no such message; saying so beats an empty dash.
    name.textContent = "starší verze";
  }, 1000);
  channel.port1.onmessage = (event) => {
    clearTimeout(answered);
    name.textContent = (event.data && event.data.cache) || "—";
  };
  worker.postMessage("version", [channel.port2]);
}

/* What the page was given to draw on and what of it the eye sees. The two
   part company when the browser is zoomed in, by a pinch or by a setting of
   its own, and that is the one cause of a screen too narrow for the layout
   that the layout itself cannot answer for. */
function showViewport() {
  const view = window.visualViewport;
  const page = document.documentElement.clientWidth;
  const seen = view ? Math.round(view.width) : page;
  const scale = view ? view.scale : 1;
  document.getElementById("viewline").textContent =
    `Zobrazení: stránka ${page} px, vidět ${seen} px, zvětšení ${decimal(scale, 2)}×`;
}

window.addEventListener("load", watchForUpdates);
window.addEventListener("load", showBuild);
window.addEventListener("load", showViewport);
window.addEventListener("resize", showViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", showViewport);
  window.visualViewport.addEventListener("scroll", showViewport);
}

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
