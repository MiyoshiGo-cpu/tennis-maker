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
    ui: { seriesId: "2017-1", listMode: "series", sort: "score", lastExportedAt: null, matchSetup: null }
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

test("シリーズを2019後半まで1期ずつ追加し、年越し・4桁超の年も扱う", () => {
  const h = harness();
  h.run('var world = createEmptyWorld(); for(let i=0;i<5;i++) addWorldSeries(world); WORLD_STORAGE.save(world);');
  assert.equal(h.run("world.latestSeriesId"), "2019-2");
  assert.equal(h.run("world.ui.seriesId"), "2019-2");
  const expected = ["2017-1", "2017-2", "2018-1", "2018-2", "2019-1", "2019-2"];
  assert.deepEqual(copy(h.run("Array.from(seriesIds(world.latestSeriesId))")), expected);
  assert.deepEqual(copy(h.run("Array.from(seriesIds(world.latestSeriesId,true))")), expected.toReversed());
  assert.equal(h.run('shiftSeries("2017-2",1)'), "2018-1");
  assert.equal(h.run('shiftSeries("2018-1",-1)'), "2017-2");
  assert.equal(h.run('shiftSeries("9999-2",1)'), "10000-1");
  assert.equal(h.run('shiftSeries("99999999999999999999-2",1)'), "100000000000000000000-1");
  const stored = JSON.parse(h.values.get("tennisMaker.v2.world"));
  assert.equal(stored.latestSeriesId, "2019-2");
  assert.ok(!("series" in stored) && !("seriesIds" in stored));
});

test("開始シリーズ・カードがある最新シリーズを削除せず、空の最新だけ削除する", () => {
  const h = harness();
  h.run('var world = createEmptyWorld();');
  assert.equal(h.run("deleteLatestSeries(world)"), false);
  h.run('addWorldSeries(world); var entity = addWorldPlayer(world);');
  const before = copy(h.run("world"));
  assert.equal(h.run("canDeleteLatestSeries(world)"), false);
  assert.equal(h.run("deleteLatestSeries(world)"), false);
  assert.deepEqual(copy(h.run("world")), before);
  h.run('addWorldSeries(world);');
  assert.equal(h.run("deleteLatestSeries(world)"), true);
  assert.equal(h.run("world.latestSeriesId"), "2017-2");
  assert.equal(h.run("world.ui.seriesId"), "2017-2");
  h.run('addWorldSeries(world); world.ui.seriesId = "2017-1";');
  assert.equal(h.run("deleteLatestSeries(world)"), true);
  assert.equal(h.run("world.ui.seriesId"), "2017-1");
});

test("カード作成は最も近い前を優先し、前がないときは最も近い後・カードなしは初期値", () => {
  const h = harness();
  h.run(`var entity = normalizePlayer({id:"p_copy12345",name:"固定",hand:"left",backhand:"one",cards:{
    "2017-1":{nickname:"古い",stats:{control:70}},
    "2018-1":{nickname:"近い前",surface:"clay",stats:{power:88},shotSkills:{volley:"great"},rankSkills:{clutch:"A"},gold:["ironman"],plus:["rising"],minus:["streaky"]},
    "2019-2":{nickname:"後",stats:{power:99}}
  }});`);
  const before = copy(h.run("entity"));
  assert.equal(h.run('createWorldCard(entity,"2019-1")'), true);
  assert.deepEqual(copy(h.run('entity.cards["2019-1"]')), before.cards["2018-1"]);
  h.run('entity.cards["2019-1"].stats.power=1; entity.cards["2019-1"].gold.push("precision");');
  assert.deepEqual(copy(h.run('entity.cards["2018-1"]')), before.cards["2018-1"]);
  assert.equal(h.run('createWorldCard(entity,"2019-1")'), false);
  assert.equal(h.run('createWorldCard(entity,"2016-2")'), false);
  for (const key of ["id", "name", "hand", "backhand", "createdAt"]) assert.equal(h.run(`entity.${key}`), before[key]);
  h.run('var future = normalizePlayer({cards:{"2018-2":{nickname:"近い後"},"2019-1":{nickname:"遠い後"}}}); createWorldCard(future,"2017-1");');
  assert.equal(h.run('future.cards["2017-1"].nickname'), "近い後");
  h.run('var empty = normalizePlayer({cards:{}}); createWorldCard(empty,"2017-1");');
  assert.deepEqual(copy(h.run('empty.cards["2017-1"]')), copy(h.run("createDefaultCard()")));
});

