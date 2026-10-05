// Node標準機能だけで実行: node --test tests/storage.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const dataSource = fs.readFileSync(path.join(root, "data.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const storageSource = appSource.slice(0, appSource.indexOf("(function () {"));
const copy = value => JSON.parse(JSON.stringify(value));

function harness(entries = {}, blocked = false) {
  const values = new Map(Object.entries(entries));
  const writes = [];
  const context = vm.createContext({
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Storage denied"); return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { if (blocked) throw new Error("Storage denied"); writes.push(key); values.set(key, value); },
      removeItem() { throw new Error("Legacy data must never be deleted"); }
    }
  });
  vm.runInContext(dataSource + "\n" + storageSource, context);
  return { run: source => vm.runInContext(source, context), values, writes };
}

test("v1の全項目を固定情報と開始シリーズのカードに分け、元データを残す", () => {
  const legacy = {
    version: 1, name: "山田 太郎", hand: "left", backhand: "one", nickname: "コートの司令塔",
    surface: "clay", stats: { control: 84, power: 72, speed: 65, stamina: 55, mental: 70, net: 61 },
    playStyle: "aggressive", serve: "kick", shotSkills: { volley: "great", smash: "good", lob: "bad" },
    rankSkills: { clutch: "A" }, gold: ["precision"], plus: ["rising"], minus: ["short_temper"]
  };
  const serialized = JSON.stringify(legacy);
  const h = harness({ "tennisMaker.v1.player": serialized });
  const world = copy(h.run("WORLD_STORAGE.load()"));
  assert.equal(world.version, 2);
  assert.equal(world.latestSeriesId, "2017-1");
  assert.equal(world.players.length, 1);
  const player = world.players[0], card = player.cards["2017-1"];
  ["name", "hand", "backhand"].forEach(key => assert.equal(player[key], legacy[key]));
  assert.match(player.id, /^p_[a-z0-9]{5,}$/);
  assert.equal(new Date(player.createdAt).toISOString(), player.createdAt);
  ["nickname", "surface", "stats", "playStyle", "serve", "gold", "plus", "minus"].forEach(key => assert.deepEqual(card[key], legacy[key]));
  Object.entries(legacy.shotSkills).forEach(([key, value]) => assert.equal(card.shotSkills[key], value));
  assert.equal(card.rankSkills.clutch, "A");
  ["name", "hand", "backhand", "version", "id", "createdAt"].forEach(key => assert.ok(!(key in card)));
  assert.deepEqual(JSON.parse(h.values.get("tennisMaker.v2.world")), world);
  assert.equal(h.values.get("tennisMaker.v1.player"), serialized);
});

test("v1が初期値・欠損初期値・未知項目だけなら移行保存しない", () => {
  const defaults = copy(harness().run("createDefaultEditorPlayer()"));
  for (const value of [defaults, { version: 1 }, { stats: { control: 50 }, shotSkills: {}, rankSkills: {}, alien: true }]) {
    const h = harness({ "tennisMaker.v1.player": JSON.stringify(value) });
    assert.equal(h.run("WORLD_STORAGE.load().players.length"), 0);
    assert.equal(h.writes.length, 0);
    assert.ok(h.values.has("tennisMaker.v1.player"));
  }
  const missing = harness();
  assert.deepEqual(copy(missing.run("WORLD_STORAGE.load()")), {
    version: 2, latestSeriesId: "2017-1", players: [],
    ui: { seriesId: "2017-1", listMode: "series", sort: "score", lastExportedAt: null }
  });
});

test("v1のどの既知項目を1つ変更しても移行する", () => {
  const defaults = copy(harness().run("createDefaultEditorPlayer()"));
  const mutations = [
    p => p.name = "選手", p => p.nickname = "二つ名", p => p.hand = "left", p => p.backhand = "one",
    p => p.surface = "grass", p => p.playStyle = "trickster", p => p.serve = "under",
    ...Object.keys(defaults.stats).map(key => p => p.stats[key] = 51),
    ...Object.keys(defaults.shotSkills).map(key => p => p.shotSkills[key] = "good"),
    ...Object.keys(defaults.rankSkills).map(key => p => p.rankSkills[key] = "C"),
    p => p.gold = ["ironman"], p => p.plus = ["rising"], p => p.minus = ["streaky"]
  ];
  mutations.forEach(mutate => {
    const player = copy(defaults); mutate(player);
    const h = harness({ "tennisMaker.v1.player": JSON.stringify(player) });
    assert.equal(h.run("WORLD_STORAGE.load().players.length"), 1);
    assert.deepEqual(h.writes, ["tennisMaker.v2.world"]);
  });
});

test("v2を優先し、空や壊れたv2でもv1を二重移行しない", () => {
  for (const v2 of [JSON.stringify({ version: 2, players: [] }), "{broken", "null"]) {
    const h = harness({ "tennisMaker.v2.world": v2, "tennisMaker.v1.player": JSON.stringify({ name: "旧選手" }) });
    assert.equal(h.run("WORLD_STORAGE.load().players.length"), 0);
    assert.equal(h.writes.length, 0);
  }
});

