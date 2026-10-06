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
context.TennisMatch = TennisMatch;
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

function drawPlayers(count) {
  return Array.from({length:count},(_,index)=>({id:"p_"+String(index+1).padStart(5,"0"),name:"選手"+String(index+1).padStart(3,"0"),
    createdAt:new Date(Date.UTC(2026,0,1,0,index)).toISOString(),
    cards:{"2017-1":{stats:Object.fromEntries(Object.keys(entry("A").card.stats).map(id=>[id,99-Math.floor(index/3)]))}}}));
}
function draw(players,seed=42) {
  context.players=players;context.seed=seed;
  return copy(vm.runInContext("createTournamentDraw(players,'2017-1',seed)",context));
}

test("2・3・8・13・128人のドローは枠数・シード数・BYE数・同seedの再現性を満たす",()=>{
  for(const [count,size,seeds]of [[2,2,0],[3,4,2],[8,8,2],[13,16,4],[128,128,32]]) {
    const players=drawPlayers(count),before=copy(players),result=draw(players);
    assert.equal(result.slots.length,size);assert.equal(result.entrants.filter(e=>e.seedRank).length,seeds);
    assert.equal(result.slots.filter(id=>id===null).length,size-count);assert.equal(result.matches.length,size-1);
    assert.equal(new Set(result.slots.filter(Boolean)).size,count);assert.deepEqual(draw([...players].reverse()),result);
    assert.deepEqual(players,before);
    const seeded=result.entrants.filter(e=>e.seedRank);
    for(let i=0;i<Math.min(size-count,seeds);i++)assert.equal(result.slots[result.slots.indexOf(seeded[i].playerId)^1],null);
  }
});

test("全人数2〜128のドローにBYE同士がなく、各選手がちょうど1枠に入る",()=>{
  for(let count=2;count<=128;count++)for(const seed of [1,42,99]) {
    const result=draw(drawPlayers(count),seed);
    assert.deepEqual(result.slots.filter(Boolean).sort(),drawPlayers(count).map(p=>p.id).sort());
    const first=result.matches.filter(m=>m.round===1);
    assert.ok(first.every(m=>m.a||m.b));
    assert.equal(first.filter(m=>m.status==="bye").length,result.slots.length-count);
    assert.ok(result.matches.filter(m=>m.round>1).every(m=>m.status==="pending"));
  }
});

test("シード1・2は上下端、各段階のシードは別区画に入り、決勝・準決勝前に当たらない",()=>{
  for(const count of [3,8,13,32,64,128])for(const seed of [1,2,42,99]) {
    const result=draw(drawPlayers(count),seed),size=result.slots.length;
    const positions=result.entrants.filter(e=>e.seedRank).map(e=>result.slots.indexOf(e.playerId));
    assert.equal(positions[0],0);assert.equal(positions[1],size-1);
    for(let group=2;group<=positions.length;group*=2) {
      const width=size/group,top=positions.slice(0,group);
      assert.equal(new Set(top.map(p=>Math.floor(p/width))).size,group);
      assert.ok(top.every(p=>p%width===0||p%width===width-1));
      for(let i=0;i<top.length;i++)for(let j=i+1;j<top.length;j++)assert.ok(Math.floor(Math.log2(top[i]^top[j]))+1>=Math.log2(width)+1);
    }
  }
  const first=draw(drawPlayers(32),1);assert.notDeepEqual(draw(drawPlayers(32),2).slots,first.slots);
});

test("大会は作成・編集・再抽選でき、出場資格と人数を守り、開催中は変更できない",()=>{
  context.raw={version:2,players:drawPlayers(13)};
  vm.runInContext("world=normalizeWorld(raw)",context);
  context.settings={...DATA.tournament.initial,seriesId:"2017-1",name:"大会",seed:42,entrantIds:drawPlayers(13).map(p=>p.id)};
  const created=copy(vm.runInContext("t=createWorldTournament(world,settings)",context));
  assert.equal(created.status,"draft");assert.match(created.id,/^t_[a-z0-9]{5,}$/);assert.deepEqual(created.snapshot,{});
  context.settings={...context.settings,name:"変更",theme:"red",entrantIds:drawPlayers(3).map(p=>p.id)};
  assert.equal(vm.runInContext("updateWorldTournament(world,t,settings)",context),true);
  const edited=copy(vm.runInContext("t",context));assert.equal(edited.id,created.id);assert.equal(edited.createdAt,created.createdAt);
  assert.equal(edited.name,"変更");assert.equal(edited.slots.length,4);
  assert.equal(vm.runInContext("redrawWorldTournament(world,t)",context),true);assert.notEqual(vm.runInContext("t.seed",context),42);
  for(const entrantIds of [[],["p_00001"],["p_00001","p_bad"],drawPlayers(129).map(p=>p.id)]) {
    context.settings.entrantIds=entrantIds;
    assert.equal(vm.runInContext("createWorldTournament(world,settings)",context),null);
    assert.equal(vm.runInContext("updateWorldTournament(world,t,settings)",context),false);
  }
  vm.runInContext("t.status='live'",context);
  assert.equal(vm.runInContext("updateWorldTournament(world,t,settings)",context),false);
  assert.equal(vm.runInContext("redrawWorldTournament(world,t)",context),false);
});

