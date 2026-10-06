// Node 標準機能だけで実行: node --test tests/match.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const DATA = require("../data.js");
const TennisMatch = require("../match.js");
const copy = value => JSON.parse(JSON.stringify(value));
const statIds = ["control", "power", "speed", "stamina", "mental", "net"];
const opposite = key => key === "a" ? "b" : "a";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function entry(value = 50, overrides = {}) {
  return { player: { id: "p_test", name: "試験選手", hand: "right", backhand: "two" }, seriesId: "2017-1",
    card: { nickname: "", surface: "hard", playStyle: "allround", serve: "flat", stats: Object.fromEntries(statIds.map(id => [id, value])), shotSkills: {}, rankSkills: {}, gold: [], plus: [], minus: [], ...overrides } };
}

function state(overrides = {}) {
  return { format: 5, surface: "hard", setNumber: 1, gameNumber: 1, games: { a: 0, b: 0 }, setsWon: { a: 0, b: 0 }, form: { a: 0, b: 0 }, lastGameWinner: null, tiebreak: false, ...overrides };
}

function chances(a, b, context = state(), pressure = [], net = false) {
  const ea = TennisMatch.effectiveStats(a, b, context, "a", pressure);
  const eb = TennisMatch.effectiveStats(b, a, context, "b", pressure);
  return TennisMatch.pointChances(a, b, ea, eb, context.surface, pressure, net);
}

const presentationContext = vm.createContext({});
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
vm.runInContext(fs.readFileSync(path.join(__dirname, "../data.js"), "utf8") + "\n" + appSource.slice(0, appSource.indexOf("(function () {")), presentationContext);
function presentation(options, result) {
  presentationContext.options = options;
  presentationContext.result = result;
  return copy(vm.runInContext("matchPresentation(options,result)", presentationContext));
}

test("結果見出しは固定seedの逆転・フルセット・ストレート・最終タイブレークと優先順に一致する", () => {
  const cases = [[1,"comeback","6-1 5-7 1-6"], [2,"straight","6-3 7-5"], [13,"fullSets","6-7(3) 6-2 1-6"],
    [4,"finalTiebreak","5-7 6-2 6-7(7)"], [60,"savedMatchPoint","6-7(8) 7-6(4) 6-3"]];
  for (const [seed, headline, score] of cases) {
    const options = { a: entry(), b: entry(), format:3, surface:"hard", firstServer:"a", seed };
    const result = TennisMatch.simulate(options), before = copy({options,result});
    assert.equal(result.scoreText, score);
    assert.equal(presentation(options,result).headline, headline);
    assert.deepEqual({options,result}, before);
  }
  const options = { a:entry(), b:entry(), format:1, firstServer:"a", seed:2 };
  assert.equal(presentation(options,TennisMatch.simulate(options)).headline, "victory");
  options.a=entry(99);options.b=entry(1);
  assert.equal(presentation(options,TennisMatch.simulate(options)).headline, "dominant");
});

test("ストレートの最後のタイブレークは最終セット扱いにせず、1セットには専用の見出しを使う", () => {
  const cases = [
    {format:3,seed:3,score:"6-2 7-6(5)",headline:"straight"},
    {format:1,seed:9,score:"6-7(5)",headline:"singleTiebreak"},
    {format:3,seed:4,score:"5-7 6-2 6-7(7)",headline:"finalTiebreak"},
    {format:5,seed:27,score:"6-7(2) 3-6 7-5 7-6(3) 6-7(7)",headline:"finalTiebreak"}
  ];
  for (const {format,seed,score,headline} of cases) {
    const options={a:entry(),b:entry(),format,firstServer:"a",seed},result=TennisMatch.simulate(options);
    assert.equal(result.scoreText,score);
    assert.equal(presentation(options,result).headline,headline);
  }
});