test("前のシリーズからコピーは前のみを使い、元カードと固定情報を保持する", () => {
  const h = harness();
  h.run('var entity=normalizePlayer({name:"選手",hand:"left",cards:{"2017-1":{nickname:"前"},"2018-2":{nickname:"近い前",plus:["rising"]},"2019-2":{nickname:"現在",gold:["precision"]},"2020-1":{nickname:"後"}}});');
  const original = copy(h.run("entity"));
  assert.equal(h.run('copyPreviousCard(entity,"2017-1")'), false);
  assert.equal(h.run('copyPreviousCard(entity,"2019-1")'), false);
  assert.equal(h.run('copyPreviousCard(entity,"2019-2")'), true);
  assert.deepEqual(copy(h.run('entity.cards["2019-2"]')), original.cards["2018-2"]);
  h.run('entity.cards["2019-2"].plus.push("high_point");');
  assert.deepEqual(copy(h.run('entity.cards["2018-2"]')), original.cards["2018-2"]);
  assert.equal(h.run("entity.name"), "選手");
  assert.equal(h.run("entity.hand"), "left");
});

test("カード削除は2枚以上の時だけ許可し、最新が空になったときだけシリーズ削除を許可する", () => {
  const h = harness();
  h.run('var world=normalizeWorld({players:[{id:"p_card12345",cards:{"2017-1":{},"2019-2":{}}}]}); var entity=world.players[0];');
  assert.equal(h.run("canDeleteLatestSeries(world)"), false);
  assert.equal(h.run('deleteWorldCard(entity,"2018-1")'), false);
  assert.equal(h.run('deleteWorldCard(entity,"2019-2")'), true);
  assert.equal(h.run("canDeleteLatestSeries(world)"), true);
  assert.equal(h.run('deleteWorldCard(entity,"2017-1")'), false);
  assert.deepEqual(copy(h.run("Object.keys(entity.cards)")), ["2017-1"]);
});

test("推移グラフのデータは欠けたシリーズを補わず、シリーズ順の総合力・ランクになる", () => {
  const h = harness();
  h.run('var entity=normalizePlayer({cards:{"2019-2":{stats:{control:99,power:99,speed:99,stamina:99,mental:99,net:99}},"2017-1":{},"2018-2":{stats:{control:80,power:80,speed:80}}}});');
  assert.deepEqual(copy(h.run("scoreHistory(entity)")), [
    {seriesId:"2017-1",value:2000,rank:"D"},
    {seriesId:"2018-2",value:2840,rank:"B"},
    {seriesId:"2019-2",value:3960,rank:"S"}
  ]);
  assert.deepEqual(copy(h.run("scoreHistory(normalizePlayer({cards:{}}))")), []);
});

test("表示シリーズ・全選手表示を保存復元し、カードなしは総合力順で後ろに出す", () => {
  const h = harness();
  h.run('var world=normalizeWorld({players:[{id:"p_old12345",name:"カードなし",cards:{"2017-1":{}}},{id:"p_new12345",name:"カードあり",cards:{"2019-2":{}}}],ui:{seriesId:"2019-2",listMode:"all",sort:"score"}}); WORLD_STORAGE.save(world);');
  assert.deepEqual(copy(h.run("WORLD_STORAGE.load().ui")), {seriesId:"2019-2",listMode:"all",sort:"score",lastExportedAt:null,matchSetup:null});
  assert.deepEqual(copy(h.run("listSeriesPlayers(world).map(p=>p.name)")), ["カードあり", "カードなし"]);
  h.run('world.ui.listMode="series";');
  assert.deepEqual(copy(h.run("listSeriesPlayers(world).map(p=>p.name)")), ["カードあり"]);
  assert.equal(h.run('normalizeWorld({ui:{listMode:"invalid",sort:"invalid"}}).ui.listMode'), "series");
  assert.equal(h.run('normalizeWorld({ui:{listMode:"invalid",sort:"invalid"}}).ui.sort'), "score");
});

