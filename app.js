"use strict";

function normalizeFixedFields(raw) {
  const fields = {};
  DATA.playerFields.forEach(key => {
    const text = DATA.textFields.find(field => field.id === key);
    if (text) fields[key] = typeof raw?.[key] === "string" ? Array.from(raw[key]).slice(0, text.max).join("") : text.initial;
    else fields[key] = DATA.basic[key].some(item => item.id === raw?.[key]) ? raw[key] : DATA.initial[key];
  });
  return fields;
}

function createDefaultCard() {
  const card = { stats: {}, shotSkills: {}, rankSkills: {} };
  Object.entries(DATA.initial).forEach(([key, value]) => {
    if (!DATA.playerFields.includes(key)) card[key] = value;
  });
  DATA.textFields.filter(field => !DATA.playerFields.includes(field.id)).forEach(field => { card[field.id] = field.initial; });
  [...DATA.stats.front, ...DATA.stats.back].forEach(item => { card.stats[item.id] = DATA.stats.initial; });
  DATA.shotSkills.items.forEach(item => { card.shotSkills[item.id] = DATA.shotSkills.initial; });
  DATA.rankSkills.items.forEach(item => { card.rankSkills[item.id] = DATA.rankSkills.initial; });
  DATA.toggleGroups.forEach(group => { card[group] = []; });
  return card;
}

function createDefaultEditorPlayer() {
  return { ...normalizeFixedFields(null), ...createDefaultCard() };
}

function clampStat(value) {
  return Math.max(DATA.stats.min, Math.min(DATA.stats.max, Math.round(value)));
}

function normalizeCard(raw) {
  const player = createDefaultCard();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return player;
  DATA.textFields.filter(field => !DATA.playerFields.includes(field.id)).forEach(field => {
    if (typeof raw[field.id] === "string") player[field.id] = Array.from(raw[field.id]).slice(0, field.max).join("");
  });
  const choices = { ...DATA.basic, playStyle: DATA.playStyles, serve: DATA.serves, pose: DATA.poses };
  Object.entries(choices).forEach(([key, items]) => {
    if (DATA.playerFields.includes(key)) return;
    if (items.some(item => item.id === raw[key])) player[key] = raw[key];
  });
  [...DATA.stats.front, ...DATA.stats.back].forEach(item => {
    const value = raw.stats && raw.stats[item.id];
    if (typeof value === "number" && Number.isFinite(value)) player.stats[item.id] = clampStat(value);
  });
  ["shotSkills", "rankSkills"].forEach(group => {
    DATA[group].items.forEach(item => {
      const value = raw[group] && raw[group][item.id];
      if (DATA[group].levels.some(level => (level.id || level.rank) === value)) player[group][item.id] = value;
    });
  });
  DATA.toggleGroups.forEach(group => {
    if (Array.isArray(raw[group])) player[group] = DATA[group].items.filter(item => raw[group].includes(item.id)).map(item => item.id);
  });
  // 旧保存データに矛盾がある場合も、ペアの先頭だけを残す。
  DATA.exclusive.forEach(pair => {
    let found = false;
    pair.forEach(id => {
      DATA.toggleGroups.forEach(group => {
        if (player[group].includes(id)) {
          if (found) player[group] = player[group].filter(selected => selected !== id);
          found = true;
        }
      });
    });
  });
  return player;
}

function normalizeLegacyPlayer(raw) {
  return { ...normalizeFixedFields(raw), ...normalizeCard(raw) };
}

function seriesOrder(id) {
  if (typeof id !== "string" || !/^\d{4,}-[12]$/.test(id)) return null;
  const [year, period] = id.split("-");
  if (year[0] === "0") return null;
  return BigInt(year) * 2n + BigInt(period);
}

function isValidSeriesId(id) {
  const order = seriesOrder(id);
  return order !== null && order >= seriesOrder(DATA.series.startId);
}

function compareSeries(a, b) {
  const first = seriesOrder(a), second = seriesOrder(b);
  return first < second ? -1 : first > second ? 1 : 0;
}

function shiftSeries(id, offset) {
  const order = seriesOrder(id) + BigInt(offset) - 1n;
  return (order / 2n).toString() + "-" + (order % 2n + 1n).toString();
}

function* seriesIds(latest, reverse = false) {
  const first = seriesOrder(DATA.series.startId), last = seriesOrder(latest);
  for (let order = reverse ? last : first; reverse ? order >= first : order <= last; order += reverse ? -1n : 1n) {
    yield ((order - 1n) / 2n).toString() + "-" + ((order - 1n) % 2n + 1n).toString();
  }
}

function addWorldSeries(world) {
  world.latestSeriesId = shiftSeries(world.latestSeriesId, 1);
  world.ui.seriesId = world.latestSeriesId;
}

function canDeleteLatestSeries(world) {
  return world.latestSeriesId !== DATA.series.startId && !world.players.some(player => Object.hasOwn(player.cards, world.latestSeriesId));
}

function deleteLatestSeries(world) {
  if (!canDeleteLatestSeries(world)) return false;
  const deleted = world.latestSeriesId;
  world.latestSeriesId = shiftSeries(deleted, -1);
  if (world.ui.seriesId === deleted) world.ui.seriesId = world.latestSeriesId;
  return true;
}

function seriesName(id, forFile = false) {
  const [year, period] = id.split("-");
  const values = { year, period: DATA.series.periods[period] };
  return (forFile ? DATA.series.fileLabel : DATA.series.label).replace(/\{(\w+)\}/g, (_, key) => values[key]);
}

function generatePlayerId(usedIds) {
  let id;
  do {
    const random = Math.floor(Math.random() * DATA.playerId.radix ** DATA.playerId.randomLength)
      .toString(DATA.playerId.radix).padStart(DATA.playerId.randomLength, "0");
    id = DATA.playerId.prefix + Date.now().toString(DATA.playerId.radix) + random;
  } while (usedIds.has(id));
  return id;
}

function normalizePlayer(raw, usedIds = new Set()) {
  const validId = typeof raw.id === "string" && /^p_[a-z0-9]{5,}$/.test(raw.id) && !usedIds.has(raw.id);
  const id = validId ? raw.id : generatePlayerId(usedIds);
  usedIds.add(id);
  const timestamp = typeof raw.createdAt === "string" ? Date.parse(raw.createdAt) : NaN;
  const player = {
    id, ...normalizeFixedFields(raw),
    createdAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    cards: {}
  };
  if (raw.cards && typeof raw.cards === "object" && !Array.isArray(raw.cards)) {
    Object.entries(raw.cards).forEach(([seriesId, card]) => {
      if (isValidSeriesId(seriesId)) player.cards[seriesId] = normalizeCard(card);
    });
  }
  return player;
}

function createEmptyWorld() {
  return {
    version: DATA.version, latestSeriesId: DATA.series.startId, players: [],
    ui: { seriesId: DATA.series.startId, ...DATA.worldUi }
  };
}

function normalizeWorld(raw) {
  const world = createEmptyWorld();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return world;
  if (isValidSeriesId(raw.latestSeriesId)) world.latestSeriesId = raw.latestSeriesId;
  const usedIds = new Set();
  if (Array.isArray(raw.players)) {
    world.players = raw.players.filter(player => player && typeof player === "object" && !Array.isArray(player))
      .map(player => normalizePlayer(player, usedIds));
  }
  world.players.forEach(player => {
    Object.keys(player.cards).forEach(id => {
      if (compareSeries(id, world.latestSeriesId) > 0) world.latestSeriesId = id;
    });
  });
  if (raw.ui && typeof raw.ui === "object" && !Array.isArray(raw.ui)) {
    if (isValidSeriesId(raw.ui.seriesId) && compareSeries(raw.ui.seriesId, world.latestSeriesId) <= 0) world.ui.seriesId = raw.ui.seriesId;
    if (DATA.listModes.some(item => item.id === raw.ui.listMode)) world.ui.listMode = raw.ui.listMode;
    if (DATA.listSorts.some(item => item.id === raw.ui.sort)) world.ui.sort = raw.ui.sort;
    if (typeof raw.ui.lastExportedAt === "string" && Number.isFinite(Date.parse(raw.ui.lastExportedAt))) {
      world.ui.lastExportedAt = new Date(raw.ui.lastExportedAt).toISOString();
    }
    if (raw.ui.matchSetup && typeof raw.ui.matchSetup === "object" && !Array.isArray(raw.ui.matchSetup)) {
      world.ui.matchSetup = normalizeMatchSetup(world, raw.ui.matchSetup);
    }
  }
  return world;
}