test("大会ルートは存在する大会だけを開き、開催中の編集ルートは大会表示に戻す",()=>{
  context.world={tournaments:[{id:"t_aaaaa",status:"draft"},{id:"t_bbbbb",status:"live"}]};
  for(const [hash,type]of [["#/tournaments","list"],["#/tournaments/new","edit"],["#/tournament/t_aaaaa","draw"],["#/tournament/t_aaaaa/edit","edit"],["#/tournament/t_bbbbb/edit","draw"]]) {
    context.hash=hash;assert.equal(vm.runInContext("resolveTournamentRoute(world,hash).type",context),type);
  }
  context.hash="#/tournament/t_missing";assert.equal(vm.runInContext("resolveTournamentRoute(world,hash)",context),null);
});

test("全6テーマは仕様の色と共通キーを持ち、通常対戦のdefaultは変わらない",()=>{
  const expected={default:["#0B1530","#16306E","#1F4FBF","#FFD23F"],clay:["#2A0F08","#7A2E14","#C8562D","#FFE3B3"],
    grass:["#0B2416","#1C5A35","#2F8A4F","#C9A7FF"],purple:["#170B2E","#3B1F6E","#6A3FC8","#F5C451"],
    ice:["#071A2B","#0F3D5C","#1E7FB8","#7FE0FF"],red:["#140708","#3D0E12","#B3202E","#FF8A80"]};
  for(const [id,values]of Object.entries(expected)) {
    const theme=DATA.match.themes[id];assert.deepEqual([theme["bg-top"],theme["bg-bottom"],theme.main,theme.accent],values);
    assert.deepEqual(Object.keys(theme).sort(),Object.keys(DATA.match.themes.default).sort());
    assert.equal(theme.text,"#FFFFFF");assert.equal(theme["winner-ink"],"#14213D");
  }
  context.round=1;context.slots=16;assert.equal(vm.runInContext("tournamentRoundName(round,slots)",context),"1回戦");
  context.round=2;assert.equal(vm.runInContext("tournamentRoundName(round,slots)",context),"準々決勝");
  context.round=3;assert.equal(vm.runInContext("tournamentRoundName(round,slots)",context),"準決勝");
  context.round=4;assert.equal(vm.runInContext("tournamentRoundName(round,slots)",context),"決勝");
});


function progressWorld(count, extra = {}) {
  context.raw = {version:2,players:drawPlayers(count)};
  vm.runInContext("world=normalizeWorld(raw)",context);
  context.settings={...DATA.tournament.initial,seriesId:"2017-1",format:1,seed:12345,entrantIds:drawPlayers(count).map(p=>p.id),...extra};
  vm.runInContext("t=createWorldTournament(world,settings)",context);
}
function run(code) { return vm.runInContext(code,context); }