test("選手詳細ルートはカード0枚でも開け、存在しない選手は拒否する", () => {
  const h = harness();
  h.run('var world=normalizeWorld({players:[{id:"p_valid1234",cards:{}}]});');
  assert.equal(h.run('resolvePlayerRoute(world,"#/player/p_valid1234").id'), "p_valid1234");
  for(const hash of ["#/player/p_missing1234", "#/player/p_valid1234/extra", "#/", "#/edit/p_valid1234/2017-1"]) assert.equal(h.run(`resolvePlayerRoute(world,${JSON.stringify(hash)})`), null);
});

test("JSON書き出しは整形済みUTF-8用テキストと日付付きファイル名を作り、元データを変えない", () => {
  const h = harness();
  h.run('var world=createEmptyWorld(); var entity=addWorldPlayer(world); entity.name="山田 太郎"; entity.cards["2019-2"]=normalizeCard({nickname:"日本語",gold:["precision"]}); world.latestSeriesId=world.ui.seriesId="2019-2"; world.ui.listMode="all"; world.ui.sort="name";');
  const before = copy(h.run("world"));
  const exported = copy(h.run('prepareWorldExport(world,new Date("2026-10-06T12:00:00Z"))'));
  assert.equal(exported.filename, "tennis-maker_20261006.json");
  assert.ok(exported.text.includes('\n  "version": 2') && exported.text.includes("山田 太郎"));
  assert.deepEqual(JSON.parse(exported.text), exported.world);
  assert.equal(exported.world.ui.lastExportedAt, "2026-10-06T12:00:00.000Z");
  assert.deepEqual(copy(h.run("world")), before);
});

test("書き出し・全選手削除・置き換え読み込みで選手・全カード・UIが完全に復元する", () => {
  const h = harness({ "tennisMaker.v1.player": "legacy backup" });
  h.run('var world=createEmptyWorld(); addWorldPlayer(world); addWorldPlayer(world); world.players[0].name="一人目"; world.players[0].hand="left"; world.players[0].cards["2019-2"]=normalizeCard({stats:{control:99},gold:["precision"]}); world.latestSeriesId=world.ui.seriesId="2019-2"; world.ui.listMode="all"; world.ui.sort="created"; var backup=prepareWorldExport(world,new Date("2026-10-06T12:00:00Z")); world.ui.lastExportedAt=backup.world.ui.lastExportedAt; WORLD_STORAGE.save(world);');
  const before = copy(h.run("world"));
  h.run('world.players.map(p=>p.id).forEach(id=>deleteWorldPlayer(world,id)); WORLD_STORAGE.save(world); world=importWorld(world,parseWorldImport(backup.text),"replace"); WORLD_STORAGE.save(world);');
  assert.deepEqual(copy(h.run("WORLD_STORAGE.load()")), before);
  assert.equal(h.values.get("tennisMaker.v1.player"), "legacy backup");
});

test("同じJSONを追加で2回読み込んでもIDが重複せず、既存データとUIを保持する", () => {
  const h = harness();
  h.run('var world=normalizeWorld({players:[{id:"p_same12345",name:"既存",cards:{"2017-1":{}}}],ui:{seriesId:"2017-1",listMode:"all",sort:"name",lastExportedAt:"2026-10-01T12:00:00Z"}}); var incoming=parseWorldImport(JSON.stringify({version:2,latestSeriesId:"2020-2",players:[{id:"p_same12345",name:"追加",cards:{"2019-2":{stats:{power:99}}}}]}));');
  const before = copy(h.run("world"));
  h.run('world=importWorld(world,incoming,"append"); world=importWorld(world,incoming,"append"); WORLD_STORAGE.save(world);');
  const result = copy(h.run("WORLD_STORAGE.load()"));
  assert.equal(result.players.length, 3);
  assert.equal(new Set(result.players.map(p => p.id)).size, 3);
  assert.deepEqual(result.players[0], before.players[0]);
  assert.deepEqual(result.ui, before.ui);
  assert.equal(result.latestSeriesId, "2020-2");
  for (const player of result.players.slice(1)) assert.equal(player.cards["2019-2"].stats.power, 99);
  h.run('world.players[1].cards["2019-2"].stats.power=1;');
  assert.equal(h.run('world.players[2].cards["2019-2"].stats.power'), 99);
  assert.equal(h.run('incoming.players[0].cards["2019-2"].stats.power'), 99);
});