test("ワールドを正規化し、シリーズ順・範囲・重複ID・未知項目を処理する", () => {
  const raw = {
    version: 2, latestSeriesId: "2018-1", alien: true,
    players: [null, {
      id: "p_existing1234", name: "あ".repeat(15), hand: "unknown", backhand: "one", alien: true,
      createdAt: "2026-10-06T12:00:00.000Z", cards: {
        "2017-2": { stats: { control: 200, power: -2, speed: 77.6, alien: 88 }, name: "カード名", gold: ["precision", "precision", "unknown"], shotSkills: { volley: "great", unknown: "bad" }, rankSkills: { clutch: "S" }, plus: ["fast_start"], minus: ["slow_starter"] },
        "2020-1": {}, "10000-2": {}, "2017-1": {},
        "2016-2": {}, "2017-3": {}, "invalid": {}, "02017-1": {}
      }
    }, { id: "p_existing1234", cards: { "2017-1": {} } }],
    ui: { seriesId: "2020-1", listMode: "series", sort: "score", lastExportedAt: null, alien: true }
  };
  const h = harness({ "tennisMaker.v2.world": JSON.stringify(raw) });
  const world = copy(h.run("WORLD_STORAGE.load()"));
  assert.equal(world.latestSeriesId, "10000-2");
  assert.equal(world.players.length, 2);
  assert.equal(new Set(world.players.map(p => p.id)).size, 2);
  assert.equal(world.players[0].name.length, 12);
  assert.equal(world.players[0].hand, "right");
  const cards = world.players[0].cards;
  assert.deepEqual(Object.keys(cards).sort(), ["10000-2", "2017-1", "2017-2", "2020-1"].sort());
  const card = cards["2017-2"];
  assert.deepEqual(card.stats, { control: 99, power: 1, speed: 78, stamina: 50, mental: 50, net: 50 });
  assert.deepEqual(card.gold, ["precision"]);
  assert.deepEqual(card.minus, []);
  assert.equal(card.shotSkills.volley, "great");
  assert.equal(card.rankSkills.clutch, "D");
  assert.ok(!("name" in card));
  assert.ok(!("alien" in world) && !("alien" in world.ui) && !("alien" in world.players[0]));
  assert.equal(h.run('compareSeries("2019-2", "2020-1")'), -1);
  assert.equal(h.run('compareSeries("9999-2", "10000-1")'), -1);
});

test("書き込みはv2だけに行い、他選手・他カードとv1を保持する", () => {
  const h = harness({ "tennisMaker.v1.player": "legacy backup" });
  h.run('var world = createEmptyWorld(); world.players.push(createWorldPlayer({name:"一人目"})); world.players.push(createWorldPlayer({name:"二人目"},new Set(world.players.map(p=>p.id)))); world.players[0].cards["2018-2"] = normalizeCard({stats:{power:99}});');
  const before = copy(h.run("world"));
  h.run('world.players[0].cards["2017-1"].stats.control = 84; WORLD_STORAGE.save(world);');
  const saved = JSON.parse(h.values.get("tennisMaker.v2.world"));
  assert.equal(saved.players[0].cards["2017-1"].stats.control, 84);
  assert.deepEqual(saved.players[0].cards["2018-2"], before.players[0].cards["2018-2"]);
  assert.deepEqual(saved.players[1], before.players[1]);
  assert.equal(saved.latestSeriesId, "2018-2");
  assert.equal(h.values.get("tennisMaker.v1.player"), "legacy backup");
  assert.deepEqual(h.writes, ["tennisMaker.v2.world"]);
});

test("localStorageが使えなくても読み書きの例外を外へ出さない", () => {
  const h = harness({}, true);
  assert.equal(h.run("WORLD_STORAGE.load().players.length"), 0);
  assert.equal(h.run("WORLD_STORAGE.save(createEmptyWorld())"), false);
});

test("総合力の4つの検算値はカード単位で一致する", () => {
  const h = harness();
  const actual = copy(h.run(`(() => {
    let card = createDefaultCard(); const scores = [calculateScore(card)];
    Object.keys(card.stats).forEach(key => card.stats[key] = 99); scores.push(calculateScore(card));
    card = createDefaultCard(); DATA.stats.front.forEach(item => card.stats[item.id] = 80); scores.push(calculateScore(card));
    card.gold = ["precision", "ironman"]; scores.push(calculateScore(card)); return scores;
  })()`));
  assert.deepEqual(actual, [{ value: 2000, rank: "D" }, { value: 3960, rank: "S" }, { value: 2840, rank: "B" }, { value: 3080, rank: "B" }]);
});