test("2・5・16・128人を観戦用計算と結果のみ・ラウンド一括を混ぜて優勝まで進められる",()=>{
  for(const count of [2,5,16,128]) {
    progressWorld(count,{finalFormat:3});
    const first=copy(run("t.matches.find(m=>m.status==='pending'&&m.a&&m.b)"));context.matchId=first.id;
    const watched=copy(run("playTournamentMatch(world,t,matchId)"));
    assert.deepEqual(copy(run("replayTournamentMatch(t,matchId)")),watched);
    assert.equal(run("Object.keys(t.snapshot).length"),count);
    assert.equal(run("t.status"),count===2?"done":"live");
    run("playTournamentRound(world,t,1); playTournamentRemaining(world,t)");
    const tournament=copy(run("t"));
    assert.equal(tournament.status,"done");assert.ok(tournament.snapshot[tournament.championId]);
    assert.equal(tournament.matches.filter(m=>m.result).length,count-1);
    assert.equal(tournament.matches.filter(m=>m.status==='bye').length,tournament.slots.length-count);
    assert.ok(tournament.matches.every(m=>m.status==='bye'||m.status==='done'));
    assert.ok(tournament.matches.filter(m=>m.round>1).every(m=>m.a&&m.b));
    const seeds=tournament.matches.filter(m=>m.result).map(m=>m.result.seed);assert.equal(new Set(seeds).size,count-1);
    assert.equal(run("tournamentMatchOptions(t,t.matches.at(-1)).format"),3);
    for(const match of tournament.matches.filter(m=>m.result)) {
      context.matchId=match.id;const replay=copy(run("replayTournamentMatch(t,matchId).result"));
      assert.equal(replay.scoreText,match.result.scoreText);assert.equal(replay.winner,match.result.winner);
      assert.deepEqual(replay.stats,match.result.stats);assert.equal(replay.points.length,match.result.points);
      assert.equal(match.result.log,undefined);assert.equal(typeof match.result.points,"number");
    }
    assert.equal(run("tournamentChampionPath(t).length"),Math.log2(tournament.slots.length));
  }
});

test("疲労はポイント数から増え、鉄人は半分、次戦前に回復ランクに応じて減る",()=>{
  progressWorld(4);
  run("world.players[0].cards['2017-1'].gold=['ironman']; world.players[0].cards['2017-1'].rankSkills.recovery='A'");
  context.fake=options=>({winner:'a',scoreText:'6-0',sets:[{a:6,b:0}],retired:null,stats:{a:{},b:{}},points:Array(1000).fill({})});
  run("playTournamentMatch(world,t,'r1-m1',fake); playTournamentMatch(world,t,'r1-m2',fake)");
  assert.equal(run("t.fatigue.p_00001"),7.5);
  const final=copy(run("tournamentMatchOptions(t,t.matches.at(-1))"));
  assert.ok(Math.abs(final.a.carryFatigue-3.4)<1e-10);assert.equal(final.b.carryFatigue,13);
  assert.equal(final.injury,true);assert.equal(final.firstServer,'random');
  run("playTournamentMatch(world,t,'r2-m1',fake)");
  assert.ok(Math.abs(run("t.fatigue.p_00001")-10.9)<1e-10);
  assert.equal(run("t.fatigue[t.matches.at(-1).b]"),28);
  assert.deepEqual(copy(run("t.matches.at(-1).result.carry")),{a:final.a.carryFatigue,b:13});
  progressWorld(4);run("playTournamentMatch(world,t,'r1-m1',fake)");
  run("t.fatigue[t.matches[0].a]=0.1; playTournamentMatch(world,t,'r1-m2',fake)");
  assert.equal(run("tournamentMatchOptions(t,t.matches.at(-1)).a.carryFatigue"),0);
  context.entry=final.a;context.opponent=final.b;
  const state={format:1,surface:'hard',setNumber:1,gameNumber:1,games:{a:0,b:0},setsWon:{a:0,b:0},form:{a:0,b:0},lastGameWinner:null,tiebreak:false};
  const tired=TennisMatch.effectiveStats(final.a,final.b,state,'a'),fresh=TennisMatch.effectiveStats({...final.a,carryFatigue:0},final.b,state,'a');
  for(const key of ['control','power','speed'])assert.ok(Math.abs(fresh[key]-tired[key]-3.4)<1e-10);
  // 初戦やBYE後はまだ疲労回復を行わない。Gの回復量は負でも初戦に加算しない。
  progressWorld(5);run("world.players.forEach(p=>p.cards['2017-1'].rankSkills.recovery='G')");
  context.matchId=run("t.matches.find(m=>m.status==='pending'&&m.a&&m.b).id");
  const initial=copy(run("playTournamentMatch(world,t,matchId)"));
  assert.equal(initial.options.a.carryFatigue,0);assert.equal(initial.options.b.carryFatigue,0);
  const next=copy(run("tournamentMatchOptions(t,t.matches.find(m=>m.round===2&&m.a&&m.b))"));
  assert.equal(next.a.carryFatigue,0);assert.equal(next.b.carryFatigue,0);
  progressWorld(4);run("world.players.forEach(p=>p.cards['2017-1'].rankSkills.recovery='G')");
  context.zero=options=>({winner:'a',scoreText:'6-0',sets:[{a:6,b:0}],retired:null,stats:{a:{},b:{}},points:[]});
  run("playTournamentRound(world,t,1,zero)");
  const second=copy(run("tournamentMatchOptions(t,t.matches.at(-1))"));
  assert.ok(Math.abs(second.a.carryFatigue-0.1)<1e-10);assert.ok(Math.abs(second.b.carryFatigue-0.1)<1e-10);
});