test("実況スコアは公開済みポイントだけで組み立て、次のサーバー・AD・タイブレーク・セット切替を示す", () => {
  let sawAdvantage=false, sawTiebreak=false, sawSetReset=false;
  for (const [format,seed] of [[3,4],[5,27]]) {
    const result=TennisMatch.simulate({a:entry(),b:entry(),format,firstServer:"a",seed});
    const before=copy(result);
    presentationContext.result=result;presentationContext.format=format;
    for (let shown=0;shown<=result.points.length;shown++) {
      presentationContext.shown=shown;
      const frame=copy(vm.runInContext("matchReplayFrame(result,shown,format)",presentationContext));
      const previous=result.points[shown-1],next=result.points[shown];
      assert.equal(frame.server,next?.server||null);
      assert.equal(frame.columns.length,format);
      if(!shown) {
        assert.deepEqual(frame.pointText,{a:"0",b:"0"});
        assert.deepEqual([frame.columns[0].a,frame.columns[0].b],[0,0]);
        assert.ok(frame.columns.slice(1).every(column=>column.a==="−"&&column.b==="−"));
      } else if(previous.matchEnd) {
        assert.equal(frame.finished,true);assert.equal(frame.server,null);
        result.sets.forEach((set,index)=>assert.deepEqual([frame.columns[index].a,frame.columns[index].b],[set.a,set.b]));
      } else {
        assert.equal(frame.finished,false);
        if(previous.gameEnd)assert.deepEqual(frame.pointText,{a:"0",b:"0"});
        else assert.deepEqual(frame.pointText,previous.score.pointText);
        if(previous.setEnd) {
          const completed=previous.score.sets.a+previous.score.sets.b;
          assert.deepEqual([frame.columns[completed].a,frame.columns[completed].b],[0,0]);
          sawSetReset=true;
        }
      }
      if(Object.values(frame.pointText).includes("AD"))sawAdvantage=true;
      if(frame.tiebreak&&previous&&!previous.gameEnd){assert.equal(typeof frame.pointText.a,"number");sawTiebreak=true;}
    }
    assert.deepEqual(result,before);
  }
  assert.ok(sawAdvantage&&sawTiebreak&&sawSetReset);
});

test("結果PNGのファイル名は2人の名前を使い、禁止文字と末尾のドットを置換する", () => {
  for(const [a,b,expected]of [
    ["山田 太郎","佐藤健","tennis-match_山田 太郎_vs_佐藤健.png"],
    [" 山/田:太郎. ","佐藤*健?","tennis-match_山_田_太郎__vs_佐藤_健_.png"],
    ["","","tennis-match_名無しの選手_vs_名無しの選手.png"]
  ]){
    presentationContext.options={a:{player:{name:a}},b:{player:{name:b}}};
    assert.equal(vm.runInContext("matchImageFileName(options)",presentationContext),expected);
  }
});

test("タグは総合力400差・6-0・タイブレーク2回・エース10本・ノーブレークを優先順で最大2つにする", () => {
  const options={a:entry(50),b:entry(60),format:5};
  const result=TennisMatch.simulate({...options,seed:2});
  result.winner="a";result.points=[];
  result.sets=[{a:6,b:0},{a:7,b:6,tiebreak:{a:8,b:6}},{a:7,b:6,tiebreak:{a:7,b:5}}];
  result.stats.a.aces=10;result.stats.b.breakPointsWon=0;
  assert.deepEqual(presentation(options,result).tags.map(item=>item.type), ["upset","bagel"]);
  options.b=entry(59);
  assert.deepEqual(presentation(options,result).tags.map(item=>item.type), ["bagel","tiebreaks"]);
  result.sets.shift();
  assert.deepEqual(presentation(options,result).tags, [{type:"tiebreaks",count:2},{type:"aces",count:10}]);
  result.stats.a.aces=9;
  assert.deepEqual(presentation(options,result).tags.map(item=>item.type), ["tiebreaks","noBreak"]);
  result.sets.pop();
  assert.deepEqual(presentation(options,result).tags, [{type:"noBreak"}]);
  result.stats.b.breakPointsWon=1;
  assert.deepEqual(presentation(options,result).tags, []);
});