function createWorldPlayer(editorPlayer, usedIds = new Set(), seriesId = DATA.series.startId) {
  return normalizePlayer({ ...normalizeFixedFields(editorPlayer), cards: { [seriesId]: normalizeCard(editorPlayer) } }, usedIds);
}

function addWorldPlayer(world) {
  const player = createWorldPlayer(createDefaultEditorPlayer(), new Set(world.players.map(item => item.id)), world.ui.seriesId);
  world.players.push(player);
  return player;
}

function resetWorldCard(player, seriesId) {
  player.cards[seriesId] = createDefaultCard();
}

function deleteWorldPlayer(world, playerId) {
  world.players = world.players.filter(player => player.id !== playerId);
}

function nearestCardSeries(player, seriesId, allowFollowing = true) {
  const ids = Object.keys(player.cards).sort(compareSeries);
  return ids.filter(id => compareSeries(id, seriesId) < 0).pop()
    || (allowFollowing ? ids.find(id => compareSeries(id, seriesId) > 0) : undefined);
}

function createWorldCard(player, seriesId) {
  if (!isValidSeriesId(seriesId) || Object.hasOwn(player.cards, seriesId)) return false;
  const source = nearestCardSeries(player, seriesId);
  player.cards[seriesId] = source ? normalizeCard(player.cards[source]) : createDefaultCard();
  return true;
}

function copyPreviousCard(player, seriesId) {
  const source = nearestCardSeries(player, seriesId, false);
  if (!source || !Object.hasOwn(player.cards, seriesId)) return false;
  player.cards[seriesId] = normalizeCard(player.cards[source]);
  return true;
}

function deleteWorldCard(player, seriesId) {
  if (Object.keys(player.cards).length < 2 || !Object.hasOwn(player.cards, seriesId)) return false;
  delete player.cards[seriesId];
  return true;
}

function scoreHistory(player) {
  return Object.keys(player.cards).sort(compareSeries).map(seriesId => ({ seriesId, ...calculateScore(player.cards[seriesId]) }));
}

function historyScale(points) {
  if (!points.length) return null;
  const config = DATA.historyGraph;
  const low = points.reduce((value, point) => Math.min(value, point.value), Infinity);
  const high = points.reduce((value, point) => Math.max(value, point.value), -Infinity);
  const padding = Math.max(config.minPadding, (high - low) * config.paddingRatio);
  const rawStep = (high - low + padding * 2) / config.ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = config.tickSteps.find(value => value * magnitude >= rawStep) * magnitude;
  const min = Math.max(0, Math.floor((low - padding) / step) * step);
  const max = Math.ceil((high + padding) / step) * step;
  const ticks = [];
  for (let value = min; value <= max; value += step) ticks.push(value);
  return {
    min, max, ticks,
    boundaries: DATA.score.ranks.slice(0, -1).filter(rank => rank.min >= min && rank.min <= max)
  };
}

function dateParts(date) {
  return { year: String(date.getFullYear()), month: String(date.getMonth() + 1).padStart(2, "0"), day: String(date.getDate()).padStart(2, "0") };
}

function formatDateLabel(template, date) {
  const parts = dateParts(date);
  return template.replace(/\{(\w+)\}/g, (_, key) => parts[key]);
}

function prepareWorldExport(world, date = new Date()) {
  const snapshot = normalizeWorld(world);
  snapshot.ui.lastExportedAt = date.toISOString();
  return { world: snapshot, text: JSON.stringify(snapshot, null, DATA.backup.jsonIndent), filename: formatDateLabel(DATA.backup.fileLabel, date) };
}

function parseWorldImport(text) {
  const raw = JSON.parse(text);
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  if (!record(raw)) throw new Error("Invalid import format");
  if (raw.version === DATA.version && Array.isArray(raw.players)
    && raw.players.every(player => record(player) && record(player.cards))
    && (raw.ui === undefined || record(raw.ui))) return normalizeWorld(raw);
  if (raw.version === 1) {
    const fields = [...DATA.playerFields, ...Object.keys(createDefaultCard())];
    if (fields.some(key => Object.hasOwn(raw, key))) {
      const world = createEmptyWorld();
      world.players.push(createWorldPlayer(normalizeLegacyPlayer(raw)));
      return world;
    }
  }
  throw new Error("Invalid import format");
}

function importWorld(world, imported, mode) {
  if (mode === "replace") return normalizeWorld(imported);
  if (mode !== "append") throw new Error("Invalid import mode");
  const merged = normalizeWorld(world);
  const usedIds = new Set(merged.players.map(player => player.id));
  normalizeWorld(imported).players.forEach(player => merged.players.push(normalizePlayer(player, usedIds)));
  if (compareSeries(imported.latestSeriesId, merged.latestSeriesId) > 0) merged.latestSeriesId = imported.latestSeriesId;
  return merged;
}

function needsBackup(world, now = Date.now()) {
  return world.players.length > 0 && (world.ui.lastExportedAt === null
    || now - Date.parse(world.ui.lastExportedAt) >= DATA.backup.warningDays * DATA.backup.dayMs);
}

function listSeriesPlayers(world) {
  return world.players.filter(player => world.ui.listMode === "all" || Object.hasOwn(player.cards, world.ui.seriesId)).sort((a, b) => {
    if (world.ui.sort === "name") return (a.name || DATA.text.anonymous).localeCompare(b.name || DATA.text.anonymous, "ja");
    if (world.ui.sort === "created") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    const score = player => player.cards[world.ui.seriesId] ? calculateScore(player.cards[world.ui.seriesId]).value : -Infinity;
    return score(b) - score(a) || 0;
  });
}

function resolveEditRoute(world, hash) {
  const match = /^#\/edit\/(p_[a-z0-9]+)\/(\d{4,}-[12])$/.exec(hash);
  if (!match) return null;
  const player = world.players.find(item => item.id === match[1]);
  return player && Object.hasOwn(player.cards, match[2]) ? { player, seriesId: match[2] } : null;
}

function resolvePlayerRoute(world, hash) {
  const match = /^#\/player\/(p_[a-z0-9]+)$/.exec(hash);
  return match ? world.players.find(player => player.id === match[1]) || null : null;
}

function matchPlayers(world) {
  return world.players.filter(player => Object.keys(player.cards).length > 0)
    .sort((a, b) => (a.name || DATA.text.anonymous).localeCompare(b.name || DATA.text.anonymous, "ja"));
}

function matchSeries(player) {
  return player ? Object.keys(player.cards).sort((a, b) => compareSeries(b, a)) : [];
}

function normalizeMatchSetup(world, raw, preferredSide = "a") {
  const players = matchPlayers(world), rules = DATA.match.rules;
  const setup = {
    format: rules.formats.includes(raw?.format) ? raw.format : rules.initialFormat,
    surface: DATA.basic.surface.some(item => item.id === raw?.surface) ? raw.surface : rules.initialSurface,
    firstServer: DATA.match.ui.firstServers.some(item => item.id === raw?.firstServer) ? raw.firstServer : rules.initialServer
  };
  const selectCard = (selection, opponent) => {
    const preferred = players.find(player => player.id === selection?.playerId);
    const candidates = preferred ? [preferred, ...players.filter(player => player !== preferred)] : players;
    for (const player of candidates) {
      const available = matchSeries(player).filter(id => player.id !== opponent?.playerId || id !== opponent.seriesId);
      if (!available.length) continue;
      const seriesId = available.includes(selection?.seriesId) ? selection.seriesId : available[0];
      return { playerId: player.id, seriesId };
    }
    return { playerId: null, seriesId: null };
  };
  const otherSide = preferredSide === "a" ? "b" : "a";
  setup[preferredSide] = selectCard(raw?.[preferredSide]);
  const otherSelection = raw?.[otherSide] || { playerId: players.find(player => player.id !== setup[preferredSide].playerId)?.id };
  setup[otherSide] = selectCard(otherSelection, setup[preferredSide]);
  return setup;
}