test("壊れたJSON・関係ないJSON・不正な構造は拒否し、保存データは一切変更しない", () => {
  const h = harness({ "tennisMaker.v2.world": JSON.stringify({ version: 2, players: [] }) });
  const before = [...h.values];
  for (const text of ["{broken", "null", "[]", "42", "{}", '{"name":"別の文書"}', '{"version":1,"document":"別文書"}', '{"version":2,"players":"bad"}', '{"version":2,"players":[null]}', '{"version":2,"players":[{"cards":[]}]}', '{"version":2,"players":[],"ui":"bad"}']) {
    assert.throws(() => h.run(`parseWorldImport(${JSON.stringify(text)})`));
  }
  assert.deepEqual([...h.values], before);
  assert.equal(h.writes.length, 0);
});

test("v1 JSONを選手1人と開始シリーズのカードに分けて読み込む", () => {
  const h = harness();
  const legacy = {version:1,name:"旧選手",hand:"left",backhand:"one",nickname:"二つ名",surface:"grass",stats:{power:99},gold:["ironman"],plus:["rising","unknown"],shotSkills:{volley:"great"}};
  const world = copy(h.run(`parseWorldImport(${JSON.stringify(JSON.stringify(legacy))})`));
  assert.equal(world.players.length, 1);
  assert.equal(world.players[0].name, "旧選手");
  assert.equal(world.players[0].hand, "left");
  assert.deepEqual(Object.keys(world.players[0].cards), ["2017-1"]);
  const card = world.players[0].cards["2017-1"];
  assert.equal(card.nickname, "二つ名");
  assert.equal(card.stats.power, 99);
  assert.deepEqual(card.plus, ["rising"]);
  assert.equal(card.shotSkills.volley, "great");
  assert.ok(!("name" in card));
  assert.equal(h.writes.length, 0);
});

test("バックアップ案内は選手がいる場合だけ表示し、14日経過の境界を正しく扱う", () => {
  const h = harness();
  h.run('var world=createEmptyWorld();');
  assert.equal(h.run("needsBackup(world)"), false);
  h.run('addWorldPlayer(world);');
  assert.equal(h.run("needsBackup(world)"), true);
  h.run('world.ui.lastExportedAt="2026-10-01T12:00:00.000Z";');
  assert.equal(h.run('needsBackup(world,Date.parse("2026-10-15T11:59:59.999Z"))'), false);
  assert.equal(h.run('needsBackup(world,Date.parse("2026-10-15T12:00:00.000Z"))'), true);
  assert.equal(h.run('needsBackup(world,Date.parse("2026-09-30T12:00:00.000Z"))'), false);
});

test("v1移行の保存失敗は通知し、選手データをメモリー上で保持する", () => {
  const context = vm.createContext({localStorage:{getItem:key=>key==="tennisMaker.v1.player"?'{"version":1,"name":"保存失敗"}':null,setItem(){throw new Error("denied")}}});
  vm.runInContext(dataSource+"\n"+storageSource,context);
  assert.equal(vm.runInContext('var notified=0; var world=loadWorld(()=>notified++); world.players[0].name',context), "保存失敗");
  assert.equal(vm.runInContext("notified",context), 1);
});