test("山場はしのいだ相手のマッチポイント・最後のブレーク・最多デュースを記録から選ぶ", () => {
  const options={a:entry(),b:entry(),format:3,firstServer:"a",seed:60};
  const result=TennisMatch.simulate(options);
  const moments=presentation(options,result).moments;
  assert.deepEqual(moments.map(item=>item.type), ["matchPoint","break","deuce"]);
  assert.deepEqual([moments[0].set,moments[0].a,moments[0].b], [2,4,5]);
  const finalBreak=result.points.filter(point=>point.set===result.sets.length&&point.gameEnd&&!point.tiebreak&&point.winner!==point.server).pop();
  assert.equal(moments[1].game, finalBreak.game);
  const deuceGames=new Map();
  result.points.filter(point=>!point.tiebreak&&point.score.points.a===point.score.points.b&&point.score.points.a>=3).forEach(point=>{
    const key=point.set+"/"+point.game;deuceGames.set(key,(deuceGames.get(key)||0)+1);
  });
  assert.equal(moments[2].count,Math.max(...deuceGames.values()));
  // combined pressureは勝者自身のマッチポイントも含むため、それを「しのいだ」と数えない。
  const straight=TennisMatch.simulate({...options,seed:2});
  assert.ok(straight.points.some(point=>point.pressure.includes("match")&&point.winner===straight.winner));
  assert.equal(presentation(options,straight).moments.some(item=>item.type==="matchPoint"),false);
});

test("タイブレークの山場は実際のポイント数を使い、エースはセットごとに数え、場面がなければ空にする", () => {
  const options={a:entry(),b:entry(),format:3,firstServer:"a",seed:3};
  const result=TennisMatch.simulate(options);
  assert.deepEqual(presentation(options,result).moments.find(item=>item.type==="tiebreak"),{type:"tiebreak",set:2,name:"試験選手",won:7,lost:5});
  const aceResult=TennisMatch.simulate({...options,seed:1});
  const aceMoment=presentation(options,aceResult).moments.find(item=>item.type==="aces");
  assert.equal(aceMoment.count,4);
  assert.equal(aceResult.points.filter(point=>point.set===aceMoment.set&&point.kind==="ace"&&point.winner==="a").length,4);
  result.points=[];result.sets=[{a:6,b:4}];
  assert.deepEqual(presentation(options,result).moments,[]);
});

test("綱引きバーは数値の比率・逆向き評価・同値を扱い、両者ゼロは表示しない", () => {
  const options={a:entry(),b:entry(),format:3,seed:2},result=TennisMatch.simulate(options);
  result.stats.a.aces=6;result.stats.b.aces=4;
  result.stats.a.doubleFaults=1;result.stats.b.doubleFaults=3;
  result.stats.a.errors=20;result.stats.b.errors=10;
  result.stats.a.netPointsWon=result.stats.b.netPointsWon=0;
  result.stats.a.winners=result.stats.b.winners=10;
  const stats=presentation(options,result).stats;
  const ace=stats.find(item=>item.field==="aces");
  assert.equal(ace.share,0.6);assert.equal(ace.better,"a");
  assert.equal(stats.find(item=>item.field==="doubleFaults").better,"a");
  assert.equal(stats.find(item=>item.field==="errors").better,"b");
  assert.equal(stats.find(item=>item.field==="winners").better,null);
  assert.equal(stats.some(item=>item.field==="netPointsWon"),false);
  assert.ok(stats.every(item=>Number.isFinite(item.share)&&item.share>=0&&item.share<=1));
});

test("Node とブラウザの両方で読み込め、DOM・保存処理に依存しない", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../data.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../match.js"), "utf8"), context);
  const options = { a: entry(), b: entry(), seed: 42 };
  context.options = options;
  assert.deepEqual(copy(vm.runInContext("TennisMatch.simulate(options)", context)), TennisMatch.simulate(options));
});

test("同じ seed と設定ではポイント・実況・スタッツまで一致し、入力を変更しない", () => {
  const options = { a: entry(65, { gold: ["precision"], shotSkills: { forehand: "great" } }), b: entry(60), seed: 987654321, format: 5, surface: "clay", firstServer: "b" };
  const snapshot = copy(options);
  assert.deepEqual(TennisMatch.simulate(options), TennisMatch.simulate(options));
  assert.deepEqual(options, snapshot);
  assert.notDeepEqual(TennisMatch.simulate(options), TennisMatch.simulate({ ...options, seed: 987654322 }));
  const generated = TennisMatch.simulate({ a: entry(), b: entry() });
  assert.deepEqual(generated, TennisMatch.simulate({ a: entry(), b: entry(), seed: generated.seed }));
});

