/* Reading the area pack: the forecast for a point nobody listed in advance.

   The pipeline publishes a coarsened grid of temperature, precipitation and
   cloud cover, cut into tiles. Everything needed to find a point is in
   data/area/index.json, so nothing about the format is assumed here: the grid
   origin and step, the tile size, the order of the fields and their scales all
   come from the index. One tile is a few tens of kilobytes, so answering for a
   place costs a single small fetch. */
"use strict";

const AreaPack = (() => {
  const BASE = "data/area/";

  const READERS = {
    int16: (view, offset) => view.getInt16(offset, true),
    uint16: (view, offset) => view.getUint16(offset, true),
    uint8: (view, offset) => view.getUint8(offset),
  };
  const SIZES = { int16: 2, uint16: 2, uint8: 1 };

  let indexPromise = null;
  const tiles = new Map();

  /* The pack is not in the repository and reaches the site through the cache
     of the forecast workflow. It can therefore be missing, and the app has to
     say so rather than break. */
  class MissingPack extends Error {}
  class OffGrid extends Error {}

  function load(force) {
    const url = force ? `${BASE}index.json?t=${Date.now()}` : `${BASE}index.json`;
    return fetch(url, { cache: force ? "reload" : "no-store" }).then((response) => {
      if (!response.ok) throw new MissingPack(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function index(force = false) {
    if (force || !indexPromise) {
      tiles.clear();
      indexPromise = load(force).catch((error) => {
        indexPromise = null;
        throw error;
      });
    }
    return indexPromise;
  }

  /* The nearest grid point, or null when the place lies outside the domain.
     Half a step of slack keeps a point on the very edge from being refused. */
  function nearest(pack, lat, lon) {
    const grid = pack.grid;
    const iy = Math.round((lat - grid.lat0) / grid.dlat);
    const ix = Math.round((lon - grid.lon0) / grid.dlon);
    if (iy < 0 || iy >= grid.ny || ix < 0 || ix >= grid.nx) return null;
    return {
      ix,
      iy,
      lat: grid.lat0 + iy * grid.dlat,
      lon: grid.lon0 + ix * grid.dlon,
    };
  }

  function distanceKm(fromLat, fromLon, toLat, toLon) {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (toLat - fromLat) * rad;
    const dLon = (toLon - fromLon) * rad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(fromLat * rad) * Math.cos(toLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  async function tile(pack, tx, ty) {
    const name = `${tx}-${ty}.bin`;
    if (!tiles.has(name)) {
      const promise = fetch(BASE + name).then((response) => {
        if (!response.ok) throw new MissingPack(`HTTP ${response.status} for ${name}`);
        return response.arrayBuffer();
      });
      // A failed fetch must not be remembered as the answer for this tile.
      promise.catch(() => tiles.delete(name));
      tiles.set(name, promise);
    }
    return tiles.get(name);
  }

  /* One point out of a tile. Sections follow the order of the index and inside
     a section the hours of a point sit together, so a series is one walk with
     a fixed stride. */
  function decode(pack, buffer, width, height, row, column) {
    const view = new DataView(buffer);
    const hours = pack.hours;
    const point = row * width + column;
    const points = width * height;

    const values = {};
    let base = 0;
    for (const field of pack.fields) {
      const size = SIZES[field.type];
      const read = READERS[field.type];
      const series = new Array(hours);
      let offset = base + point * hours * size;
      for (let hour = 0; hour < hours; hour++, offset += size) {
        series[hour] = read(view, offset) / field.scale;
      }
      values[field.name] = series;
      base += points * hours * size;
    }
    return values;
  }

  /* The hours of one place, shaped like the rows of forecast.json so that the
     rest of the app cannot tell the two sources apart. Wind is not in the
     pack, so those fields are simply absent. */
  async function seriesAt(lat, lon) {
    const pack = await index();
    const grid = pack.grid;
    const at = nearest(pack, lat, lon);
    if (!at) throw new OffGrid("mimo doménu modelu");

    const tx = Math.floor(at.ix / pack.tile);
    const ty = Math.floor(at.iy / pack.tile);
    const width = Math.min(pack.tile, grid.nx - tx * pack.tile);
    const height = Math.min(pack.tile, grid.ny - ty * pack.tile);

    const buffer = await tile(pack, tx, ty);
    const values = decode(
      pack,
      buffer,
      width,
      height,
      at.iy - ty * pack.tile,
      at.ix - tx * pack.tile
    );

    const rows = pack.times.map((time, hour) => {
      const row = { time };
      for (const field of pack.fields) row[field.name] = values[field.name][hour];
      return row;
    });

    return {
      rows,
      point: at,
      distanceKm: distanceKm(lat, lon, at.lat, at.lon),
      runId: pack.run_id,
      generatedAt: pack.generated_at,
    };
  }

  async function covers(lat, lon) {
    return Boolean(nearest(await index(), lat, lon));
  }

  return { index, seriesAt, covers, MissingPack, OffGrid };
})();