function resolveMatchEntries(world, setup) {
  if (matchPlayers(world).length < 2 || !setup
    || !DATA.match.rules.formats.includes(setup.format)
    || !DATA.basic.surface.some(item => item.id === setup.surface)
    || !DATA.match.ui.firstServers.some(item => item.id === setup.firstServer)) return null;
  const entries = {};
  for (const { id } of DATA.match.ui.sides) {
    const selection = setup[id];
    const player = world.players.find(item => item.id === selection?.playerId);
    if (!player || !Object.hasOwn(player.cards, selection.seriesId)) return null;
    entries[id] = { player, card: player.cards[selection.seriesId], seriesId: selection.seriesId };
  }
  if (entries.a.player.id === entries.b.player.id && entries.a.seriesId === entries.b.seriesId) return null;
  return { ...entries, format: setup.format, surface: setup.surface, firstServer: setup.firstServer };
}

// 永続化はワールド単位。このアダプターだけがlocalStorageに触れる。
function loadWorld(onSaveError) {
  try {
    const serialized = localStorage.getItem(DATA.storageKey);
    if (serialized !== null) return normalizeWorld(JSON.parse(serialized));
    const legacy = localStorage.getItem(DATA.legacyStorageKey);
    if (legacy !== null) {
      const player = normalizeLegacyPlayer(JSON.parse(legacy));
      if (JSON.stringify(player) !== JSON.stringify(createDefaultEditorPlayer())) {
        const world = createEmptyWorld();
        world.players.push(createWorldPlayer(player));
        if (!saveWorld(world) && onSaveError) onSaveError();
        return world;
      }
    }
    return createEmptyWorld();
  } catch (_) {
    return createEmptyWorld();
  }
}

function saveWorld(world) {
  try {
    localStorage.setItem(DATA.storageKey, JSON.stringify(normalizeWorld(world)));
    return true;
  } catch (_) {
    return false;
  }
}

const WORLD_STORAGE = { load: loadWorld, save: saveWorld };

function calculateScore(card) {
  const average = items => items.reduce((sum, item) => sum + card.stats[item.id], 0) / items.length;
  const base = average(DATA.stats.front) * DATA.score.frontWeight + average(DATA.stats.back) * DATA.score.backWeight;
  let bonus = DATA.toggleGroups.reduce((sum, group) => sum + card[group].length * DATA[group].bonus, 0);
  ["shotSkills", "rankSkills"].forEach(group => {
    DATA[group].items.forEach(item => {
      bonus += DATA[group].levels.find(level => (level.id || level.rank) === card[group][item.id]).bonus;
    });
  });
  const value = Math.max(DATA.score.min, Math.round((base + bonus) * DATA.score.scale));
  return { value, rank: DATA.score.ranks.find(rank => value >= rank.min).rank };
}