test("ゲーム・デュース・セット・タイブレークとサーブ交代をポイント記録から検証する", () => {
  let sawDeuce = false, sawAdvantage = false, sawTiebreak = false, sawExtendedTiebreak = false, sawNextSet = false;
  for (let seed = 1; seed <= 30; seed++) {
    const result = TennisMatch.simulate({ a: entry(), b: entry(), format: 5, firstServer: "a", seed });
    let expectedServer = "a", firstTieServer, tiePoints = 0, points = { a: 0, b: 0 }, games = { a: 0, b: 0 }, sets = { a: 0, b: 0 };
    for (let i = 0; i < result.points.length; i++) {
      const p = result.points[i], loser = opposite(p.winner);
      assert.equal(p.server, expectedServer);
      assert.equal(p.serveNumber, p.firstServeIn ? 1 : 2);
      if (p.kind === "ace") assert.equal(p.winner, p.server);
      if (p.kind === "doubleFault") { assert.equal(p.winner, opposite(p.server)); assert.equal(p.firstServeIn, false); }
      if (p.tiebreak && !tiePoints) firstTieServer = p.server;
      points[p.winner]++;
      assert.deepEqual(p.score.points, points);
      const isGameEnd = points[p.winner] >= (p.tiebreak ? 7 : 4) && points[p.winner] - points[loser] >= 2;
      assert.equal(p.gameEnd, isGameEnd);
      if (p.gameEnd && !p.tiebreak) assert.deepEqual(p.score.pointText, { a: "0", b: "0" });
      if (p.tiebreak) { sawTiebreak = true; tiePoints++; sawExtendedTiebreak ||= points.a >= 7 && points.b >= 7; assert.ok(p.pressure.includes("tiebreak")); }
      else if (!p.gameEnd && points.a >= 3 && points.b >= 3) {
        if (points.a === points.b) { sawDeuce = true; assert.deepEqual(p.score.pointText, { a: "40", b: "40" }); }
        else { sawAdvantage = true; assert.equal(p.score.pointText[p.winner], "AD"); }
      }
      if (isGameEnd) games[p.winner]++;
      const isSetEnd = isGameEnd && (p.tiebreak || games[p.winner] >= 6 && games[p.winner] - games[loser] >= 2);
      assert.equal(p.setEnd, isSetEnd);
      if (isSetEnd) sets[p.winner]++;
      assert.deepEqual(p.score.games, games);
      assert.deepEqual(p.score.sets, sets);
      if (p.gameEnd) {
        if (p.tiebreak) { expectedServer = opposite(firstTieServer); sawNextSet ||= Boolean(result.points[i + 1]); }
        else expectedServer = opposite(p.server);
        points = { a: 0, b: 0 }; tiePoints = 0;
        if (p.setEnd) games = { a: 0, b: 0 };
      } else if (p.tiebreak) {
        // TB は最初の1球、その後2球ずつ。第2・3球、第6・7球…は相手。
        expectedServer = (tiePoints % 4 === 1 || tiePoints % 4 === 2) ? opposite(firstTieServer) : firstTieServer;
      }
      if (p.matchEnd) assert.equal(i, result.points.length - 1);
    }
    assert.ok(result.points.at(-1).matchEnd);
    assert.equal(sets[result.winner], 3);
    assert.equal(result.scoreText, result.sets.map(s => `${s.a}-${s.b}${s.tiebreak ? `(${Math.min(s.tiebreak.a, s.tiebreak.b)})` : ""}`).join(" "));
  }
  assert.ok(sawDeuce && sawAdvantage && sawTiebreak && sawExtendedTiebreak && sawNextSet);
});

test("1／3／5セット、各サーフェス、最初のサーバーの設定で正しく終了する", () => {
  for (const format of [1, 3, 5]) for (const surface of ["hard", "clay", "grass"]) for (const firstServer of ["a", "b", "random"]) {
    const r = TennisMatch.simulate({ a: entry(), b: entry(), format, surface, firstServer, seed: 1234 });
    assert.equal(r.sets.filter(s => s[r.winner] > s[opposite(r.winner)]).length, (format + 1) / 2);
    assert.ok(r.sets.length <= format);
    if (firstServer !== "random") assert.equal(r.points[0].server, firstServer);
  }
});

