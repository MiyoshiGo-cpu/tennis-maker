// Node 標準機能だけで実行: node --test tests/tournament.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const DATA = require("../data.js");
const TennisMatch = require("../match.js");
const copy = value => JSON.parse(JSON.stringify(value));
const opposite = side => side === "a" ? "b" : "a";
function entry(name, durability = "D", carryFatigue) {
  return { player: { id: "p_test" + name, name, hand: "right", backhand: "two" }, seriesId: "2017-1",
    card: { surface: "hard", stats: { control: 50, power: 50, speed: 50, stamina: 50, mental: 50, net: 50 },
      playStyle: "allround", serve: "flat", shotSkills: {}, rankSkills: { durability }, gold: [], plus: [], minus: [] },
    ...(carryFatigue === undefined ? {} : { carryFatigue }) };
}
function options(extra = {}) { return { a: entry("A"), b: entry("B"), format: 3, surface: "hard", firstServer: "a", ...extra }; }
const context = vm.createContext({});
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
vm.runInContext(fs.readFileSync(path.join(__dirname, "../data.js"), "utf8") + "\n" + source.slice(0, source.indexOf("(function () {")), context);

test("通常対戦はPhase 4導入前の固定seed結果（勝敗・全ポイント・実況・スタッツ）と一致する", () => {
  // ae0cd2b の simulate 結果を、下記と同じ設定でJSON化して記録したSHA-256。
  const fixtures = [
    [1,9,"a","hard","1e106a518304d075d15c8f02376a5e8495d1d41bcaeb3b0fa2687469f29d394a"],
    [3,3,"a","hard","5fa120b212d3872ff94b7fcc1dc8b57e9c19bc65498d65a3b652228047a7e126"],
    [3,4,"b","clay","41ce2c9f790fa425a9e103ec3a25d9abb8f9090fe50059dd5d7395f962177e99"],
    [3,60,"random","hard","d84358079c88c8ab31799af682c069bfdb91c2dbac2f67c56b326b0825ca0736"],
    [5,27,"a","hard","af4de237b2cf2b8c1b5cd97e10b9989781cdec2baf8191b1112898248a1eceeb"],
    [5,2,"random","grass","b983606041930a0c5b18e438e20126c2980395a7df160f5c44898d380d7c68ad"]
  ];
  for (const [format, seed, firstServer, surface, digest] of fixtures) {
    const setup=options({format,seed,firstServer,surface});
    // 導入前の設定にはdurabilityもcarryFatigueも明示していなかった。
    setup.a.card.rankSkills={};setup.b.card.rankSkills={};
    const result=TennisMatch.simulate(setup),before=copy(result);delete before.retired;
    assert.equal(result.retired,null);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(before)).digest("hex"),digest);
    assert.deepEqual(TennisMatch.simulate({...setup,injury:false}),result);
    assert.deepEqual(TennisMatch.simulate({...setup,a:{...setup.a,carryFatigue:0},b:{...setup.b,carryFatigue:0}}),result);
  }
});

test("持ち越し疲労は表3能力だけから引き、鉄人にも適用し、下限を守る", () => {
  const state={format:3,surface:"hard",setNumber:2,gameNumber:1,games:{a:0,b:0},setsWon:{a:0,b:0},form:{a:0,b:0},tiebreak:false,lastGameWinner:null};
  for (const gold of [[],["ironman"]]) {
    const a=entry("A");a.card.gold=gold;
    const before=copy(a),plain=TennisMatch.effectiveStats(a,entry("B"),state,"a",["set"]);
    const tired=TennisMatch.effectiveStats({...a,carryFatigue:12.5},entry("B"),state,"a",["set"]);
    for(const id of ["control","power","speed"])assert.equal(tired[id],plain[id]-12.5);
    for(const id of ["stamina","mental","net"])assert.equal(tired[id],plain[id]);
    const low=TennisMatch.effectiveStats({...a,carryFatigue:1000},entry("B"),state,"a");
    for(const id of ["control","power","speed"])assert.equal(low[id],DATA.match.effective.min);
    assert.deepEqual(a,before);
  }
});

test("持ち越し疲労30の選手は同じseed群で勝率が下がる", () => {
  const trials=1000;let fresh=0,tired=0;
  for(let seed=1;seed<=trials;seed++) {
    fresh+=TennisMatch.simulate(options({seed})).winner==="a";
    tired+=TennisMatch.simulate(options({seed,a:entry("A","D",30)})).winner==="a";
  }
  assert.ok(tired<fresh*0.75,`${fresh}/${trials} → ${tired}/${trials}`);
  console.log("TOURNAMENT_FATIGUE "+JSON.stringify({trials,freshWins:fresh,tiredWins:tired,carryFatigue:30}));
});

function checkRetirement(result) {
  assert.equal(result.winner,opposite(result.retired));
  assert.ok(result.scoreText.endsWith(" RET"));
  assert.deepEqual(result.sets.at(-1).a,result.points.at(-1).score.games.a);
  assert.deepEqual(result.sets.at(-1).b,result.points.at(-1).score.games.b);
  assert.equal(result.points.at(-1).gameEnd,true);
  assert.equal(result.points.at(-1).matchEnd,true);
  assert.equal(result.log.at(-1).type,"match");
  assert.equal(result.log.at(-1).text,`${result.retired.toUpperCase()}がケガのため途中棄権。${result.winner.toUpperCase()}の勝利`);
  assert.equal(result.log.some(line=>line.text.startsWith("ゲームセット！")),false);
  for(const stats of Object.values(result.stats))assert.ok(Object.values(stats).every(Number.isFinite));
}