test("グラフの縦軸は最小・最大の前後を含み、同点・1枚でもゼロ幅にならない", () => {
  const h = harness();
  const close = copy(h.run('historyScale([{value:2830},{value:2840},{value:2850}])'));
  assert.ok(close.min < 2830 && close.min > 0 && close.max > 2850 && close.max-close.min < 200);
  for (const values of [[2000], [2000,2000], [40]]) {
    const scale = copy(h.run(`historyScale(${JSON.stringify(values.map(value=>({value})))})`));
    assert.ok(scale.min < values[0] && scale.max > values[0] && scale.max > scale.min);
    assert.ok(scale.ticks.every(Number.isFinite));
  }
  assert.equal(h.run("historyScale([])"), null);
});

test("グラフのランク境界は5章のしきい値を使い、縦軸範囲内だけに出す", () => {
  const h = harness();
  const scale = copy(h.run('historyScale([{value:1900},{value:3250}])'));
  assert.deepEqual(scale.boundaries.map(rank=>[rank.rank,rank.min]), [["A",3200],["B",2800],["C",2400],["D",2000],["E",1600]]);
  assert.ok(scale.boundaries.every(rank=>rank.min >= scale.min && rank.min <= scale.max));
});

test("ポーズはカード単位で全選択肢を保存復元し、欠損・未知IDはフォアハンドに補う", () => {
  const h = harness();
  assert.equal(h.run("createDefaultCard().pose"), "forehand");
  for (const raw of [{}, { pose: "unknown" }, { pose: null }]) {
    assert.equal(h.run(`normalizeCard(${JSON.stringify(raw)}).pose`), "forehand");
  }
  const poses = copy(h.run("DATA.poses.map(item => item.id)"));
  assert.equal(poses.length, 11);
  assert.equal(poses[0], "none");
  for (const pose of poses) {
    h.run(`var world=createEmptyWorld(); var entity=addWorldPlayer(world); entity.cards["2017-1"].pose=${JSON.stringify(pose)}; WORLD_STORAGE.save(world);`);
    assert.equal(h.run('WORLD_STORAGE.load().players[0].cards["2017-1"].pose'), pose);
    assert.equal(h.run('"pose" in WORLD_STORAGE.load().players[0]'), false);
    assert.equal(h.run('calculateScore(entity.cards["2017-1"]).value'), 2000);
  }
  h.run('DATA.poses.push({id:"added_pose",name:"追加ポーズ",file:DATA.poses[1].file});');
  assert.equal(h.run('normalizeCard({pose:"added_pose"}).pose'), "added_pose");
});

test("既存v2と古いv1／v2 JSONのポーズを補い、JSON書き出し・置き換え・追加でも保持する", () => {
  const h = harness({ "tennisMaker.v2.world": JSON.stringify({ version: 2, players: [{ id: "p_old12345", cards: { "2017-1": {} } }] }) });
  assert.equal(h.run('WORLD_STORAGE.load().players[0].cards["2017-1"].pose'), "forehand");
  for (const legacy of [{ version: 1, name: "旧選手" }, { version: 2, players: [{ cards: { "2017-1": {} } }] }]) {
    h.run(`var imported=parseWorldImport(${JSON.stringify(JSON.stringify(legacy))});`);
    assert.equal(h.run('imported.players[0].cards["2017-1"].pose'), "forehand");
  }
  h.run('var world=createEmptyWorld(); var entity=addWorldPlayer(world); entity.cards["2017-1"].pose="serve_toss"; entity.cards["2017-2"]=normalizeCard({pose:"none"}); world.latestSeriesId="2017-2"; var snapshot=prepareWorldExport(world); var imported=parseWorldImport(snapshot.text); var replaced=importWorld(createEmptyWorld(),imported,"replace"); var appended=importWorld(world,imported,"append");');
  assert.deepEqual(copy(h.run('Object.values(replaced.players[0].cards).map(card=>card.pose)')), ["serve_toss", "none"]);
  assert.deepEqual(copy(h.run('appended.players.map(player=>Object.values(player.cards).map(card=>card.pose))')), [["serve_toss", "none"], ["serve_toss", "none"]]);
});