test("スタッツはポイント記録と一致し、プレッシャー実況はポイントより前に出る", () => {
  const r = TennisMatch.simulate({ a: entry(50, { playStyle: "serve_volley" }), b: entry(), format: 5, seed: 2468 });
  for (const key of ["a", "b"]) {
    const count = fn => r.points.filter(fn).length, s = r.stats[key];
    assert.equal(s.pointsWon, count(p => p.winner === key));
    assert.equal(s.aces, count(p => p.server === key && p.kind === "ace"));
    assert.equal(s.doubleFaults, count(p => p.server === key && p.kind === "doubleFault"));
    assert.equal(s.firstServesIn, count(p => p.server === key && p.firstServeIn));
    assert.equal(s.firstServePointsWon, count(p => p.server === key && p.firstServeIn && p.winner === key));
    assert.equal(s.secondServes, count(p => p.server === key && !p.firstServeIn));
    assert.equal(s.secondServePointsWon, count(p => p.server === key && !p.firstServeIn && p.winner === key));
    assert.equal(s.winners, count(p => p.winner === key && !["doubleFault", "error"].includes(p.kind)));
    assert.equal(s.errors, count(p => p.winner !== key && ["doubleFault", "error"].includes(p.kind)));
    assert.equal(s.netPoints, count(p => p.net));
    assert.equal(s.netPointsWon, count(p => p.net && p.winner === key));
    assert.equal(s.breakPointOpportunities, count(p => !p.tiebreak && p.server !== key && p.pressure.includes("break")));
    assert.equal(s.breakPointsWon, count(p => !p.tiebreak && p.server !== key && p.pressure.includes("break") && p.gameEnd && p.winner === key));
    near(s.firstServeRate, s.firstServesIn / s.servicePoints);
    near(s.firstServeWinRate, s.firstServePointsWon / s.firstServesIn);
    near(s.secondServeWinRate, s.secondServePointsWon / s.secondServes);
  }
  for (let i = 0; i < r.points.length; i++) {
    const lines = r.log.filter(l => l.pointIndex === i), pointIndex = lines.findIndex(l => l.type === "point");
    assert.ok(pointIndex >= 0);
    lines.forEach((l, index) => { if (l.type === "pressure") assert.ok(index < pointIndex); assert.ok(!l.text.includes("undefined") && !/\{\w+\}/.test(l.text)); });
  }
  assert.equal(r.log.filter(l => l.type === "set").length, r.sets.length);
  assert.equal(r.log.at(-1).type, "match");
  assert.ok(r.points.some(p => p.pressure.includes("match")));
  assert.ok(r.points.some(p => p.net));
  Object.values(DATA.match.commentary).forEach(lines => assert.ok(lines.length >= 3));
});

test("調子・サーフェス・疲労・鉄人・プレッシャーの実効値と上下限", () => {
  const a = entry(), b = entry(), initial = state(), late = state({ setNumber: 5 });
  near(TennisMatch.effectiveStats(a, b, initial, "a").control, 53);
  near(TennisMatch.effectiveStats(a, b, state({ form: { a: -3, b: 0 }, surface: "grass" }), "a").control, 47);
  near(TennisMatch.effectiveStats(a, b, late, "a").control, 53 - (99 - 50) * 0.03 * 4);
  near(TennisMatch.effectiveStats(entry(50, { gold: ["ironman"] }), b, late, "a").control, 53);
  const pressure = TennisMatch.effectiveStats(a, b, initial, "a", ["tiebreak"]);
  near(pressure.control, 53 + 3 * 0.15);
  const extreme = entry(99, { gold: ["precision", "champion", "idaten", "gods_touch"], plus: ["adversity"], rankSkills: { clutch: "A", vs_left: "A" } });
  b.player.hand = "left";
  Object.values(TennisMatch.effectiveStats(extreme, b, state({ setNumber: 5, games: { a: 0, b: 3 }, form: { a: 6, b: 0 } }), "a", ["break"])).forEach(v => assert.ok(v >= 1 && v <= 130));
  Object.values(TennisMatch.effectiveStats(entry(1, { minus: ["quitter", "short_temper", "slow_starter"] }), b, state({ games: { a: 0, b: 4 }, setsWon: { a: 0, b: 1 }, lastGameWinner: "b", form: { a: -6, b: 0 } }), "a")).forEach(v => assert.ok(v >= 1));
});