test("開催時のsnapshotが編集・全選手削除・保存復元・JSON置換後も表示と振り返りを固定する",()=>{
  progressWorld(5);context.matchId=run("t.matches.find(m=>m.a&&m.b&&m.status==='pending').id");
  const original=copy(run("playTournamentMatch(world,t,matchId)"));const snapshot=copy(run("t.snapshot"));
  run("world.players.forEach(p=>{p.name='編集後';p.hand='left';p.cards['2017-1'].stats.power=1;}); world.players.map(p=>p.id).forEach(id=>deleteWorldPlayer(world,id))");
  assert.deepEqual(copy(run("t.snapshot")),snapshot);assert.deepEqual(copy(run("replayTournamentMatch(t,matchId)")),original);
  run("world=importWorld(createEmptyWorld(),parseWorldImport(prepareWorldExport(world).text),'replace');t=world.tournaments[0]");
  assert.deepEqual(copy(run("replayTournamentMatch(t,matchId)")),original);
  run("playTournamentRemaining(world,t)");assert.equal(run("t.status"),'done');assert.equal(run("world.players.length"),0);
  const before=copy(run("t"));run("world=normalizeWorld(JSON.parse(JSON.stringify(world)));t=world.tournaments[0]");assert.deepEqual(copy(run("t")),before);
});

test("RETを記録し棄権した側の相手が次のラウンドへ進み、同seedで再現する",()=>{
  progressWorld(4);
  const base=DATA.tournament.injury.base;
  try {
    DATA.tournament.injury.base=1;
    const result=copy(run("playTournamentMatch(world,t,'r1-m1')"));
    assert.ok(result.result.retired);assert.equal(result.result.winner,opposite(result.result.retired));
    assert.match(run("t.matches[0].result.scoreText"),/RET$/);
    assert.equal(run("t.matches.at(-1).a"),run("t.matches[0][t.matches[0].result.winner]"));
    assert.deepEqual(copy(run("replayTournamentMatch(t,'r1-m1')")),result);
  } finally { DATA.tournament.injury.base=base; }
});

test("ラウンド一括はそのラウンドだけを進め、BYEに疲労を加えず、既対戦を再計算しない",()=>{
  progressWorld(5);const byeIds=copy(run("t.matches.filter(m=>m.status==='bye').map(m=>m.a||m.b)"));
  run("playTournamentRound(world,t,1)");assert.equal(run("t.matches.filter(m=>m.round===1&&m.result).length"),1);
  assert.equal(run("t.matches.filter(m=>m.round===2&&m.result).length"),0);
  for(const id of byeIds){context.playerId=id;assert.equal(run("t.fatigue[playerId]"),0);}
  const before=copy(run("t"));assert.equal(run("playTournamentMatch(world,t,'r1-m2')"),null);
  run("playTournamentRound(world,t,1)");assert.deepEqual(copy(run("t")),before);
  run("playTournamentRemaining(world,t)");assert.equal(run("t.status"),'done');
  const after=copy(run("t"));run("playTournamentRemaining(world,t)");assert.deepEqual(copy(run("t")),after);
});

test("優勝の記録はラウンド順でBYEと相手・スコアを含み、終了済みの試合と優勝ルートを開ける",()=>{
  progressWorld(5);context.fake=options=>({winner:'a',scoreText:'6-0',sets:[{a:6,b:0}],retired:null,stats:{a:{},b:{}},points:[]});
  run("playTournamentRemaining(world,t,fake)");const path=copy(run("tournamentChampionPath(t)"));
  assert.equal(path.length,3);assert.deepEqual(path.map(p=>p.round),['準々決勝','準決勝','決勝']);assert.equal(path[0].bye,true);
  assert.ok(path.slice(1).every(p=>p.opponent&&p.score==='6-0'));
  assert.equal(run("resolveTournamentRoute(world,'#/tournament/'+t.id+'/champion').type"),'champion');
  context.matchId=run("t.matches.find(m=>m.result).id");assert.equal(run("resolveTournamentRoute(world,'#/tournament/'+t.id+'/match/'+matchId).type"),'match');
  assert.equal(run("resolveTournamentRoute(world,'#/tournament/'+t.id+'/match/r9-m9')"),null);
});