test("カード作成・前シリーズからコピーでポーズを引き継ぎ、リセットは対象カードだけ戻す", () => {
  const h = harness();
  h.run('var entity=normalizePlayer({name:"固定名",hand:"left",cards:{"2017-1":{pose:"running"},"2017-2":{pose:"none"}}}); createWorldCard(entity,"2018-1"); createWorldCard(entity,"2018-2");');
  assert.equal(h.run('entity.cards["2018-1"].pose'), "none");
  h.run('entity.cards["2018-1"].pose="smash"; copyPreviousCard(entity,"2018-2");');
  assert.equal(h.run('entity.cards["2018-2"].pose'), "smash");
  assert.equal(h.run('entity.cards["2017-1"].pose'), "running");
  h.run('resetWorldCard(entity,"2018-2");');
  assert.equal(h.run('entity.cards["2018-2"].pose'), "forehand");
  assert.equal(h.run('entity.cards["2018-1"].pose'), "smash");
  assert.equal(h.run('entity.hand'), "left");
  assert.equal(h.run('entity.name'), "固定名");
  h.run('var future=normalizePlayer({cards:{"2018-2":{pose:"celebrate"}}}); createWorldCard(future,"2017-1"); var empty=normalizePlayer({cards:{}}); createWorldCard(empty,"2017-1");');
  assert.equal(h.run('future.cards["2017-1"].pose'), "celebrate");
  assert.equal(h.run('empty.cards["2017-1"].pose'), "forehand");
});

test("同梱ポーズSVGは支給素材と全件一致する", () => {
  const h = harness();
  const embedded = copy(h.run("DATA.poseSvg"));
  const poses = copy(h.run("DATA.poses"));
  const files = fs.readdirSync(path.join(root, "assets/poses")).sort();
  assert.deepEqual(Object.keys(embedded).map(file => path.basename(file)).sort(), files);
  for (const pose of poses.filter(item => item.file)) {
    assert.equal(embedded[pose.file], fs.readFileSync(path.join(root, pose.file), "utf8"));
    assert.match(embedded[pose.file], /viewBox="0 0 1020 1438"/);
  }
});

function matchHarness() {
  const h = harness();
  h.run('var world=normalizeWorld({players:[{id:"p_z12345",name:"う",cards:{"2017-1":{},"2018-2":{}}},{id:"p_a12345",name:"あ",cards:{"2017-1":{},"2019-1":{}}},{id:"p_empty12345",name:"い",cards:{}}]});');
  return h;
}

test("対戦候補はカードのある選手を名前順にし、初回は別選手の最新カードを選ぶ", () => {
  const h = matchHarness();
  const before = copy(h.run("world"));
  assert.deepEqual(copy(h.run("matchPlayers(world).map(player=>player.id)")), ["p_a12345", "p_z12345"]);
  assert.deepEqual(copy(h.run("normalizeMatchSetup(world,null)")), {
    a:{playerId:"p_a12345",seriesId:"2019-1"}, b:{playerId:"p_z12345",seriesId:"2018-2"},
    format:3, surface:"hard", firstServer:"random"
  });
  assert.deepEqual(copy(h.run("world")), before);
});

test("カードのある選手が2人未満なら、1人に複数カードがあっても開始できない", () => {
  const h = matchHarness();
  h.run('world.players=world.players.filter(player=>player.id!=="p_z12345");');
  assert.equal(h.run("resolveMatchEntries(world,normalizeMatchSetup(world,null))"), null);
  h.run('world.players=[];');
  const setup = copy(h.run("normalizeMatchSetup(world,null)"));
  assert.deepEqual(setup.a, {playerId:null,seriesId:null});
  assert.deepEqual(setup.b, {playerId:null,seriesId:null});
  assert.equal(h.run("resolveMatchEntries(world,normalizeMatchSetup(world,null))"), null);
});