test("全能力補正の発動条件、ゴールド能力、ランク能力と効果のない能力", () => {
  const b = entry(), base = entry();
  const checkAll = (overrides, context, delta, pressure = []) => {
    const normal = TennisMatch.effectiveStats(base, b, context, "a", pressure);
    const actual = TennisMatch.effectiveStats(entry(50, overrides), b, context, "a", pressure);
    statIds.forEach(id => near(actual[id] - normal[id], delta * (pressure.length && ["control", "power"].includes(id) ? 1.15 : 1)));
  };
  checkAll({ gold: ["champion"] }, state(), 0);
  checkAll({ gold: ["champion"] }, state({ setNumber: 5 }), 5);
  checkAll({ gold: ["champion"] }, state({ tiebreak: true }), 5);
  checkAll({ plus: ["fast_start"] }, state({ gameNumber: 4 }), 4);
  checkAll({ plus: ["fast_start"] }, state({ gameNumber: 5 }), 0);
  checkAll({ minus: ["slow_starter"] }, state(), -4);
  checkAll({ plus: ["adversity"] }, state({ games: { a: 0, b: 2 } }), 4);
  checkAll({ plus: ["adversity"] }, state({ setsWon: { a: 0, b: 1 } }), 4);
  checkAll({ minus: ["quitter"] }, state({ games: { a: 0, b: 2 } }), 0);
  checkAll({ minus: ["quitter"] }, state({ games: { a: 0, b: 2 }, setsWon: { a: 0, b: 1 } }), -4);
  checkAll({ minus: ["short_temper"] }, state({ lastGameWinner: "b" }), -3);
  checkAll({ minus: ["short_temper"] }, state({ lastGameWinner: "a" }), 0);
  for (const [rank, value] of Object.entries(DATA.match.abilities.ranks)) {
    checkAll({ rankSkills: { clutch: rank } }, state(), value * 1.5, ["break"]);
    checkAll({ rankSkills: { clutch: rank } }, state(), 0, ["set"]);
    b.player.hand = "left"; checkAll({ rankSkills: { vs_left: rank } }, state(), value * 1.5); b.player.hand = "right";
  }
  for (const [id, stat, bonus] of [["precision", "control", 6], ["idaten", "speed", 8], ["gods_touch", "net", 8]]) {
    const actual = TennisMatch.effectiveStats(entry(50, { gold: [id] }), b, state(), "a");
    statIds.forEach(key => near(actual[key], 53 + (key === stat ? bonus : 0)));
  }
  const options = { a: entry(), b: entry(), seed: 333, format: 5 };
  assert.deepEqual(TennisMatch.simulate(options), TennisMatch.simulate({ ...options, a: entry(50, { plus: ["doubles"], rankSkills: { recovery: "A", durability: "G" } }) }));
});