test("表示中のシリーズに初期カード付き選手を3人追加し、保存後もIDが重複しない", () => {
  const h = harness();
  h.run('var world = createEmptyWorld(); world.latestSeriesId = world.ui.seriesId = "2019-2"; for (let i=0; i<3; i++) addWorldPlayer(world); WORLD_STORAGE.save(world);');
  const world = copy(h.run("WORLD_STORAGE.load()"));
  assert.equal(world.players.length, 3);
  assert.equal(new Set(world.players.map(player => player.id)).size, 3);
  const initial = copy(h.run("createDefaultCard()"));
  for (const player of world.players) {
    assert.match(player.id, /^p_[a-z0-9]+$/);
    assert.equal(player.name, "");
    assert.equal(player.hand, "right");
    assert.equal(player.backhand, "two");
    assert.deepEqual(player.cards, { "2019-2": initial });
  }
});

test("一覧は表示シリーズのカードがある選手のみ、総合力・名前・登録順で並ぶ", () => {
  const h = harness();
  h.run(`var world = normalizeWorld({players: [
    {id:"p_first1234", name:"う", createdAt:"2026-10-01T00:00:00Z", cards:{"2017-1":{stats:{power:99}}}},
    {id:"p_second1234", name:"あ", createdAt:"2026-10-02T00:00:00Z", cards:{"2017-1":{stats:{power:60}}}},
    {id:"p_third1234", name:"い", createdAt:"2026-10-03T00:00:00Z", cards:{"2017-1":{stats:{power:80}}}},
    {id:"p_hidden1234", name:"別シリーズ", cards:{"2017-2":{}}}
  ]});`);
  const order = sort => copy(h.run(`world.ui.sort = "${sort}"; listSeriesPlayers(world).map(player=>player.name)`));
  assert.deepEqual(order("score"), ["う", "い", "あ"]);
  assert.deepEqual(order("name"), ["あ", "い", "う"]);
  assert.deepEqual(order("created"), ["う", "あ", "い"]);
  assert.deepEqual(copy(h.run("world.players.map(player=>player.name)")), ["う", "あ", "い", "別シリーズ"]);
  h.run('world.ui.seriesId = "2017-2";');
  assert.deepEqual(order("score"), ["別シリーズ"]);
  h.run('world.ui.seriesId = "2017-1"; world.players[0].cards["2017-1"].stats.power = 60; world.ui.sort="score";');
  assert.deepEqual(copy(h.run("listSeriesPlayers(world).map(p=>p.name)")), ["い", "う", "あ"]);
});

test("リセットは対象カードだけ、選手削除は全カードを削除し他の選手・UI・v1を保持する", () => {
  const h = harness({ "tennisMaker.v1.player": "legacy backup" });
  h.run(`var world = normalizeWorld({players:[
    {id:"p_first1234", name:"選手", hand:"left", backhand:"one", cards:{"2017-1":{nickname:"二つ名",gold:["ironman"]},"2017-2":{stats:{power:99}}}},
    {id:"p_second1234", name:"別選手", cards:{"2017-1":{}}}
  ],ui:{seriesId:"2017-1",sort:"name"}});`);
  const before = copy(h.run("world"));
  h.run('resetWorldCard(world.players[0], "2017-1"); WORLD_STORAGE.save(world);');
  const reset = copy(h.run("WORLD_STORAGE.load()"));
  assert.deepEqual(reset.players[0].cards["2017-1"], copy(h.run("createDefaultCard()")));
  for (const key of ["id", "name", "hand", "backhand", "createdAt"]) assert.equal(reset.players[0][key], before.players[0][key]);
  assert.deepEqual(reset.players[0].cards["2017-2"], before.players[0].cards["2017-2"]);
  h.run('deleteWorldPlayer(world,"p_first1234"); WORLD_STORAGE.save(world);');
  const removed = copy(h.run("WORLD_STORAGE.load()"));
  assert.deepEqual(removed.players, [before.players[1]]);
  assert.deepEqual(removed.ui, before.ui);
  assert.equal(removed.latestSeriesId, before.latestSeriesId);
  assert.equal(h.values.get("tennisMaker.v1.player"), "legacy backup");
  h.run('deleteWorldPlayer(world,"p_second1234"); WORLD_STORAGE.save(world);');
  assert.deepEqual(copy(h.run("WORLD_STORAGE.load().players")), []);
});

test("編集ルートは実在する選手とカードだけを許可する", () => {
  const h = harness();
  h.run('var world = normalizeWorld({players:[{id:"p_valid1234",cards:{"2017-1":{}}}]});');
  const route = copy(h.run('resolveEditRoute(world,"#/edit/p_valid1234/2017-1")'));
  assert.equal(route.player.id, "p_valid1234");
  assert.equal(route.seriesId, "2017-1");
  for (const hash of ["#/", "", "#/edit/p_missing1234/2017-1", "#/edit/p_valid1234/2017-2", "#/edit/p_valid1234/2017-3", "#/edit/p_valid1234/2017-1/extra", "#/player/p_valid1234"]) {
    assert.equal(h.run(`resolveEditRoute(world,${JSON.stringify(hash)})`), null);
  }
});