function finishedRecords(count=5,seriesId='2017-1',name='大会') {
  progressWorld(count,{name});context.seriesId=seriesId;
  run("world.players.forEach(p=>p.cards[seriesId]=normalizeCard(p.cards['2017-1']));world.latestSeriesId=seriesId;t.seriesId=seriesId");
  context.recordMatch=options=>{const winner=options.a.player.id<options.b.player.id?'a':'b';return {winner,scoreText:(winner==='a'?'6-0':'0-6')+' RET',sets:[{a:winner==='a'?6:0,b:winner==='b'?6:0}],retired:winner==='a'?'b':'a',stats:{a:{aces:0},b:{aces:0}},points:[]};};
  run('playTournamentRemaining(world,t,recordMatch)');return copy(run('t'));
}

test("選手の大会成績は優勝・準優勝・通算勝敗を結果から集計し、BYEを除きRETを数える",()=>{
  const first=finishedRecords(5),second=finishedRecords(2,'2017-2');
  first.id='t_first1';first.createdAt='2026-10-07T00:00:00.000Z';second.id='t_second';second.createdAt='2026-10-06T00:00:00.000Z';
  const draft={...copy(first),id:'t_draft4',status:'draft',createdAt:'2026-10-08T00:00:00.000Z'};
  context.raw={version:2,players:drawPlayers(5),tournaments:[second,first,draft]};run('world=normalizeWorld(raw)');
  const champion=copy(run("playerTournamentRecords(world,'p_00001')"));
  assert.deepEqual([champion.titles,champion.runnerUps,champion.wins,champion.losses],[2,0,3,0]);
  assert.deepEqual(champion.tournaments.map(e=>e.tournament.id),['t_draft4','t_first1','t_second']);
  assert.deepEqual(champion.tournaments.map(e=>e.standing),['準備中','優勝','優勝']);
  const runner=copy(run("playerTournamentRecords(world,'p_00002')"));assert.deepEqual([runner.titles,runner.runnerUps,runner.wins,runner.losses],[0,2,1,2]);
  assert.deepEqual(runner.tournaments.filter(e=>e.tournament.status==='done').map(e=>e.standing),['準優勝','準優勝']);
  assert.deepEqual(copy(run("playerTournamentRecords(world,'p_missing')")),{titles:0,runnerUps:0,wins:0,losses:0,tournaments:[]});
  const all=drawPlayers(5).map(p=>{context.playerId=p.id;return copy(run('playerTournamentRecords(world,playerId)'));});
  assert.equal(all.reduce((total,r)=>total+r.wins,0),5);assert.equal(all.reduce((total,r)=>total+r.losses,0),5);
  run('world=normalizeWorld(JSON.parse(JSON.stringify(world)))');assert.deepEqual(copy(run("playerTournamentRecords(world,'p_00001')")),champion);
});

test("最終成績は優勝・準優勝・ベスト4〜64・1回戦敗退になり、開催中の未敗退選手は開催中となる",()=>{
  for(const count of [5,16,128]) {
    const tournament=finishedRecords(count);context.recorded=tournament;run('t=recorded');
    for(const match of tournament.matches.filter(m=>m.result)) {
      context.playerId=match[opposite(match.result.winner)];
      const remaining=tournament.slots.length/2**(match.round-1);
      const expected=remaining===2?'準優勝':match.round===1?'1回戦敗退':'ベスト'+remaining;
      assert.equal(run('tournamentStanding(t,playerId)'),expected);
    }
    assert.equal(run("tournamentStanding(t,'p_00001')"),'優勝');
  }
  progressWorld(5);run('playTournamentRound(world,t,1)');
  assert.equal(run("tournamentStanding(t,'p_00001')"),'開催中');
  const before=copy(run("playerTournamentRecords(world,'p_00001')"));assert.equal(before.titles,0);assert.equal(before.runnerUps,0);
  const first=copy(run('t.matches.find(m=>m.result)'));context.playerId=first[opposite(first.result.winner)];
  assert.equal(run('tournamentStanding(t,playerId)'),'1回戦敗退');
  const loser=copy(run('playerTournamentRecords(world,playerId)'));assert.equal(loser.losses,1);
});