test("サーブ種類・ショット適性・ネット・相性と能力の確率補正", () => {
  const a = entry(), b = entry(), plain = chances(a, b);
  const bullet = chances(entry(50, { gold: ["bullet_serve"] }), b);
  near(bullet.ace - plain.ace, 0.06); near(bullet.win - plain.win, 8 * DATA.match.point.kServe);
  near(chances(entry(50, { gold: ["precision"] }), b).firstIn - plain.firstIn, 0.05 + 6 * 0.003);
  near(chances(entry(50, { minus: ["double_fault"] }), b, state(), ["break"]).secondIn - chances(a, b, state(), ["break"]).secondIn, -0.08);
  near(chances(entry(50, { minus: ["double_fault"] }), b).secondIn, plain.secondIn);
  for (const serve of DATA.serves) {
    const p = chances(entry(50, { serve: serve.id }), b), adjust = DATA.match.serves[serve.id], flat = DATA.match.serves.flat;
    near(p.firstIn - plain.firstIn, adjust.first - flat.first);
    near(p.secondIn - plain.secondIn, adjust.second - flat.second);
    near(p.ace - plain.ace, adjust.ace - flat.ace);
  }
  for (const [level, value] of Object.entries(DATA.match.shots.levels)) {
    near(chances(a, entry(50, { shotSkills: { return: level } })).ace - plain.ace, -value * 0.002);
    near(chances(entry(50, { shotSkills: { forehand: level, backhand: level } }), b).win - plain.win, value * 0.5 * DATA.match.point.kRally);
    near(chances(a, entry(50, { shotSkills: { return: level } })).win - plain.win, -value * 0.5 * DATA.match.point.kServe);
  }
  const kick = entry(50, { serve: "kick" });
  near(chances(kick, entry(50, { plus: ["high_point"] })).win - chances(kick, b).win, -5 * DATA.match.point.kServe);
  near(chances(a, entry(50, { plus: ["high_point"] })).win, plain.win);
  for (const surface of ["hard", "clay", "grass"]) for (const style of DATA.playStyles) {
    const actual = chances(entry(50, { playStyle: style.id }), b, state({ surface })).win;
    const normal = chances(a, b, state({ surface })).win;
    near(actual - normal, (DATA.match.styles[style.id][surface] - DATA.match.styles.allround[surface]) * DATA.match.point.kRally);
  }
  for (const [style, matchups] of Object.entries(DATA.match.matchups)) for (const [opponent, bonus] of Object.entries(matchups)) {
    const actual = chances(entry(50, { playStyle: style }), entry(50, { playStyle: opponent })).win;
    const expectedRally = DATA.match.styles[style].hard - DATA.match.styles[opponent].hard + bonus - (DATA.match.matchups[opponent]?.[style] || 0);
    near(actual - plain.win, expectedRally * DATA.match.point.kRally);
  }
  for (const shot of ["slice_shot", "drop"]) near(chances(entry(50, { shotSkills: { [shot]: "great" } }), b).win - plain.win, 6 * 0.2 * DATA.match.point.kRally);
  near(chances(entry(50, { plus: ["rising", "tenacious"] }), b).win - plain.win, 5 * DATA.match.point.kRally);
  near(chances(entry(50, { shotSkills: { volley: "great", smash: "great" } }), b, state(), [], true).win - chances(a, b, state(), [], true).win, 6 * DATA.match.point.kNet);
  near(chances(a, entry(50, { shotSkills: { passing: "great", lob: "great" } }), state(), [], true).win - chances(a, b, state(), [], true).win, -6 * DATA.match.point.kNet);
  for (const p of Object.values(chances(entry(99), entry(1)))) assert.ok(p >= 0 && p <= 1);
});

test("弾丸サーブとダブルフォールト癖は実際の試合でも効き、ネットとショット適性は記録に現れる", () => {
  const totals = { plainAce: 0, bulletAce: 0, plainDF: 0, badDF: 0, plainAttempts: 0, badAttempts: 0, great: 0, bad: 0, net: 0, eligibleNet: 0 };
  for (let seed = 1; seed <= 500; seed++) {
    const plain = TennisMatch.simulate({ a: entry(), b: entry(), seed });
    const bullet = TennisMatch.simulate({ a: entry(50, { gold: ["bullet_serve"] }), b: entry(), seed });
    const bad = TennisMatch.simulate({ a: entry(50, { minus: ["double_fault"] }), b: entry(), seed });
    totals.plainAce += plain.stats.a.aces; totals.bulletAce += bullet.stats.a.aces;
    for (const [r, prefix] of [[plain, "plain"], [bad, "bad"]]) for (const p of r.points) if (p.server === "a" && p.pressure.length && !p.firstServeIn) {
      totals[`${prefix}Attempts`]++; if (p.kind === "doubleFault") totals[`${prefix}DF`]++;
    }
    for (const [level, field] of [["great", "great"], ["bad", "bad"]]) {
      const r = TennisMatch.simulate({ a: entry(50, { shotSkills: { forehand: level } }), b: entry(), seed });
      totals[field] += r.points.filter(p => p.winner === "a" && p.shot === "forehand").length;
    }
    const net = TennisMatch.simulate({ a: entry(50, { playStyle: "serve_volley" }), b: entry(), seed });
    for (const p of net.points) if (p.server === "a" && p.firstServeIn && p.kind !== "ace") { totals.eligibleNet++; if (p.net) totals.net++; }
  }
  assert.ok(totals.bulletAce > totals.plainAce * 1.3);
  assert.ok(totals.badDF / totals.badAttempts > totals.plainDF / totals.plainAttempts + 0.04);
  assert.ok(totals.great > totals.bad * 1.2);
  assert.ok(totals.net / totals.eligibleNet > 0.67 && totals.net / totals.eligibleNet < 0.73);
});

