"use strict";

// DOM・保存処理から独立した、seed 付きのポイント単位の試合エンジン。
(function (root, factory) {
  const definitions = typeof DATA !== "undefined" ? DATA : require("./data.js");
  const engine = factory(definitions);
  root.TennisMatch = engine;
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
})(globalThis, function (data) {
  const config = data.match;
  const keys = ["a", "b"];
  const statIds = [...data.stats.front, ...data.stats.back].map(item => item.id);
  const other = key => key === "a" ? "b" : "a";
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const has = (entry, id) => data.toggleGroups.some(group => entry.card[group]?.includes(id));
  const shotValue = (entry, id) => config.shots.levels[entry.card.shotSkills?.[id]] || 0;
  const rankValue = (entry, id) => config.abilities.ranks[entry.card.rankSkills?.[id]] || 0;
  const weightedStats = (stats, weights) => Object.entries(weights).reduce((sum, [id, weight]) => sum + stats[id] * weight, 0);
  const weightedShots = (entry, weights) => Object.entries(weights).reduce((sum, [id, weight]) => sum + shotValue(entry, id) * weight, 0);
  const formatText = (template, values) => template.replace(/\{(\w+)\}/g, (_, id) => values[id] ?? "");

  function random(seed) {
    const r = config.random;
    let value = seed >>> 0;
    return () => {
      value = (value + r.increment) >>> 0;
      let t = Math.imul(value ^ value >>> r.shiftA, value | 1);
      t ^= t + Math.imul(t ^ t >>> r.shiftB, t | r.mix);
      return ((t ^ t >>> r.shiftC) >>> 0) / r.divisor;
    };
  }

  function choose(items, rng) {
    let draw = rng() * items.reduce((sum, item) => sum + item.weight, 0);
    for (const item of items) {
      draw -= item.weight;
      if (draw < 0) return item.id;
    }
    return items[items.length - 1].id;
  }

  // 状態は読み取り専用。単体テストでも、各場面の補正を直接検算できる。
  function effectiveStats(entry, opponent, state, key, pressure = []) {
    const e = config.effective, a = config.abilities;
    const stats = Object.fromEntries(statIds.map(id => [id, entry.card.stats?.[id] ?? data.stats.initial]));
    const behindSets = state.setsWon[key] < state.setsWon[other(key)];
    const behindGames = state.games[other(key)] - state.games[key] >= a.adversityGames;
    let all = state.form[key] + (entry.card.surface === state.surface ? e.surface : 0);
    if (has(entry, "champion") && (state.setNumber === state.format || state.tiebreak)) all += a.champion;
    if (has(entry, "adversity") && (behindSets || behindGames)) all += a.adversity;
    if (state.setNumber === 1 && state.gameNumber <= e.earlyGames) {
      if (has(entry, "fast_start")) all += a.fast_start;
      if (has(entry, "slow_starter")) all += a.slow_starter;
    }
    if (has(entry, "short_temper") && state.lastGameWinner === other(key)) all += a.short_temper;
    if (has(entry, "quitter") && behindSets && behindGames) all += a.quitter;
    if (pressure.includes("break")) all += rankValue(entry, "clutch") * a.rankScale;
    if (opponent.player.hand === "left") all += rankValue(entry, "vs_left") * a.rankScale;
    statIds.forEach(id => { stats[id] += all; });
    if (has(entry, "precision")) stats.control += a.precision.control;
    if (has(entry, "gods_touch")) stats.net += a.gods_touch.net;
    if (has(entry, "idaten")) stats.speed += a.idaten.speed;
    if (!has(entry, "ironman")) {
      const fatigue = (e.fatigueCeiling - (entry.card.stats?.stamina ?? data.stats.initial)) * e.fatigue * (state.setNumber - 1);
      data.stats.front.forEach(item => { stats[item.id] -= fatigue; });
    }
    data.stats.front.forEach(item => { stats[item.id] -= entry.carryFatigue ?? 0; });
    if (pressure.length) {
      const bonus = (stats.mental - e.pressureCenter) * e.pressure;
      stats.control += bonus;
      stats.power += bonus;
    }
    statIds.forEach(id => { stats[id] = clamp(stats[id], e.min, e.max); });
    return stats;
  }

  function pointChances(server, receiver, serverStats, receiverStats, surface, pressure = [], net = false) {
    const p = config.point, a = config.abilities;
    const serve = config.serves[server.card.serve || data.initial.serve];
    const style = entry => entry.card.playStyle || data.initial.playStyle;
    const rally = (entry, opponent, stats) => weightedStats(stats, config.weights.rally)
      + config.styles[style(entry)][surface] + (config.matchups[style(entry)]?.[style(opponent)] || 0)
      + weightedShots(entry, config.shots.rally) + (has(entry, "rising") ? a.rising : 0) + (has(entry, "tenacious") ? a.tenacious : 0);
    const serveRating = weightedStats(serverStats, config.weights.serve) + serve.rating + (has(server, "bullet_serve") ? a.bullet_serve.serve : 0);
    const returnRating = weightedStats(receiverStats, config.weights.return) + weightedShots(receiver, config.shots.return)
      + (has(receiver, "high_point") && a.highServes.includes(server.card.serve) ? a.high_point : 0);
    const rallyDifference = net
      ? p.kNet * (weightedStats(serverStats, config.weights.net) + weightedShots(server, config.shots.net)
        - weightedStats(receiverStats, config.weights.pass) - weightedShots(receiver, config.shots.pass))
      : p.kRally * (rally(server, receiver, serverStats) - rally(receiver, server, receiverStats));
    return {
      firstIn: clamp(p.firstIn + (serverStats.control - p.center) * p.firstControl + serve.first + (has(server, "precision") ? a.precision.first : 0)),
      secondIn: clamp(p.secondIn + (serverStats.control - p.center) * p.secondControl + serve.second
        + (has(server, "double_fault") && pressure.length ? a.double_fault : 0)),
      ace: clamp(p.ace + (serverStats.power - p.center) * p.acePower + serve.ace + p.surfaceAce[surface]
        + (has(server, "bullet_serve") ? a.bullet_serve.ace : 0) - shotValue(receiver, "return") * config.shots.aceReturn),
      win: clamp(p.base[surface] + p.kServe * (serveRating - returnRating) + rallyDifference, p.min, p.max)
    };
  }

  function winsPointGame(points, key, target) {
    return points[key] + 1 >= target && points[key] + 1 - points[other(key)] >= config.rules.lead;
  }

  function pressures(state) {
    const result = { a: [], b: [] }, rules = config.rules;
    if (state.tiebreak) keys.forEach(key => result[key].push("tiebreak"));
    keys.forEach(key => {
      const gamePoint = winsPointGame(state.points, key, state.tiebreak ? rules.tiebreakPoints : rules.gamePoints);
      if (!gamePoint) return;
      if (!state.tiebreak && key !== state.server) result[key].push("break");
      if (state.tiebreak || (state.games[key] + 1 >= rules.setGames && state.games[key] + 1 - state.games[other(key)] >= rules.lead)) {
        result[key].push("set");
        if (state.setsWon[key] + 1 > state.format / rules.lead) result[key].push("match");
      }
    });
    return result;
  }

  function pointLabels(points, tiebreak) {
    if (tiebreak) return { ...points };
    const r = config.rules;
    if (points.a >= r.gamePoints - 1 && points.b >= r.gamePoints - 1) {
      return Object.fromEntries(keys.map(key => [key, points[key] > points[other(key)] ? r.advantage : r.pointLabels[r.gamePoints - 1]]));
    }
    return Object.fromEntries(keys.map(key => [key, r.pointLabels[Math.min(points[key], r.gamePoints - 1)]]));
  }

  function finishPoint(serverKey, entries, stats, firstIn, pressure, state, rng) {
    const receiverKey = other(serverKey), p = config.point;
    let net = false;
    const chances = pointChances(entries[serverKey], entries[receiverKey], stats[serverKey], stats[receiverKey], state.surface, pressure);
    if (!firstIn && rng() >= chances.secondIn) return { winner: receiverKey, kind: "doubleFault", net, chances };
    if (rng() < chances.ace * (firstIn ? 1 : p.secondAce)) return { winner: serverKey, kind: "ace", net, chances };
    net = firstIn && entries[serverKey].card.playStyle === "serve_volley" && rng() < p.netChance;
    const probability = net ? pointChances(entries[serverKey], entries[receiverKey], stats[serverKey], stats[receiverKey], state.surface, pressure, true).win : chances.win;
    const winner = rng() < clamp(probability - (firstIn ? 0 : p.secondPenalty), p.min, p.max) ? serverKey : receiverKey;
    if (net) return { winner, kind: winner === serverKey ? "net" : "pass", net, chances };
    const kinds = [winner === serverKey ? "serviceWinner" : "returnAce", "winner", "error"];
    const entry = entries[winner], winnerStats = stats[winner];
    const kind = choose(kinds.map(id => {
      const weights = config.finishes[id];
      return { id, weight: weights.base + winnerStats[weights.stat] * weights.scale + (weights.styles[entry.card.playStyle] || 0) };
    }), rng);
    return { winner, kind, net, chances };
  }

  function selectShot(kind, entry, rng) {
    if (["ace", "doubleFault", "serviceWinner"].includes(kind)) return entry.card.serve || data.initial.serve;
    const s = config.shots;
    const candidates = kind === "net" ? s.netShots : kind === "pass" ? s.passShots : kind === "returnAce" ? s.returnShots : Object.keys(s.selection);
    return choose(candidates.map(id => ({ id, weight: Math.max(s.selectionMin, (s.selection[id] || 1)
      * (s.selectionBase + shotValue(entry, id) * s.selectionScale) + (s.styleSelection[entry.card.playStyle]?.[id] || 0)) })), rng);
  }

  function initialStats() {
    return { pointsWon: 0, aces: 0, doubleFaults: 0, servicePoints: 0, servicePointsWon: 0,
      firstServesIn: 0, firstServePointsWon: 0, secondServes: 0, secondServePointsWon: 0,
      breakPointsWon: 0, breakPointOpportunities: 0, winners: 0, errors: 0, netPointsWon: 0, netPoints: 0 };
  }

  function simulate(options) {
    const rules = config.rules;
    if (!options?.a?.player || !options?.a?.card || !options?.b?.player || !options?.b?.card) throw new Error(config.errors.options);
    const format = options.format ?? rules.initialFormat, surface = options.surface ?? rules.initialSurface;
    const firstServer = options.firstServer ?? rules.initialServer;
    if (!rules.formats.includes(format) || !data.basic.surface.some(item => item.id === surface) || !["random", ...keys].includes(firstServer)) throw new Error(config.errors.options);
    if (options.seed !== undefined && !Number.isFinite(options.seed)) throw new Error(config.errors.seed);
    if ((options.injury !== undefined && typeof options.injury !== "boolean")
      || keys.some(key => options[key].carryFatigue !== undefined
        && (!Number.isFinite(options[key].carryFatigue) || options[key].carryFatigue < 0))) throw new Error(data.tournament.errors.options);
    let seed = options.seed;
    if (seed === undefined) {
      const bytes = new Uint32Array(1);
      if (globalThis.crypto?.getRandomValues) seed = globalThis.crypto.getRandomValues(bytes)[0];
      else seed = (Date.now() ^ Math.floor(Math.random() * config.random.divisor)) >>> 0;
    }
    seed >>>= 0;
    const rng = random(seed), entries = { a: options.a, b: options.b };
    const names = Object.fromEntries(keys.map(key => [key, entries[key].player.name || data.text.anonymous]));
    const state = { format, surface, setNumber: 1, gameNumber: 1, games: { a: 0, b: 0 }, points: { a: 0, b: 0 },
      setsWon: { a: 0, b: 0 }, form: {}, tiebreak: false, lastGameWinner: null,
      server: firstServer === "random" ? keys[Math.floor(rng() * keys.length)] : firstServer };
    keys.forEach(key => {
      const range = config.effective.formRange * (has(entries[key], "streaky") ? config.effective.streakyMultiplier : 1);
      state.form[key] = rng() * range * config.rules.lead - range;
    });
    const result = { winner: null, sets: [], scoreText: "", points: [], log: [], stats: { a: initialStats(), b: initialStats() }, seed, retired: null };
    let tiebreakServer = null;
    let previousTemplate = null, deuces = 0;
    const line = (type, text, pointIndex) => result.log.push({ type, text, pointIndex });
    // 最初のポイントより前に表示する開始行。
    line("start", formatText(config.lines.start, { name: names[state.server] }), -1);
    while (!result.winner) {
      const server = state.server, receiver = other(server), index = result.points.length;
      const pressureByPlayer = pressures(state), pressure = [...new Set(keys.flatMap(key => pressureByPlayer[key]))];
      const priority = config.pressurePriority.find(id => pressure.includes(id));
      if (priority) {
        const key = keys.find(key => pressureByPlayer[key].includes(priority));
        line("pressure", formatText(config.lines.pressure, { name: names[key], pressure: config.pressure[priority] }), index);
      } else if (!state.tiebreak && keys.every(key => state.points[key] >= rules.gamePoints - 1)) {
        if (state.points.a === state.points.b) {
          line("score", deuces++ ? config.lines.deuceAgain : config.lines.deuce, index);
        } else {
          const key = state.points.a > state.points.b ? "a" : "b";
          line("score", formatText(config.lines.advantage, { name: names[key] }), index);
        }
      }
      const effective = Object.fromEntries(keys.map(key => [key, effectiveStats(entries[key], entries[other(key)], state, key, pressure)]));
      const chances = pointChances(entries[server], entries[receiver], effective[server], effective[receiver], surface, pressure);
      const firstIn = rng() < chances.firstIn;
      const finish = finishPoint(server, entries, effective, firstIn, pressure, state, rng);
      const winner = finish.winner, loser = other(winner);
      const shotEntry = entries[finish.kind === "doubleFault" ? server : finish.kind === "error" ? loser : winner];
      const shot = selectShot(finish.kind, shotEntry, rng);
      const shotName = data.shotSkills.items.find(item => item.id === shot)?.name || data.serves.find(item => item.id === shot)?.name;
      const serveName = data.serves.find(item => item.id === (entries[server].card.serve || data.initial.serve)).name;
      const templates = config.commentary[finish.kind].filter(template => template !== previousTemplate);
      previousTemplate = templates[Math.floor(rng() * templates.length)];
      line("point", formatText(previousTemplate, { name: names[winner], opponent: names[loser], shot: shotName, serve: serveName }), index);
      const ss = result.stats[server], rs = result.stats[receiver];
      ss.servicePoints++;
      if (firstIn) ss.firstServesIn++; else ss.secondServes++;
      result.stats[winner].pointsWon++;
      if (winner === server) { ss.servicePointsWon++; if (firstIn) ss.firstServePointsWon++; else ss.secondServePointsWon++; }
      if (finish.kind === "ace") ss.aces++;
      if (finish.kind === "doubleFault") ss.doubleFaults++;
      if (["doubleFault", "error"].includes(finish.kind)) result.stats[loser].errors++; else result.stats[winner].winners++;
      const breakPoint = pressureByPlayer[receiver].includes("break");
      if (breakPoint) rs.breakPointOpportunities++;
      if (finish.net) { keys.forEach(key => result.stats[key].netPoints++); result.stats[winner].netPointsWon++; }
      state.points[winner]++;
      const target = state.tiebreak ? rules.tiebreakPoints : rules.gamePoints;
      const gameEnd = state.points[winner] >= target && state.points[winner] - state.points[loser] >= rules.lead;
      const wasTiebreak = state.tiebreak;
      let setEnd = false;
      if (gameEnd) {
        state.games[winner]++;
        state.lastGameWinner = winner;
        if (breakPoint && winner === receiver) rs.breakPointsWon++;
        const leader = state.games.a > state.games.b ? "a" : "b";
        const score = state.games.a === state.games.b
          ? formatText(config.lines.gameTie, { games: state.games.a })
          : formatText(config.lines.gameLead, { name: names[leader], lead: state.games[leader], behind: state.games[other(leader)] });
        setEnd = wasTiebreak || (state.games[winner] >= rules.setGames && state.games[winner] - state.games[loser] >= rules.lead);
        line("game", formatText(setEnd ? config.lines.gameFinishedSet : config.lines.game, { name: names[winner], score }), index);
        if (setEnd) {
          const set = { ...state.games };
          if (wasTiebreak) set.tiebreak = { ...state.points };
          result.sets.push(set);
          state.setsWon[winner]++;
          line("set", formatText(config.lines.set, { name: names[winner], set: state.setNumber, won: set[winner], lost: set[loser] }), index);
          if (state.setsWon[winner] > format / rules.lead) {
            result.winner = winner;
            line("match", formatText(config.lines.match, { name: names[winner] }), index);
          }
        }
        // 試合が続くゲームの終了時だけ抽選し、通常対戦の乱数列は変えない。
        if (options.injury && !result.winner) {
          const injury = data.tournament.injury;
          const injured = keys.filter(key => {
            const rank = entries[key].card.rankSkills?.durability || data.rankSkills.initial;
            const multiplier = injury.durability[rank] ?? injury.durability[data.rankSkills.initial];
            return rng() < injury.base * multiplier * (1 + (entries[key].carryFatigue ?? 0) * injury.fatigueScale);
          });
          if (injured.length) {
            result.retired = injured[0];
            result.winner = other(result.retired);
            if (!setEnd) result.sets.push({ ...state.games });
            line("match", formatText(data.tournament.lines.retirement, { name: names[result.retired], winner: names[result.winner] }), index);
          }
        }
      }
      result.points.push({ set: state.setNumber, game: state.gameNumber, server, winner, kind: finish.kind, shot, pressure,
        firstServeIn: firstIn, serveNumber: firstIn ? 1 : 2, net: finish.net, tiebreak: wasTiebreak,
        gameEnd, setEnd, matchEnd: Boolean(result.winner),
        // points は終了したゲームの実数を記録し、表示用は次のゲームの0-0に戻す。
        score: { sets: { ...state.setsWon }, games: { ...state.games }, points: { ...state.points },
          pointText: pointLabels(gameEnd && !wasTiebreak ? { a: 0, b: 0 } : state.points, wasTiebreak) } });
      if (gameEnd) {
        deuces = 0;
        state.points = { a: 0, b: 0 };
        state.server = wasTiebreak ? other(tiebreakServer) : other(server);
        if (setEnd) { state.setNumber++; state.gameNumber = 1; state.games = { a: 0, b: 0 }; state.tiebreak = false; }
        else {
          state.gameNumber++;
          if (state.games.a === rules.setGames && state.games.b === rules.setGames) { state.tiebreak = true; tiebreakServer = state.server; }
        }
      } else if (wasTiebreak) {
        const played = state.points.a + state.points.b;
        state.server = Math.floor((played + 1) / rules.lead) % rules.lead === 1 ? other(tiebreakServer) : tiebreakServer;
      }
    }
    result.scoreText = result.sets.map(set => `${set.a}-${set.b}${set.tiebreak ? `(${Math.min(set.tiebreak.a, set.tiebreak.b)})` : ""}`).join(" ");
    if (result.retired) result.scoreText += " " + data.tournament.retirementMark;
    keys.forEach(key => {
      const stats = result.stats[key];
      stats.firstServeRate = stats.servicePoints ? stats.firstServesIn / stats.servicePoints : 0;
      stats.firstServeWinRate = stats.firstServesIn ? stats.firstServePointsWon / stats.firstServesIn : 0;
      stats.secondServeWinRate = stats.secondServes ? stats.secondServePointsWon / stats.secondServes : 0;
    });
    return result;
  }

  return { simulate, effectiveStats, pointChances };
});