(function () {
  let toastTimer;
  let world = WORLD_STORAGE.load(() => toast(DATA.text.storageError));
  let editingPlayer;
  let editingSeriesId;
  // 既存フォームは固定項目とカード項目を結合した編集用データを扱う。
  let player;
  let exporting = false;
  let imageUrl;
  let matchRun = null;
  const form = document.getElementById("player-form");
  const card = document.getElementById("player-card");
  const dialog = document.getElementById("image-dialog");
  const saveButtons = Array.from(document.querySelectorAll("[data-save]"));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function message(template, values) {
    return template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
  }

  Object.entries(DATA.colors).forEach(([key, value]) => document.documentElement.style.setProperty("--" + key, value));
  document.documentElement.style.setProperty("--page-font", DATA.fonts.page);
  document.title = DATA.text.title;
  document.querySelectorAll("[data-text]").forEach(node => { node.textContent = DATA.text[node.dataset.text]; });
  document.getElementById("editor-actions").setAttribute("aria-label", DATA.text.title);
  document.getElementById("list-actions").setAttribute("aria-label", DATA.text.playerList);
  document.getElementById("export-image").alt = DATA.text.imageAlt;
  document.getElementById("series-select").setAttribute("aria-label", DATA.text.series);
  document.getElementById("previous-series").setAttribute("aria-label", DATA.text.previousSeries);
  document.getElementById("next-series").setAttribute("aria-label", DATA.text.nextSeries);

  function persistWorld() {
    if (WORLD_STORAGE.save(world)) return true;
    toast(DATA.text.storageError);
    return false;
  }

  function renderBackup() {
    const last = world.ui.lastExportedAt;
    document.getElementById("last-exported").textContent = last
      ? message(DATA.text.lastExport, { date: formatDateLabel(DATA.backup.dateLabel, new Date(last)) }) : DATA.text.neverExported;
    document.getElementById("backup-warning").hidden = !needsBackup(world);
  }

  const importField = document.getElementById("import-mode");
  importField.append(element("legend", "", DATA.text.importMode));
  const importOptions = element("div", "segments");
  DATA.importModes.forEach((item) => {
    const option = radioOption("importMode", "", item.id, item.name, "segment");
    option.label.querySelector("input").checked = item.id === DATA.initialImportMode;
    importOptions.append(option.label);
  });
  importField.append(importOptions);
  const jsonInput = document.getElementById("json-file");
  jsonInput.accept = DATA.backup.accept;
  jsonInput.setAttribute("aria-label", DATA.text.importJson);
  document.getElementById("import-json").addEventListener("click", () => jsonInput.click());
  jsonInput.addEventListener("change", async () => {
    const file = jsonInput.files[0];
    if (!file) return;
    const mode = importField.querySelector("input:checked").value;
    try {
      const imported = parseWorldImport(await file.text());
      if (mode === "replace" && !window.confirm(DATA.text.replaceConfirm)) return;
      world = importWorld(world, imported, mode);
      const saved = persistWorld();
      history.replaceState(null, "", "#/");
      renderRoute();
      if (saved) toast(DATA.text.importDone);
    } catch (_) {
      toast(DATA.text.importError);
    } finally {
      jsonInput.value = "";
    }
  });

  let exportingJson = false;
  document.getElementById("export-json").addEventListener("click", async () => {
    if (exportingJson) return;
    exportingJson = true;
    const button = document.getElementById("export-json");
    button.disabled = true;
    button.textContent = DATA.text.jsonExporting;
    try {
      const sourceWorld = world;
      const prepared = prepareWorldExport(sourceWorld);
      const file = new File([prepared.text], prepared.filename, { type: DATA.backup.mime });
      let shared = false;
      let canShare = false;
      try { canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { /* download */ }
      if (canShare && navigator.share) {
        try {
          await navigator.share({ files: [file] });
          shared = true;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      if (!shared) {
        const url = URL.createObjectURL(file);
        const link = element("a");
        link.href = url;
        link.download = prepared.filename;
        document.body.append(link);
        try { link.click(); } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), DATA.backup.revokeDelay);
        }
      }
      if (world === sourceWorld) {
        world.ui.lastExportedAt = prepared.world.ui.lastExportedAt;
        persistWorld();
      }
      renderBackup();
    } catch (_) {
      toast(DATA.text.jsonExportError);
    } finally {
      exportingJson = false;
      button.disabled = false;
      button.textContent = DATA.text.exportJson;
    }
  });

  const modeField = document.getElementById("list-mode");
  modeField.append(element("legend", "visually-hidden", DATA.text.listMode));
  const modes = element("div", "segments");
  DATA.listModes.forEach(item => modes.append(radioOption("listMode", "", item.id, item.name, "segment").label));
  modeField.append(modes);
  modeField.addEventListener("change", event => {
    world.ui.listMode = event.target.value;
    persistWorld();
    renderList();
  });
  function selectSeries(id) {
    if (!isValidSeriesId(id) || compareSeries(id, world.latestSeriesId) > 0) return;
    world.ui.seriesId = id;
    persistWorld();
    renderList();
  }
  document.getElementById("series-select").addEventListener("change", event => selectSeries(event.target.value));
  document.getElementById("previous-series").addEventListener("click", () => selectSeries(shiftSeries(world.ui.seriesId, -1)));
  document.getElementById("next-series").addEventListener("click", () => selectSeries(shiftSeries(world.ui.seriesId, 1)));
  document.getElementById("add-series").addEventListener("click", () => {
    addWorldSeries(world);
    persistWorld();
    renderList();
  });
  document.getElementById("delete-series").addEventListener("click", () => {
    if (!deleteLatestSeries(world)) return;
    persistWorld();
    renderList();
  });

  const sortSelect = document.getElementById("list-sort");
  DATA.listSorts.forEach(item => {
    const option = element("option", "", item.name);
    option.value = item.id;
    sortSelect.append(option);
  });
  if (!DATA.listSorts.some(item => item.id === world.ui.sort)) world.ui.sort = DATA.worldUi.sort;
  sortSelect.addEventListener("change", () => {
    world.ui.sort = sortSelect.value;
    persistWorld();
    renderList();
  });
  document.querySelectorAll("[data-add-player]").forEach(button => button.addEventListener("click", () => {
    const added = addWorldPlayer(world);
    persistWorld();
    location.hash = "#/edit/" + added.id + "/" + world.ui.seriesId;
  }));

  function renderList() {
    renderBackup();
    const select = document.getElementById("series-select");
    select.replaceChildren();
    for (const id of seriesIds(world.latestSeriesId)) {
      const option = element("option", "", seriesName(id));
      option.value = id;
      select.append(option);
    }
    select.value = world.ui.seriesId;
    document.getElementById("previous-series").disabled = world.ui.seriesId === DATA.series.startId;
    document.getElementById("next-series").disabled = world.ui.seriesId === world.latestSeriesId;
    document.getElementById("delete-series").disabled = !canDeleteLatestSeries(world);
    modeField.querySelectorAll("input").forEach(input => { input.checked = input.value === world.ui.listMode; });
    sortSelect.value = world.ui.sort;
    const list = document.getElementById("player-list");
    list.replaceChildren();
    const players = listSeriesPlayers(world);
    document.getElementById("empty-players").hidden = players.length > 0;
    players.forEach(item => {
      const current = item.cards[world.ui.seriesId];
      const row = element("a", "player-row");
      row.href = "#/player/" + item.id;
      row.dataset.playerId = item.id;
      if (current) row.style.setProperty("--surface", DATA.basic.surface.find(surface => surface.id === current.surface).color);
      else row.classList.add("missing-card");
      const identity = element("div", "list-identity");
      identity.append(element("strong", "list-name", item.name || DATA.text.anonymous));
      if (current?.nickname) identity.append(element("span", "list-nickname", current.nickname));
      if (current) row.append(identity, cardIcons(current), cardOverall(current));
      else row.append(identity, element("span", "", ""), element("strong", "list-score", DATA.text.missingScore));
      list.append(row);
    });
  }

  function cardIcons(current) {
    const icons = element("div", "list-icons");
    [["playStyle", DATA.playStyles], ["serve", DATA.serves]].forEach(([key, items]) => {
      const type = items.find(choice => choice.id === current[key]);
      const image = element("img");
      image.src = type.icon;
      image.alt = type.name;
      image.width = image.height = 28;
      icons.append(image);
    });
    return icons;
  }

  function cardOverall(current) {
    const score = calculateScore(current);
    const overall = element("div", "list-overall");
    const value = element("div", "score-and-rank");
    value.append(element("strong", "list-score", score.value.toLocaleString("ja-JP")), element("span", "list-rank", score.rank));
    overall.append(element("span", "list-overall-label", DATA.text.overall), value);
    return overall;
  }

  function svgElement(tag, attributes = {}, text) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderHistory(entity) {
    const points = scoreHistory(entity);
    if (!points.length) return element("p", "no-cards", DATA.text.noCards);
    const config = DATA.historyGraph;
    const svg = svgElement("svg", { viewBox: `0 0 ${config.width} ${config.height}`, role: "img", "aria-label": DATA.text.scoreHistory, class: "history-graph" });
    svg.style.fontFamily = DATA.fonts.page;
    const plotWidth = config.width - config.left - config.right;
    const plotHeight = config.height - config.top - config.bottom;
    const scale = historyScale(points);
    svg.dataset.min = scale.min;
    svg.dataset.max = scale.max;
    const scoreY = value => config.top + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
    scale.ticks.forEach(value => {
      const y = scoreY(value);
      svg.append(svgElement("line", { x1: config.left, y1: y, x2: config.width - config.right, y2: y, stroke: DATA.colors.line }),
        svgElement("text", { x: config.left - config.valueLabelGap, y: y + config.valueBaseline, "text-anchor": "end", fill: DATA.colors.muted }, value.toLocaleString("ja-JP")));
    });
    scale.boundaries.forEach(rank => {
      const y = scoreY(rank.min);
      svg.append(svgElement("line", { class: "rank-boundary", "data-rank": rank.rank, "data-score": rank.min, x1: config.left, y1: y, x2: config.width - config.right, y2: y, stroke: DATA.colors.line, "stroke-dasharray": config.rankLineDash }),
        svgElement("text", { class: "rank-boundary-label", x: config.width - config.right + config.rankLabelGap, y: y + config.valueBaseline, fill: DATA.colors.muted }, rank.rank));
    });
    const first = seriesOrder(points[0].seriesId);
    const span = seriesOrder(points[points.length - 1].seriesId) - first;
    const coordinates = points.map(point => ({ ...point,
      x: config.left + plotWidth * (span === 0n ? 0.5 : Number((seriesOrder(point.seriesId) - first) * BigInt(config.precision) / span) / config.precision),
      y: scoreY(point.value)
    }));
    svg.append(svgElement("polyline", { points: coordinates.map(point => `${point.x},${point.y}`).join(" "), fill: "none", stroke: DATA.colors.navy, "stroke-width": config.lineWidth }));
    const labelEvery = Math.max(1, Math.ceil((points.length - 1) / (config.maxLabels - 1)));
    let lastLabelX = -Infinity;
    coordinates.forEach((point, index) => {
      const dot = svgElement("circle", { cx: point.x, cy: point.y, r: config.radius, fill: DATA.statRanks.find(rank => rank.rank === point.rank).color, "data-series": point.seriesId, "data-score": point.value });
      dot.append(svgElement("title", {}, message(DATA.text.graphPoint, { series: seriesName(point.seriesId), score: point.value.toLocaleString("ja-JP"), rank: point.rank })));
      svg.append(dot);
      const last = index === points.length - 1;
      if (last || (index % labelEvery === 0 && point.x - lastLabelX >= config.minLabelGap && coordinates[coordinates.length - 1].x - point.x >= config.minLabelGap)) {
        const [year, period] = point.seriesId.split("-");
        const anchor = points.length === 1 ? "middle" : index === 0 ? "start" : last ? "end" : "middle";
        const label = svgElement("text", { x: point.x, y: config.top + plotHeight + config.seriesLabelGap, "text-anchor": anchor, fill: DATA.colors.muted });
        label.append(svgElement("tspan", { x: point.x }, year), svgElement("tspan", { x: point.x, dy: config.labelLineHeight }, DATA.series.periods[period]));
        svg.append(label);
        lastLabelX = point.x;
      }
    });
    svg.append(svgElement("text", { x: config.width / 2, y: config.height - config.axisBottom, "text-anchor": "middle", fill: DATA.colors.muted }, DATA.text.series));
    return svg;
  }

  function deletePlayerButton(entity) {
    const remove = element("button", "button delete-player", DATA.text.deletePlayer);
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (!window.confirm(message(DATA.text.deleteConfirm, { name: entity.name || DATA.text.anonymous }))) return;
      deleteWorldPlayer(world, entity.id);
      persistWorld();
      history.replaceState(null, "", "#/");
      renderRoute();
    });
    return remove;
  }

  function renderPlayer(entity) {
    const screen = document.getElementById("player-screen");
    screen.replaceChildren();
    const back = element("a", "button secondary", DATA.text.backToList);
    back.href = "#/";
    const identity = element("header", "detail-identity");
    identity.append(element("h2", "detail-name", entity.name || DATA.text.anonymous));
    const latestId = Object.keys(entity.cards).sort(compareSeries).pop();
    if (latestId && entity.cards[latestId].nickname) identity.append(element("p", "", entity.cards[latestId].nickname));
    identity.append(element("p", "detail-meta", DATA.playerFields.filter(key => DATA.basic[key]).map(key => {
      const item = DATA.basic[key].find(item => item.id === entity[key]);
      return item.cardName || item.name;
    }).join(DATA.text.separator)));
    const historyPanel = element("section", "detail-panel");
    historyPanel.append(element("h3", "", DATA.text.scoreHistory), renderHistory(entity));
    const timeline = element("section", "detail-panel");
    timeline.append(element("h3", "", DATA.text.timeline));
    const rows = element("ol", "timeline");
    for (const seriesId of seriesIds(world.latestSeriesId, true)) {
      const row = element("li");
      row.dataset.series = seriesId;
      const current = entity.cards[seriesId];
      if (current) {
        const link = element("a", "timeline-card");
        link.href = "#/edit/" + entity.id + "/" + seriesId;
        link.append(element("span", "timeline-series", seriesName(seriesId)), cardIcons(current), cardOverall(current));
        row.append(link);
      } else {
        const content = element("div", "timeline-empty");
        const create = element("button", "button secondary create-card", DATA.text.createCard);
        create.type = "button";
        create.addEventListener("click", () => {
          if (!createWorldCard(entity, seriesId)) return;
          persistWorld();
          location.hash = "#/edit/" + entity.id + "/" + seriesId;
        });
        content.append(element("span", "timeline-series", seriesName(seriesId)), create);
        row.append(content);
      }
      rows.append(row);
    }
    timeline.append(rows);
    const match = element("button", "button primary", DATA.text.matchWithPlayer);
    match.type = "button";
    match.disabled = !latestId;
    match.addEventListener("click", () => {
      world.ui.matchSetup = normalizeMatchSetup(world, {
        ...world.ui.matchSetup, a: { playerId: entity.id, seriesId: latestId }
      });
      persistWorld();
      location.hash = "#/match";
    });
    screen.append(back, identity, match, historyPanel, timeline, deletePlayerButton(entity));
  }

  function matchSelect(id, label, options, value) {
    const field = element("label", "match-field", label);
    const select = element("select");
    select.id = id;
    options.forEach(item => {
      const option = element("option", "", item.name);
      option.value = item.id;
      option.disabled = Boolean(item.disabled);
      select.append(option);
    });
    select.value = value ?? "";
    field.append(select);
    return { field, select };
  }

  function renderMatchSetup() {
    const screen = document.getElementById("match-setup-screen");
    const ui = DATA.match.ui;
    const setup = normalizeMatchSetup(world, world.ui.matchSetup);
    if (JSON.stringify(setup) !== JSON.stringify(world.ui.matchSetup)) {
      world.ui.matchSetup = setup;
      persistWorld();
    }
    screen.replaceChildren();
    const back = element("a", "button secondary", DATA.text.backToList);
    back.href = "#/";
    const fields = element("form", "match-form");
    const sides = element("div", "match-sides");
    const players = matchPlayers(world);
    function change(selection, side) {
      const focus = document.activeElement.id;
      world.ui.matchSetup = normalizeMatchSetup(world, selection, side);
      persistWorld();
      renderMatchSetup();
      document.getElementById(focus)?.focus();
    }
    ui.sides.forEach(({ id, name }) => {
      const opponent = setup[id === "a" ? "b" : "a"];
      const selected = players.find(item => item.id === setup[id].playerId);
      const panel = element("fieldset", "match-side");
      panel.append(element("legend", "", name));
      const choice = matchSelect("match-" + id + "-player", ui.player,
        players.length ? players.map(item => ({ id: item.id, name: item.name || DATA.text.anonymous })) : [{ id: "", name: ui.choosePlayer }], setup[id].playerId);
      choice.select.disabled = !players.length;
      choice.select.addEventListener("change", () => change({ ...setup, [id]: { playerId: choice.select.value, seriesId: null } }, id));
      const series = matchSelect("match-" + id + "-series", ui.series,
        selected ? matchSeries(selected).map(seriesId => ({ id: seriesId, name: seriesName(seriesId), disabled: selected.id === opponent.playerId && seriesId === opponent.seriesId })) : [{ id: "", name: ui.chooseSeries }], setup[id].seriesId);
      series.select.disabled = !selected;
      series.select.addEventListener("change", () => change({ ...setup, [id]: { ...setup[id], seriesId: series.select.value } }, id));
      panel.append(choice.field, series.field);
      if (selected && setup[id].seriesId) {
        const current = selected.cards[setup[id].seriesId];
        const summary = element("div", "match-card-summary");
        summary.style.setProperty("--surface", DATA.basic.surface.find(item => item.id === current.surface).color);
        summary.append(element("strong", "match-card-name", selected.name || DATA.text.anonymous));
        if (current.nickname) summary.append(element("span", "match-card-nickname", current.nickname));
        summary.append(element("span", "match-card-series", seriesName(setup[id].seriesId)));
        const detail = element("div", "match-card-details");
        detail.append(cardIcons(current), cardOverall(current));
        summary.append(detail);
        panel.append(summary);
      }
      sides.append(panel);
    });
    const settings = element("div", "match-settings");
    [["format", ui.formats], ["surface", DATA.basic.surface], ["firstServer", ui.firstServers]].forEach(([key, options]) => {
      const choice = matchSelect("match-" + key, ui[key], options, setup[key]);
      choice.select.addEventListener("change", () => {
        setup[key] = key === "format" ? Number(choice.select.value) : choice.select.value;
        world.ui.matchSetup = setup;
        persistWorld();
      });
      settings.append(choice.field);
    });
    const start = element("button", "button primary match-start", ui.start);
    start.type = "submit";
    start.disabled = !resolveMatchEntries(world, setup);
    fields.append(sides, settings);
    if (players.length < 2) fields.append(element("p", "match-hint", ui.insufficient));
    else if (start.disabled) fields.append(element("p", "match-hint", ui.duplicate));
    fields.append(start);
    fields.addEventListener("submit", event => {
      event.preventDefault();
      runMatch(setup);
    });
    screen.append(back, element("h2", "", ui.setup), fields);
  }

  function runMatch(setup) {
    const entries = resolveMatchEntries(world, setup);
    if (!entries) return;
    // 結果はメモリだけに保持し、保存するのは対戦設定のみ。
    const options = JSON.parse(JSON.stringify(entries));
    matchRun = { setup: JSON.parse(JSON.stringify(setup)), options, result: TennisMatch.simulate(options) };
    world.ui.matchSetup = matchRun.setup;
    persistWorld();
    if (location.hash === "#/match/play") renderRoute();
    else location.hash = "#/match/play";
  }

  function renderMatchResult() {
    const screen = document.getElementById("match-result-screen");
    screen.replaceChildren();
    const ui = DATA.match.ui;
    const { options, result } = matchRun;
    const winner = options[result.winner];
    const heading = element("header", "match-result-heading");
    heading.append(element("h2", "", ui.result),
      element("p", "match-winner", message(ui.winner, { name: winner.player.name || DATA.text.anonymous })),
      element("p", "match-meta", message(ui.winnerSeries, { side: ui.sides.find(item => item.id === result.winner).name, series: seriesName(winner.seriesId) })));
    const score = element("p", "match-score");
    result.scoreText.split(" ").forEach((set, index) => {
      if (index) score.append(document.createTextNode(" "));
      score.append(element("span", "", set));
    });
    heading.append(score, element("p", "match-meta", [DATA.basic.surface.find(item => item.id === options.surface).name,
      ui.formats.find(item => item.id === options.format).name].join(DATA.text.separator)));
    const table = element("table", "match-stats");
    table.append(element("caption", "", ui.stats));
    const head = element("thead");
    const titles = element("tr");
    titles.append(element("th", "", ui.stats));
    ui.sides.forEach(({ id, name }) => {
      const cell = element("th");
      cell.scope = "col";
      cell.append(element("span", "match-stat-side", name), element("strong", "", options[id].player.name || DATA.text.anonymous),
        element("span", "match-stat-series", seriesName(options[id].seriesId)));
      titles.append(cell);
    });
    head.append(titles);
    const body = element("tbody");
    ui.statRows.forEach(item => {
      const row = element("tr");
      const label = element("th", "", item.name);
      label.scope = "row";
      row.append(label);
      ui.sides.forEach(({ id }) => {
        const stats = result.stats[id];
        let value = stats[item.field].toLocaleString("ja-JP");
        if (item.percent) value = stats[item.total] ? stats[item.field].toLocaleString("ja-JP", { style: "percent", minimumFractionDigits: ui.percentDigits, maximumFractionDigits: ui.percentDigits }) : DATA.text.missingScore;
        else if (item.total) value = message(ui.fraction, { won: value, total: stats[item.total].toLocaleString("ja-JP") });
        row.append(element("td", "", value));
      });
      body.append(row);
    });
    table.append(head, body);
    const actions = element("div", "match-result-actions");
    const again = element("button", "button primary", ui.again);
    again.type = "button";
    again.addEventListener("click", () => runMatch(matchRun.setup));
    const change = element("a", "button secondary", ui.changeSetup);
    change.href = "#/match";
    actions.append(again, change);
    screen.append(heading, table, actions);
  }

  function renderRoute() {
    const route = resolveEditRoute(world, location.hash);
    const detail = resolvePlayerRoute(world, location.hash);
    if (location.hash === "#/match/play" && !matchRun) history.replaceState(null, "", "#/match");
    const setup = location.hash === "#/match";
    const result = location.hash === "#/match/play";
    if (!route && !detail && !setup && !result && location.hash !== "#/") history.replaceState(null, "", "#/");
    document.getElementById("list-screen").hidden = Boolean(route || detail || setup || result);
    document.getElementById("list-actions").hidden = Boolean(route || detail || setup || result);
    document.getElementById("player-screen").hidden = !detail;
    document.getElementById("match-setup-screen").hidden = !setup;
    document.getElementById("match-result-screen").hidden = !result;
    document.getElementById("editor-screen").hidden = !route;
    document.getElementById("editor-actions").hidden = !route;
    if (route) {
      editingPlayer = route.player;
      editingSeriesId = route.seriesId;
      player = { ...normalizeFixedFields(editingPlayer), ...normalizeCard(editingPlayer.cards[editingSeriesId]) };
      document.getElementById("editor-series").textContent = seriesName(editingSeriesId);
      updateEditorBack();
      buildForm();
      syncForm();
      renderCard();
    } else {
      editingPlayer = player = undefined;
      editingSeriesId = undefined;
      if (detail) renderPlayer(detail);
      else if (setup) renderMatchSetup();
      else if (result) renderMatchResult();
      else renderList();
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function updateEditorBack() {
    const back = document.getElementById("back-to-player");
    back.href = "#/player/" + editingPlayer.id;
    back.textContent = message(DATA.text.backToPlayer, { name: editingPlayer.name || DATA.text.anonymous });
  }

  function section(title) {
    const details = element("details", "form-section");
    details.open = true;
    const summary = element("summary");
    summary.dataset.expandMark = DATA.text.expandMark;
    summary.dataset.collapseMark = DATA.text.collapseMark;
    summary.append(element("h2", "", title));
    const body = element("div", "section-body");
    details.append(summary, body);
    form.append(details);
    return body;
  }

  function legendField(title, className) {
    const field = element("fieldset", className);
    field.append(element("legend", "", title));
    return field;
  }

  function radioOption(group, key, value, caption, className, desc) {
    const label = element("label", className);
    const input = element("input", "choice-input");
    input.type = "radio";
    input.name = group + (key ? "-" + key : "");
    input.value = value;
    input.dataset.group = group;
    if (key) input.dataset.key = key;
    const content = element("span", "choice-content", caption);
    if (desc) input.setAttribute("aria-label", caption + DATA.text.separator + desc);
    label.append(input, content);
    return { label, content };
  }

  function setPoseHand(svg) {
    const [x, , width] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const body = svg.querySelector("[data-pose-body]");
    svg.dataset.hand = player.hand;
    if (player.hand === "left") body.setAttribute("transform", `translate(${2 * x + width} 0) scale(-1 1)`);
    else body.removeAttribute("transform");
  }

  function poseGraphic(pose) {
    const source = new DOMParser().parseFromString(DATA.poseSvg[pose.file], "image/svg+xml").documentElement;
    const svg = document.importNode(source, true);
    svg.classList.add("pose-silhouette");
    svg.dataset.pose = pose.id;
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
    const body = document.createElementNS(svg.namespaceURI, "g");
    body.setAttribute("data-pose-body", "");
    while (svg.firstChild) body.append(svg.firstChild);
    svg.append(body);
    setPoseHand(svg);
    return svg;
  }

  function buildForm() {
    form.replaceChildren();
    const basic = section(DATA.text.basic);
    DATA.textFields.forEach(field => {
      const label = element("label", "text-field");
      const heading = element("span", "field-heading", field.name);
      const hint = message(DATA.text.maxLength, { max: field.max }) + (field.optional ? DATA.text.separator + DATA.text.optional : "");
      heading.append(element("small", "", hint));
      if (DATA.playerFields.includes(field.id)) heading.append(element("small", "common-fields", DATA.text.commonFields));
      const input = element("input");
      input.type = "text";
      input.name = field.id;
      input.id = field.id;
      input.maxLength = field.max;
      input.autocomplete = "off";
      input.dataset.group = "text";
      input.dataset.key = field.id;
      label.append(heading, input);
      basic.append(label);
    });
    Object.entries(DATA.basic).forEach(([key, items]) => {
      const field = legendField(DATA.basicLabels[key], "basic-choice");
      if (DATA.playerFields.includes(key)) field.querySelector("legend").append(element("small", "common-fields", DATA.text.commonFields));
      const options = element("div", "segments");
      items.forEach(item => options.append(radioOption("basic", key, item.id, item.name, "segment").label));
      field.append(options);
      basic.append(field);
    });

    const stats = section(DATA.text.stats);
    ["front", "back"].forEach(group => {
      const field = legendField(DATA.text[group + "Stats"], "stats-field");
      DATA.stats[group].forEach(item => {
        const row = element("div", "stat-input-row");
        const label = element("label", "field-heading", item.name);
        label.htmlFor = "number-" + item.id;
        const desc = element("p", "description", item.desc);
        desc.id = "desc-" + item.id;
        const controls = element("div", "stat-controls");
        ["range", "number"].forEach(type => {
          const input = element("input");
          input.type = type;
          input.id = type + "-" + item.id;
          input.name = type + "-" + item.id;
          input.min = DATA.stats.min;
          input.max = DATA.stats.max;
          input.step = "1";
          input.dataset.group = "stats";
          input.dataset.key = item.id;
          input.setAttribute("aria-label", message(DATA.text[type === "range" ? "range" : "numeric"], { name: item.name }));
          input.setAttribute("aria-describedby", desc.id);
          if (type === "number") input.inputMode = "numeric";
          controls.append(input);
        });
        row.append(label, desc, controls);
        field.append(row);
      });
      stats.append(field);
    });

    const choices = section(DATA.text.styleAndServe);
    [["playStyle", DATA.playStyles], ["serve", DATA.serves]].forEach(([key, items]) => {
      const field = legendField(DATA.text[key], "tile-field");
      const tiles = element("div", "tiles");
      items.forEach(item => {
        const option = radioOption(key, null, item.id, undefined, "tile");
        option.label.style.setProperty("--type-color", item.color);
        const image = element("img", "choice-icon");
        image.src = item.icon;
        image.alt = "";
        image.width = 48;
        image.height = 48;
        option.content.append(image, element("strong", "", item.name), element("span", "description", item.desc));
        tiles.append(option.label);
      });
      field.append(tiles);
      choices.append(field);
    });

    const illustration = section(DATA.text.illustration);
    const poses = element("div", "tiles pose-tiles");
    DATA.poses.forEach(pose => {
      const option = radioOption("pose", null, pose.id, undefined, "tile pose-tile");
      const preview = element("span", "pose-preview");
      if (pose.file) preview.append(poseGraphic(pose));
      const caption = element("strong");
      (pose.labelParts || [pose.name]).forEach((part, index) => {
        if (index) caption.append(element("wbr"));
        caption.append(element("span", "pose-word", part));
      });
      option.content.append(preview, caption);
      poses.append(option.label);
    });
    illustration.append(poses);

    const special = section(DATA.text.special);
    ["shotSkills", "rankSkills"].forEach(group => {
      const container = element("div", "skill-group " + group);
      container.append(element("h3", "", DATA[group].label));
      DATA[group].items.forEach(item => {
        const field = legendField(item.name, "skill-row");
        if (item.desc) field.append(element("p", "description", item.desc));
        const options = element("div", "segments");
        DATA[group].levels.forEach(level => {
          options.append(radioOption(group, item.id, level.id || level.rank, level.mark || level.rank, "segment", level.name).label);
        });
        field.append(options);
        container.append(field);
      });
      special.append(container);
    });
    DATA.toggleGroups.forEach(group => {
      const field = legendField(DATA[group].label, "toggle-group");
      DATA[group].items.forEach(item => {
        const label = element("label", "toggle-row");
        const input = element("input");
        input.type = "checkbox";
        input.name = group + "-" + item.id;
        input.dataset.group = group;
        input.dataset.key = item.id;
        const content = element("span", "toggle-content");
        content.append(element("strong", "", item.name), element("span", "description", item.desc));
        label.append(input, content);
        field.append(label);
      });
      special.append(field);
    });
    const reset = element("button", "button reset-button", DATA.text.reset);
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (!window.confirm(DATA.text.resetConfirm)) return;
      resetWorldCard(editingPlayer, editingSeriesId);
      player = { ...normalizeFixedFields(editingPlayer), ...editingPlayer.cards[editingSeriesId] };
      if (commit()) toast(DATA.text.resetDone);
    });
    form.append(reset);
    const copy = element("button", "button secondary copy-previous", DATA.text.copyPrevious);
    copy.type = "button";
    const previous = nearestCardSeries(editingPlayer, editingSeriesId, false);
    copy.disabled = !previous;
    copy.addEventListener("click", () => {
      if (!previous || !window.confirm(message(DATA.text.copyConfirm, { series: seriesName(previous) }))) return;
      if (!copyPreviousCard(editingPlayer, editingSeriesId)) return;
      player = { ...normalizeFixedFields(editingPlayer), ...normalizeCard(editingPlayer.cards[editingSeriesId]) };
      if (commit()) toast(DATA.text.copyDone);
    });
    form.append(copy);
    if (Object.keys(editingPlayer.cards).length > 1) {
      const remove = element("button", "button delete-player delete-card", DATA.text.deleteCard);
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (!window.confirm(message(DATA.text.deleteCardConfirm, { series: seriesName(editingSeriesId) }))) return;
        if (!deleteWorldCard(editingPlayer, editingSeriesId)) return;
        persistWorld();
        history.replaceState(null, "", "#/player/" + editingPlayer.id);
        renderRoute();
      });
      form.append(remove);
    } else form.append(element("p", "single-card-hint", DATA.text.singleCardHint));
  }

  function syncForm() {
    form.querySelectorAll("input[data-group]").forEach(input => {
      const { group, key } = input.dataset;
      if (input.type === "checkbox") input.checked = player[group].includes(key);
      else if (input.type === "radio") {
        const value = group === "basic" ? player[key] : key ? player[group][key] : player[group];
        input.checked = input.value === value;
      } else {
        const value = String(group === "text" ? player[key] : player.stats[key]);
        if (input.value !== value) input.value = value;
      }
    });
    form.querySelectorAll(".pose-silhouette").forEach(setPoseHand);
  }

  function statRank(value) {
    return DATA.statRanks.find(rank => value >= rank.min);
  }

  function renderCard() {
    card.replaceChildren();
    const surface = DATA.basic.surface.find(item => item.id === player.surface);
    const header = element("header", "court-header");
    header.style.setProperty("--surface", surface.color);
    header.style.setProperty("--outer", surface.outer || surface.color);
    header.style.setProperty("--stripe", surface.stripe || surface.color);
    header.classList.toggle("striped", Boolean(surface.stripe));
    const svgNamespace = "http://www.w3.org/2000/svg";
    const courtLines = document.createElementNS(svgNamespace, "svg");
    courtLines.classList.add("court-lines");
    courtLines.setAttribute("viewBox", "0 0 300 120");
    courtLines.setAttribute("preserveAspectRatio", "none");
    courtLines.setAttribute("aria-hidden", "true");
    [
      ["rect", { x: 1, y: 1, width: 298, height: 118 }],
      ["line", { x1: 22, y1: 1, x2: 22, y2: 119 }],
      ["line", { x1: 278, y1: 1, x2: 278, y2: 119 }],
      ["line", { x1: 22, y1: 25, x2: 278, y2: 25 }],
      ["line", { x1: 22, y1: 95, x2: 278, y2: 95 }],
      ["line", { x1: 150, y1: 25, x2: 150, y2: 95 }]
    ].forEach(([tag, attributes]) => {
      const line = document.createElementNS(svgNamespace, tag);
      Object.entries(attributes).forEach(([key, value]) => line.setAttribute(key, value));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", DATA.colors.white);
      line.setAttribute("stroke-width", "1");
      courtLines.append(line);
    });
    const identity = element("div", "card-identity");
    identity.append(element("span", "series-badge", seriesName(editingSeriesId)));
    if (player.nickname) identity.append(element("p", "nickname", player.nickname));
    const name = element("h2", "card-name", player.name || DATA.text.anonymous);
    name.id = "card-name";
    identity.append(name);
    const meta = Object.keys(DATA.basic).map(key => {
      const item = DATA.basic[key].find(choice => choice.id === player[key]);
      return item.cardName || item.name;
    });
    identity.append(element("p", "card-meta", meta.join(DATA.text.separator)));
    const score = calculateScore(editingPlayer.cards[editingSeriesId]);
    const overall = element("div", "overall");
    overall.append(element("span", "overall-label", DATA.text.overall), element("strong", "score-number", score.value.toLocaleString("ja-JP")), element("span", "overall-rank", score.rank));
    header.append(courtLines);
    const pose = DATA.poses.find(item => item.id === player.pose);
    if (pose.file) {
      const silhouette = poseGraphic(pose);
      const [, , width, height] = silhouette.getAttribute("viewBox").split(/\s+/).map(Number);
      const background = element("div", "card-pose");
      background.style.aspectRatio = `${width} / ${height}`;
      background.append(silhouette);
      header.append(background);
    }
    header.append(identity, overall);

    const stats = element("div", "card-stats");
    DATA.stats.front.forEach(item => {
      const value = player.stats[item.id];
      const rank = statRank(value);
      const row = element("div", "front-stat");
      row.style.setProperty("--rank-color", rank.color);
      row.dataset.stat = item.id;
      const bar = element("span", "stat-bar");
      bar.setAttribute("aria-hidden", "true");
      const fill = element("span", "stat-fill");
      fill.style.width = value / DATA.stats.max * 100 + "%";
      bar.append(fill);
      row.append(element("span", "stat-label", item.name), element("strong", "stat-rank", rank.rank), element("strong", "stat-value", value), bar);
      stats.append(row);
    });
    const backStats = element("div", "back-stats");
    DATA.stats.back.forEach(item => {
      const value = player.stats[item.id];
      const rank = statRank(value);
      const row = element("div", "back-stat");
      row.style.setProperty("--rank-color", rank.color);
      row.dataset.stat = item.id;
      row.append(element("span", "stat-label", item.name), element("strong", "stat-rank", rank.rank), element("strong", "stat-value", value));
      backStats.append(row);
    });
    stats.append(backStats);

    const styles = element("div", "card-styles");
    [["playStyle", DATA.playStyles], ["serve", DATA.serves]].forEach(([key, items]) => {
      const item = items.find(choice => choice.id === player[key]);
      const style = element("div", "card-style");
      style.style.setProperty("--type-color", item.color);
      const image = element("img", "choice-icon");
      image.src = item.icon;
      image.alt = "";
      image.width = 48;
      image.height = 48;
      const caption = element("div");
      caption.append(element("span", "style-label", DATA.text[key]), element("strong", "style-name", item.name));
      style.append(image, caption);
      styles.append(style);
    });

    const chips = element("div", "card-skills");
    DATA.chipOrder.forEach(({ group, level, chip }) => {
      DATA[group].items.forEach(item => {
        let suffix = "";
        if (group === "shotSkills") {
          if (player[group][item.id] !== level) return;
          suffix = DATA[group].levels.find(entry => entry.id === level).mark;
        } else if (group === "rankSkills") {
          if (player[group][item.id] === DATA[group].initial) return;
          suffix = player[group][item.id];
        } else if (!player[group].includes(item.id)) return;
        const tag = element("span", "skill-chip chip-" + chip, item.name);
        tag.dataset.skill = item.id;
        if (group === "rankSkills") {
          const rank = element("strong", "chip-rank", suffix);
          rank.style.color = DATA.statRanks.find(entry => entry.rank === suffix).color;
          tag.append(rank);
        } else tag.append(document.createTextNode(suffix));
        chips.append(tag);
      });
    });
    if (!chips.childElementCount) chips.append(element("p", "no-skills", DATA.text.noSkills));
    card.append(header, stats, styles, chips);
  }

  function commit() {
    DATA.playerFields.forEach(key => { editingPlayer[key] = player[key]; });
    editingPlayer.cards[editingSeriesId] = normalizeCard(player);
    updateEditorBack();
    syncForm();
    renderCard();
    return persistWorld();
  }

  function toast(text) {
    clearTimeout(toastTimer);
    const node = document.getElementById("toast");
    node.textContent = text;
    node.classList.add("visible");
    toastTimer = setTimeout(() => node.classList.remove("visible"), 5000);
  }

  function handleInput(event) {
    const input = event.target;
    const { group, key } = input.dataset;
    if (!player || !group || event.isComposing) return;
    if (group === "stats") {
      if (input.value === "" || !Number.isFinite(input.valueAsNumber)) {
        if (event.type === "change") input.value = player.stats[key];
        return;
      }
      player.stats[key] = clampStat(input.valueAsNumber);
    } else if (group === "text") {
      const field = DATA.textFields.find(item => item.id === key);
      player[key] = Array.from(input.value).slice(0, field.max).join("");
    } else if (group === "basic") player[key] = input.value;
    else if (DATA.toggleGroups.includes(group)) {
      player[group] = player[group].filter(id => id !== key);
      if (input.checked) {
        player[group].push(key);
        DATA.exclusive.filter(pair => pair.includes(key)).forEach(pair => {
          pair.filter(id => id !== key).forEach(id => {
            DATA.toggleGroups.forEach(other => {
              if (!player[other].includes(id)) return;
              player[other] = player[other].filter(selected => selected !== id);
              toast(message(DATA.text.conflict, {
                removed: DATA[other].items.find(item => item.id === id).name,
                selected: DATA[group].items.find(item => item.id === key).name
              }));
            });
          });
        });
      }
    } else if (key) player[group][key] = input.value;
    else player[group] = input.value;
    commit();
  }

  form.addEventListener("submit", event => event.preventDefault());
  form.addEventListener("input", handleInput);
  // inputとchangeの二重適用で、排他チェックのトーストが消えることはない。
  form.addEventListener("change", handleInput);
  form.addEventListener("compositionend", handleInput);
  document.getElementById("view-card").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  function fileName(name, seriesId) {
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/[. ]+$/g, "_");
    return "tennis-card" + (safeName ? "_" + safeName : "") + "_" + seriesName(seriesId, true) + ".png";
  }

  function showImage(blob, filename) {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(blob);
    document.getElementById("export-image").src = imageUrl;
    const download = document.getElementById("download-image");
    download.href = imageUrl;
    download.download = filename;
    dialog.showModal();
  }

  async function inlineExportIcons(snapshot) {
    await Promise.all(Array.from(snapshot.querySelectorAll("img")).map(async image => {
      const path = image.getAttribute("src");
      // ローカルファイルはブラウザがfetchとCanvasの画像利用を制限するため、
      // 支給ファイルと同一内容のデータを使う。HTTPでは支給ファイルを取得する。
      let source;
      if (location.protocol === "file:") source = DATA.iconSvg[path];
      else {
        const response = await fetch(path);
        if (!response.ok) throw new Error("SVG unavailable");
        source = await response.text();
      }
      const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
      if (svg.localName !== "svg") throw new Error("Invalid SVG");
      const icon = document.importNode(svg, true);
      icon.setAttribute("class", image.className);
      icon.setAttribute("width", image.width);
      icon.setAttribute("height", image.height);
      image.replaceWith(icon);
    }));
  }

  async function exportImage() {
    if (exporting || !player) return;
    exporting = true;
    saveButtons.forEach(button => { button.disabled = true; button.textContent = DATA.text.saving; });
    // 出力中の入力やスクロールに影響されないよう、現在のカードを固定して撮影する。
    const snapshot = card.cloneNode(true);
    snapshot.removeAttribute("id");
    const holder = element("div", "export-holder");
    holder.setAttribute("aria-hidden", "true");
    holder.style.width = card.getBoundingClientRect().width + "px";
    holder.append(snapshot);
    document.body.append(holder);
    const filename = fileName(player.name, editingSeriesId);
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(snapshot.querySelectorAll("img")).map(image => image.decode()));
      if (typeof html2canvas !== "function") throw new Error("html2canvas unavailable");
      if (location.protocol === "file:") await inlineExportIcons(snapshot);
      async function renderPng() {
        const canvas = await html2canvas(snapshot, {
          scale: 2, backgroundColor: DATA.colors.paper, logging: false, scrollX: 0, scrollY: 0
        });
        return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("PNG unavailable")), "image/png"));
      }
      let blob;
      try { blob = await renderPng(); } catch (error) {
        if (error.name !== "SecurityError" || location.protocol === "file:") throw error;
        await inlineExportIcons(snapshot);
        blob = await renderPng();
      }
      const file = new File([blob], filename, { type: "image/png" });
      let canShare = false;
      try { canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { /* fallback */ }
      if (canShare && navigator.share) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
          // 共有権限・ユーザー操作の有効期限などで失敗した場合は画像を渡す。
        }
      }
      showImage(blob, filename);
    } catch (_) {
      toast(DATA.text.exportError);
    } finally {
      holder.remove();
      exporting = false;
      saveButtons.forEach(button => { button.disabled = false; button.textContent = DATA.text.saveImage; });
    }
  }

  saveButtons.forEach(button => button.addEventListener("click", exportImage));
  document.getElementById("close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    document.getElementById("export-image").removeAttribute("src");
    document.getElementById("download-image").removeAttribute("href");
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
  });

  window.addEventListener("hashchange", renderRoute);
  renderRoute();
})();