test("不正な設定を拒否し、極端な能力でも終了する", () => {
  assert.throws(() => TennisMatch.simulate({}), /設定/);
  for (const extra of [{ format: 2 }, { surface: "invalid" }, { firstServer: "c" }, { seed: NaN }]) assert.throws(() => TennisMatch.simulate({ a: entry(), b: entry(), ...extra }));
  for (const value of [1, 99]) {
    const r = TennisMatch.simulate({ a: entry(value), b: entry(value), format: 5, seed: 0 });
    assert.ok(r.winner); assert.ok(r.points.length > 0);
  }
});

// 各条件とも seed 1〜5000。勝率はA（能力50+差）側。比率は合計分子/合計分母。
function measure(difference = 0, format = 3, surface = "hard") {
  const options = { a: entry(50 + difference), b: entry(50), format, surface };
  let wins = 0, points = 0, aces = 0, faults = 0, first = 0, serviceWon = 0, service = 0;
  const trials = 5000;
  for (let seed = 1; seed <= trials; seed++) {
    const r = TennisMatch.simulate({ ...options, seed });
    wins += r.winner === "a"; points += r.points.length;
    for (const s of Object.values(r.stats)) { aces += s.aces; faults += s.doubleFaults; first += s.firstServesIn; serviceWon += s.servicePointsWon; service += s.servicePoints; }
  }
  return { difference, format, surface, trials, winRate: wins / trials, firstServeRate: first / service, serviceWinRate: serviceWon / service,
    acesPerPlayer: aces / trials / 2, doubleFaultsPerPlayer: faults / trials / 2, pointsPerMatch: points / trials };
}

test("12-9：各5000試合の勝率・スタッツ・形式・サーフェスの調整目標", () => {
  const measurements = [0, 10, 20, 30].map(diff => measure(diff));
  measurements.push(measure(10, 1), measure(10, 5), measure(0, 3, "clay"), measure(0, 3, "grass"));
  console.log("MATCH_MEASUREMENTS " + JSON.stringify(measurements));
  console.log("MATCH_COEFFICIENTS " + JSON.stringify({ base: DATA.match.point.base, kServe: DATA.match.point.kServe, kRally: DATA.match.point.kRally, kNet: DATA.match.point.kNet }));
  for (const [index, min, max] of [[0, 0.47, 0.53], [1, 0.70, 0.80], [2, 0.88, 0.95], [3, 0.96, 1]]) {
    const actual = measurements[index].winRate; assert.ok(actual >= min && actual <= max, `差${index * 10}の勝率 ${actual}`);
  }
  const baseline = measurements[0];
  for (const [field, min, max] of [["firstServeRate", 0.55, 0.65], ["serviceWinRate", 0.58, 0.66], ["acesPerPlayer", 2, 8], ["doubleFaultsPerPlayer", 1, 5], ["pointsPerMatch", 130, 200]]) assert.ok(baseline[field] >= min && baseline[field] <= max, `${field} ${baseline[field]}`);
  assert.ok(measurements[4].winRate < measurements[1].winRate && measurements[5].winRate > measurements[1].winRate);
  const surfaceDifference = measurements[7].serviceWinRate - measurements[6].serviceWinRate;
  assert.ok(surfaceDifference >= 0.04 && surfaceDifference <= 0.08, `芝−クレー ${surfaceDifference}`);
});
