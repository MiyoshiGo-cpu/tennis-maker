"use strict";

function createDefaultPlayer() {
  const player = { version: DATA.version, ...DATA.initial, stats: {}, shotSkills: {}, rankSkills: {} };
  DATA.textFields.forEach(field => { player[field.id] = field.initial; });
  [...DATA.stats.front, ...DATA.stats.back].forEach(item => { player.stats[item.id] = DATA.stats.initial; });
  DATA.shotSkills.items.forEach(item => { player.shotSkills[item.id] = DATA.shotSkills.initial; });
  DATA.rankSkills.items.forEach(item => { player.rankSkills[item.id] = DATA.rankSkills.initial; });
  DATA.toggleGroups.forEach(group => { player[group] = []; });
  return player;
}

function clampStat(value) {
  return Math.max(DATA.stats.min, Math.min(DATA.stats.max, Math.round(value)));
}

function normalizePlayer(raw) {
  const player = createDefaultPlayer();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return player;
  DATA.textFields.forEach(field => {
    if (typeof raw[field.id] === "string") player[field.id] = Array.from(raw[field.id]).slice(0, field.max).join("");
  });
  const choices = { ...DATA.basic, playStyle: DATA.playStyles, serve: DATA.serves };
  Object.entries(choices).forEach(([key, items]) => {
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

// 保存先に依存する処理はこの2関数のみ。描画・入力は PLAYER_STORAGE を通す。
// 将来の複数選手・シリーズ対応では、このアダプターを差し替える。
function loadPlayer() {
  try {
    const serialized = localStorage.getItem(DATA.storageKey);
    return normalizePlayer(serialized ? JSON.parse(serialized) : null);
  } catch (_) {
    return createDefaultPlayer();
  }
}

function savePlayer(player) {
  try {
    localStorage.setItem(DATA.storageKey, JSON.stringify(normalizePlayer(player)));
    return true;
  } catch (_) {
    return false;
  }
}

const PLAYER_STORAGE = { load: loadPlayer, save: savePlayer };

function calculateScore(player) {
  const average = items => items.reduce((sum, item) => sum + player.stats[item.id], 0) / items.length;
  const base = average(DATA.stats.front) * DATA.score.frontWeight + average(DATA.stats.back) * DATA.score.backWeight;
  let bonus = DATA.toggleGroups.reduce((sum, group) => sum + player[group].length * DATA[group].bonus, 0);
  ["shotSkills", "rankSkills"].forEach(group => {
    DATA[group].items.forEach(item => {
      bonus += DATA[group].levels.find(level => (level.id || level.rank) === player[group][item.id]).bonus;
    });
  });
  const value = Math.max(DATA.score.min, Math.round((base + bonus) * DATA.score.scale));
  return { value, rank: DATA.score.ranks.find(rank => value >= rank.min).rank };
}

(function () {
  let player = PLAYER_STORAGE.load();
  let toastTimer;
  let exporting = false;
  let imageUrl;
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
  document.title = DATA.text.title;
  document.querySelectorAll("[data-text]").forEach(node => { node.textContent = DATA.text[node.dataset.text]; });
  document.querySelector(".mobile-actions").setAttribute("aria-label", DATA.text.title);
  document.getElementById("export-image").alt = DATA.text.imageAlt;

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

  function buildForm() {
    form.replaceChildren();
    const basic = section(DATA.text.basic);
    DATA.textFields.forEach(field => {
      const label = element("label", "text-field");
      const heading = element("span", "field-heading", field.name);
      const hint = message(DATA.text.maxLength, { max: field.max }) + (field.optional ? DATA.text.separator + DATA.text.optional : "");
      heading.append(element("small", "", hint));
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
      player = createDefaultPlayer();
      commit();
      toast(DATA.text.resetDone);
    });
    form.append(reset);
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
    if (player.nickname) identity.append(element("p", "nickname", player.nickname));
    const name = element("h2", "card-name", player.name || DATA.text.anonymous);
    name.id = "card-name";
    identity.append(name);
    const meta = Object.keys(DATA.basic).map(key => {
      const item = DATA.basic[key].find(choice => choice.id === player[key]);
      return item.cardName || item.name;
    });
    identity.append(element("p", "card-meta", meta.join(DATA.text.separator)));
    const score = calculateScore(player);
    const overall = element("div", "overall");
    overall.append(element("span", "overall-label", DATA.text.overall), element("strong", "score-number", score.value.toLocaleString("ja-JP")), element("span", "overall-rank", score.rank));
    header.append(courtLines, identity, overall);

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
    syncForm();
    renderCard();
    PLAYER_STORAGE.save(player);
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
    if (!group || event.isComposing) return;
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

  function fileName(name) {
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/[. ]+$/g, "_");
    return safeName ? "tennis-card_" + safeName + ".png" : "tennis-card.png";
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
    if (exporting) return;
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
    const filename = fileName(player.name);
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

  buildForm();
  syncForm();
  renderCard();
})();