test("同名の歴代優勝者は終了した大会だけをシリーズの新しい順にし、名前編集・削除に影響されない",()=>{
  const first=finishedRecords(2,'2017-1','同じ名前'),latest=finishedRecords(2,'2018-1','同じ名前'),middle=finishedRecords(2,'2017-2','同じ名前'),other=finishedRecords(2,'2019-1','別の名前');
  first.id='t_history1';latest.id='t_history2';middle.id='t_history3';other.id='t_other01';
  first.createdAt='2026-10-10T00:00:00Z';latest.createdAt='2026-10-01T00:00:00Z';
  const live={...copy(latest),id:'t_live004',status:'live',championId:null,matches:latest.matches.map(m=>({...m,status:'pending',result:null}))};
  const draft={...copy(latest),id:'t_draft5',status:'draft'};
  context.raw={version:2,players:drawPlayers(2),tournaments:[other,first,live,latest,draft,middle]};run('world=normalizeWorld(raw)');
  const history=copy(run("tournamentChampions(world,'同じ名前')"));assert.deepEqual(history.map(t=>t.id),['t_history2','t_history3','t_history1']);
  run("world.players[0].name='編集後';world.players.map(p=>p.id).forEach(id=>deleteWorldPlayer(world,id))");
  assert.deepEqual(copy(run("tournamentChampions(world,'同じ名前')")),history);
  assert.deepEqual(copy(run("tournamentChampions(world,'未知の名前')")),[]);
  assert.equal(run("isSeriesChampion(world,'p_00001','2017-1')"),true);assert.equal(run("isSeriesChampion(world,'p_00002','2017-1')"),false);
  assert.equal(run("isSeriesChampion(world,'p_00001','2019-2')"),false);
});

test("次シリーズの大会は設定を引き継ぎ、該当カードのある元出場選手だけを選び、元大会を変えない",()=>{
  const original=finishedRecords(5,'2017-2','引き継ぐ大会');original.surface='grass';original.format=3;original.finalFormat=5;original.theme='purple';
  context.raw={version:2,latestSeriesId:'2018-1',players:drawPlayers(6).map((p,i)=>({...p,cards:{...p.cards,...([0,2,5].includes(i)?{'2018-1':{stats:{power:99}}}:{})}})),tournaments:[original]};
  run('world=normalizeWorld(raw);t=world.tournaments[0]');const before=copy(run('t')),ui=copy(run('world.ui'));
  const next=copy(run('repeatWorldTournament(world,t)'));assert.notEqual(next.id,before.id);assert.equal(next.seriesId,'2018-1');assert.equal(next.status,'draft');
  for(const key of ['name','surface','format','finalFormat','theme'])assert.equal(next[key],before[key]);
  assert.deepEqual(next.entrants.map(e=>e.playerId).sort(),['p_00001','p_00003']);assert.deepEqual(next.snapshot,{});assert.deepEqual(next.fatigue,{});assert.equal(next.championId,null);assert.ok(next.matches.every(m=>m.result===null));
  assert.deepEqual(copy(run('t')),before);assert.deepEqual(copy(run('world.ui')),ui);assert.equal(run('world.tournaments.length'),2);
  run('world=importWorld(createEmptyWorld(),parseWorldImport(prepareWorldExport(world).text),"replace")');assert.deepEqual(copy(run('world.tournaments[1]')),next);
  assert.equal(run('repeatWorldTournament(world,world.tournaments[1])'),null);
});

test("次シリーズが未作成なら追加し、出場候補0・1人の準備中大会も保存して編集できる",()=>{
  const original=finishedRecords(2,'2017-2');
  for(const count of [0,1]) {
    context.raw={version:2,latestSeriesId:'2017-2',players:drawPlayers(2).map((p,i)=>({...p,cards:{...p.cards,...(i<count?{'2018-1':{}}:{})}})),tournaments:[original]};
    run('world=normalizeWorld(raw);t=world.tournaments[0]');
    // 正規化でカードのある期まで伸びるため、シリーズ追加自体は0人のケースで確認する。
    const next=copy(run('repeatWorldTournament(world,t)'));assert.equal(next.seriesId,'2018-1');assert.equal(next.entrants.length,count);assert.equal(next.status,'draft');
    assert.equal(run('world.latestSeriesId'),'2018-1');if(count===0)assert.equal(run('world.ui.seriesId'),'2018-1');
    assert.equal(run("resolveTournamentRoute(world,'#/tournament/'+world.tournaments[1].id+'/edit').type"),'edit');
    run('world=normalizeWorld(JSON.parse(JSON.stringify(world)))');assert.deepEqual(copy(run('world.tournaments[1]')),next);
  }
});