test("D同士20,000試合の棄権割合は1.5〜3.5%、Aの棄権率はGの半分以下になる", () => {
  const trials=20000,measurements=[],covered=new Set();
  for(const rank of ["A","D","G"]) {
    const setup=options({a:entry("A",rank),b:entry("B",rank),injury:true});
    let retired=0,a=0,b=0;
    for(let seed=1;seed<=trials;seed++) {
      const result=TennisMatch.simulate({...setup,seed});
      if(result.retired) {
        retired++;a+=result.retired==="a";b+=result.retired==="b";checkRetirement(result);
        const last=result.points.at(-1);covered.add(last.setEnd?"setEnd":"partial");
        if(last.tiebreak)covered.add("tiebreak");
      } else assert.ok(!result.scoreText.includes("RET"));
    }
    measurements.push({rank,trials,retiredMatches:retired,matchRate:retired/trials,aRetired:a,bRetired:b,playerAppearances:trials*2,playerRate:retired/(trials*2)});
  }
  console.log("TOURNAMENT_INJURY "+JSON.stringify(measurements));
  const [a,d,g]=measurements;
  assert.ok(d.matchRate>=0.015&&d.matchRate<=0.035,`D同士 ${d.matchRate}`);
  assert.ok(a.playerRate<=g.playerRate/2,`A ${a.playerRate} / G ${g.playerRate}`);
  for(const type of ["setEnd","partial","tiebreak"])assert.ok(covered.has(type),type);
});

test("棄権時は最優先の見出し・タグなしとなり、実況スコアに未完セットも残る", () => {
  const base=DATA.tournament.injury.base;
  try {
    DATA.tournament.injury.base=1;
    const setup=options({seed:3,injury:true}),before=copy(setup),result=TennisMatch.simulate(setup);
    assert.equal(result.retired,"a");checkRetirement(result);
    assert.equal(result.sets.length,1);assert.equal(result.points.at(-1).setEnd,false);
    assert.equal(result.stats.b.servicePoints,0);assert.equal(result.stats.b.firstServeRate,0);
    assert.deepEqual(TennisMatch.simulate(setup),result);assert.deepEqual(setup,before);
    context.options=setup;context.result=result;context.shown=result.points.length;
    const presentation=copy(vm.runInContext("matchPresentation(options,result)",context));
    assert.equal(presentation.headline,"retirement");assert.deepEqual(presentation.tags,[]);
    const frame=copy(vm.runInContext("matchReplayFrame(result,shown,3)",context));
    assert.equal(frame.finished,true);assert.equal(frame.server,null);
    assert.deepEqual([frame.columns[0].a,frame.columns[0].b],[result.sets[0].a,result.sets[0].b]);
    context.shown=0;
    const initial=copy(vm.runInContext("matchReplayFrame(result,shown,3)",context));
    assert.deepEqual([initial.columns[0].a,initial.columns[0].b],[0,0]);
    assert.deepEqual([initial.columns[1].a,initial.columns[1].b],["−","−"]);
  } finally { DATA.tournament.injury.base=base; }
});

test("疲労とdurabilityの倍率は仕様値で、持ち越し疲労が大きいほど棄権確率が増す", () => {
  assert.equal(DATA.tournament.injury.base,0.0005);assert.equal(DATA.tournament.injury.fatigueScale,0.05);
  assert.deepEqual(DATA.tournament.injury.durability,{A:0.4,B:0.6,C:0.8,D:1,E:1.3,F:1.7,G:2.2});
  // 実効能力を同じ値に固定し、carryの確率倍率だけを変えて発生条件を確認する。
  const base=DATA.tournament.injury.base,max=DATA.match.effective.max;
  try {
    DATA.tournament.injury.base=0.1;
    DATA.match.effective.max=DATA.match.effective.min;
    let freshFirst=0,tiredFirst=0;
    for(let seed=1;seed<=200;seed++) {
      const a=entry("A");
      const fresh=TennisMatch.simulate(options({a,seed,injury:true}));
      const tired=TennisMatch.simulate(options({a:{...a,carryFatigue:20},seed,injury:true}));
      freshFirst+=fresh.retired==="a"&&fresh.points.at(-1).game===1;
      tiredFirst+=tired.retired==="a"&&tired.points.at(-1).game===1;
    }
    assert.ok(tiredFirst>freshFirst);
  } finally { DATA.tournament.injury.base=base;DATA.match.effective.max=max; }
});

test("不正な疲労やinjury設定は拒否し、欠損durabilityはDとして扱う", () => {
  for(const carryFatigue of [-1,NaN,Infinity,"1",null])assert.throws(()=>TennisMatch.simulate(options({a:entry("A","D",carryFatigue)})));
  for(const injury of [null,1,"true"])assert.throws(()=>TennisMatch.simulate(options({injury})));
  const a=entry("A");a.card.rankSkills={};
  assert.deepEqual(TennisMatch.simulate(options({a,injury:true,seed:3})),TennisMatch.simulate(options({injury:true,seed:3})));
});