test("同一カードは実行前にも拒否し、同じ選手の別シリーズは許可する", () => {
  const h = matchHarness();
  h.run('var setup=normalizeMatchSetup(world,{a:{playerId:"p_a12345",seriesId:"2017-1"},b:{playerId:"p_a12345",seriesId:"2019-1"}});');
  assert.equal(h.run("resolveMatchEntries(world,setup).a.seriesId"), "2017-1");
  assert.equal(h.run("resolveMatchEntries(world,setup).b.seriesId"), "2019-1");
  h.run('setup.b={...setup.a};');
  assert.equal(h.run("resolveMatchEntries(world,setup)"), null);
  const fixed = copy(h.run("normalizeMatchSetup(world,setup)"));
  assert.deepEqual(fixed.a, {playerId:"p_a12345",seriesId:"2017-1"});
  assert.deepEqual(fixed.b, {playerId:"p_a12345",seriesId:"2019-1"});
});

test("選手切り替えで最新カードを選び、変更した側を保持して相手の重複を解消する", () => {
  const h = matchHarness();
  h.run('var setup=normalizeMatchSetup(world,{a:{playerId:"p_z12345",seriesId:"2017-1"},b:{playerId:"p_a12345",seriesId:null}},"b");');
  assert.equal(h.run("setup.b.seriesId"), "2019-1");
  h.run('setup.a={...setup.b};');
  const changed = copy(h.run('normalizeMatchSetup(world,setup,"b")'));
  assert.equal(changed.b.seriesId, "2019-1");
  assert.equal(changed.a.seriesId, "2017-1");
  assert.equal(changed.a.playerId, "p_a12345");
});

test("未知・削除済みの対戦候補と不正設定は補い、実行前の不正設定も拒否する", () => {
  const h = matchHarness();
  h.run('var setup=normalizeMatchSetup(world,{a:{playerId:"p_deleted",seriesId:"2030-2"},b:{playerId:"p_z12345",seriesId:"2018-2"},format:7,surface:"unknown",firstServer:"unknown",seed:1,result:{winner:"a"}});');
  assert.equal(h.run("setup.a.playerId"), "p_a12345");
  assert.equal(h.run("setup.format"), 3);
  assert.equal(h.run("setup.surface"), "hard");
  assert.equal(h.run("setup.firstServer"), "random");
  assert.equal(h.run('"seed" in setup || "result" in setup'), false);
  for (const mutation of ['setup.format=7', 'setup.surface="unknown"', 'setup.firstServer="unknown"', 'setup.a.seriesId="2017-2"', 'setup.a.playerId="missing"']) {
    h.run('var invalid={...setup,a:{...setup.a}};');
    h.run(mutation.replaceAll("setup.", "invalid."));
    assert.equal(h.run("resolveMatchEntries(world,invalid)"), null);
  }
  h.run('delete world.players[1].cards["2019-1"];');
  assert.equal(h.run("normalizeMatchSetup(world,setup).a.seriesId"), "2017-1");
});

test("前回の全対戦設定を保存・復元・JSONで保持し、結果・乱数は保存しない", () => {
  const h = matchHarness();
  for (const format of [1,3,5]) for (const surface of ["hard","clay","grass"]) for (const firstServer of ["random","a","b"]) {
    h.run(`world.ui.matchSetup={a:{playerId:"p_z12345",seriesId:"2017-1"},b:{playerId:"p_a12345",seriesId:"2019-1"},format:${format},surface:"${surface}",firstServer:"${firstServer}"};`);
    const expected = copy(h.run("world.ui.matchSetup"));
    h.run('world.ui.matchSetup.seed=123; world.ui.matchSetup.result={winner:"a"}; WORLD_STORAGE.save(world);');
    assert.deepEqual(copy(h.run("WORLD_STORAGE.load().ui.matchSetup")), expected);
    assert.deepEqual(copy(h.run('parseWorldImport(prepareWorldExport(world).text).ui.matchSetup')), expected);
  }
  h.run('var restored=WORLD_STORAGE.load(); deleteWorldPlayer(restored,"p_z12345"); WORLD_STORAGE.save(restored);');
  assert.equal(h.run('WORLD_STORAGE.load().ui.matchSetup.a.playerId'), "p_a12345");
  assert.equal(h.run('resolveMatchEntries(WORLD_STORAGE.load(),WORLD_STORAGE.load().ui.matchSetup)'), null);
});
