'use strict';

const Q = new URLSearchParams(location.search);
const debug = Q.get('debug') === '1';
const param = key => debug ? Q.get(key) : null;
const keyPrefix = 'zhirisheng.melon.phase2.v1.';
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const round = v => Math.round(v * 100) / 100;
const T = D.draft;
const MS = 86400000;
let state,
  storageOK = true;
function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(keyPrefix + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, obj) {
  try {
    localStorage.setItem(keyPrefix + key, JSON.stringify(obj));
  } catch {
    storageOK = false;
  }
}
function persist() {
  save('game', state);
}
function dice(label) {
  // 同一局、同回合、同一判定共用亂數，重來不重抽
  let h = 2166136261;
  for (const ch of state.seed + '|' + state.round + '|' + label) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  }
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b);
  h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function choose(list, label) {
  return list[Math.floor(dice(label) * list.length)];
}
function forced(list, key) {
  return list.findIndex(x => x.id === param(key) || x.name === param(key));
}
function log(code, why, details = {}) {
  state.log.push({
    turn: state.round,
    code,
    why,
    ...details
  });
}
function money(amount, label, category) {
  if (!amount) return;
  state.coins += amount;
  state.ledger.push({
    turn: state.round,
    label,
    category,
    amount
  });
  log('G-1', label, {
    amount,
    balance: state.coins
  });
}
function expense(n, label) {
  if (n > state.coins) throw Error(D.copy.notEnough);
  money(-n, label, 'expense');
}
function checkpoint() {
  const {
    snapshot,
    ...rest
  } = state;
  state.snapshot = clone(rest);
}
function rewind() {
  if (state.used || !state.snapshot) return;
  state = {
    ...clone(state.snapshot),
    used: true
  };
  delete state.snapshot;
  log('重來', '已回到致敗步驟前');
  persist();
}
function season() {
  return D.seasons[state.season];
}
function cultivar() {
  return D.cultivars[state.actual];
}
function soil() {
  return D.soil[state.soil];
}
function dateAt(days) {
  return new Date(state.plant + days * MS).toISOString().slice(0, 10);
}
function age(turn) {
  if (season().id === 'early_spring' && turn >= 2) {
    const flower = state.days - 50;
    return Math.round(flower + (turn - 2) * (state.days - flower) / (D.rounds.count - 2));
  }
  return Math.round(state.days * turn / D.rounds.count);
}
function fresh(seed) {
  state = {
    version: 1,
    seed: String(seed ?? param('seed') ?? Date.now() + '-' + Math.random()),
    id: Date.now() + '-' + Math.random(),
    round: 0,
    step: 'season',
    log: [],
    ledger: [],
    coins: D.budget,
    used: false,
    counts: {},
    flags: {},
    stats: {},
    fruit: null,
    decisions: [],
    selection: {},
    history: [],
    pending: [],
    feedback: []
  };
  const idx = forced(D.seasons, 'season');
  state.season = idx < 0 ? Math.floor(dice('season') * D.seasons.length) : idx;
  const s = season(),
    year = new Date().getFullYear();
  const a = Date.parse(year + '-' + s.start + 'T00:00Z'),
    b = Date.parse(year + (s.end < s.start ? 1 : 0) + '-' + s.end + 'T00:00Z');
  const span = (b - a) / MS,
    offset = Math.floor(dice('date') * (span + 1));
  state.plant = a + MS * offset;
  const interp = range => range[0] + ((range[1] ?? range[0]) - range[0]) * (span ? offset / span : 0);
  state.days = Math.round(interp(s.days));
  state.seasonCap = round(interp(s.cap));
  let roll = dice('soil'),
    si = D.soil.findIndex(o => (roll -= o.chance) < 0);
  const fix = forced(D.soil, 'soil');
  state.soil = fix >= 0 ? fix : Math.max(0, si);
  state.fertility = Math.floor(dice('fertility') * T.meter.length);
  state.wetSoil = s.risk[4] === '高' && dice('wet soil') < D.soilRules.wet;
  state.flags.warm = s.id === 'deep_winter' && dice('warm') < D.special.warm;
  log('季節', s.name, {
    plant: dateAt(0),
    harvest: dateAt(state.days)
  });
  persist();
}
function beginCultivar(index) {
  state.chosen = index;
  state.actual = index;
  const online = D.cultivars[index].id === 'online';
  if (online) {
    const r = dice('branch');
    state.branch = ['melon', 'weed', 'other'].includes(param('branch')) ? param('branch') : r < D.seed.melon ? 'melon' : r < D.seed.melon + D.seed.weed ? 'weed' : 'other';
    if (state.branch === 'melon') state.actual = Math.floor(dice('identity') * D.cultivars.length);
    if (state.branch === 'weed') state.odd = choose(D.weeds, 'weed');
    if (state.branch === 'other') state.odd = choose(D.otherCrops, 'other');
  }
  const c = cultivar(),
    p = D.pairEffects.find(p => p[0] === c.pair[state.season]);
  state.pair = p;
  state.vmax = D.levels[c.levels[5]];
  state.stats = {
    vigor: clamp(state.vmax * D.plant.initialVigor + p[2], 0, state.vmax),
    root: D.plant.root,
    leaves: D.plant.leaves[0],
    leaf: 1,
    pests: p[3],
    disease: p[4],
    virus: 0,
    count: 0
  };
  state.flags.pairFail = dice('pair failure') < p[5];
  state.step = online ? 'nursery' : 'soil';
  state.form = {};
  checkpoint();
  persist();
}
function delta(code, reason, changes) {
  for (const [k, n] of Object.entries(changes)) {
    const a = Object.hasOwn(state.stats, k) ? state.stats : state.fruit;
    if (!a || !(k in a)) continue;
    const levelIndex = {
      size: 4,
      net: 3,
      ridge: 3,
      flavor: 1,
      texture: 2
    }[k];
    const max = levelIndex !== undefined ? D.levels[cultivar().levels[levelIndex]] : k === 'vigor' ? state.vmax : k === 'sweet' ? D.brix[cultivar().levels[0]] : k === 'leaf' ? D.plant.leafRange[1] : 100;
    const before = a[k];
    a[k] = round(clamp(before + n, k === 'leaf' ? D.plant.leafRange[0] : 0, max));
    if (before !== a[k]) log(code, reason, {
      stat: D.labels[k],
      before,
      after: a[k],
      delta: round(a[k] - before)
    });
  }
}
function terminal(reason, lesson) {
  if (state.step === 'result') return;
  state.fail = reason;
  state.lesson = lesson || D.failures[reason][1];
  state.step = 'result';
  log('失收', D.failures[reason][0]);
  recordResult();
}
function health() {
  if (state.stats.root <= 0) terminal('wilt');else if (state.stats.vigor <= 0) terminal('vigor');
  return state.step !== 'result';
}
function nurseryPrice(f) {
  return D.nursery[f.medium].cost * D.seed.tray[f.tray] + D.nursery[4 + f.tray].cost + (f.fungus ? D.nursery[8].cost : 0) + (f.heat ? D.nursery[9].cost : 0);
}
function sow(f) {
  checkpoint();
  expense(nurseryPrice(f), '育苗土、穴盤與加購');
  delta('W-S' + (f.medium + 1), '育苗介質', {
    root: D.seed.soilRoot[f.medium],
    disease: f.medium === 3 ? D.seed.badDisease : 0
  });
  delta('W-T' + (f.tray + 1), '穴盤', {
    root: D.seed.trayRoot[f.tray]
  });
  if (f.fungus) delta('W-M1', '菌根菌', {
    root: D.seed.fungus
  });
  if (f.medium === 3 && dice('germination') < D.seed.badSoil) return terminal('seed', D.nursery[3].lesson);
  if (D.coldSeasons.includes(season().id) && !f.heat && dice('cold seed') < D.seed.cold[Number(season().id === 'deep_winter')]) return terminal('seed', D.nursery[9].lesson);
  if (state.branch === 'weed') return terminal('weed');
  state.step = 'soil';
  state.form = {};
}
function soilTest(test) {
  state.test = test;
  if (test) expense(D.cost.test, '土壤檢驗');
  state.step = 'amend';
  state.form = {
    improve: []
  };
}
function report() {
  const [p, e, o] = T.testNormal,
    v = T.testSpecial;
  return [state.soil === 0 ? v[0] : state.soil === 5 ? v[3] : p, state.soil === 1 ? v[1] : state.soil === 2 ? v[2] : e, state.soil === 7 ? v[4] : o];
}
function soilCost(f) {
  return (f.improve || []).reduce((n, i) => n + D.improvements[i].cost, 0) + (f.clean ? D.cost.clean : 0) + (f.ridge ? D.cost.ridge : 0) + (f.wait && state.wetSoil ? D.cost.wait : 0);
}
function amend(f) {
  checkpoint();
  const picked = f.improve || [],
    cancel = picked.includes(0) && picked.includes(1);
  let factor = 1,
    good = [],
    bad = [],
    worse = 1;
  state.flags.compost = picked.includes(3);
  state.flags.ridge = !!f.ridge;
  state.flags.clean = !!f.clean;
  state.flags.hardWet = state.wetSoil && !f.wait;
  for (const i of picked) {
    const item = D.improvements[i],
      ref = '第3關整地!' + 'CEFGIDHJ'[state.soil] + (i + 29);
    expense(item.cost, item.name);
    if (cancel && i < 2) {
      log(ref, '石灰與硫磺抵銷');
      continue;
    }
    const effect = item.effects[state.soil];
    log(ref, effect);
    if (effect.includes('解除')) factor = 0;else if (effect.includes('減半')) factor = Math.min(factor, .5);
    if (effect.includes('加倍')) worse = 2;
    for (const m of effect.matchAll(/(根系|樹勢|蟲害壓力) ([+−-])(\d+)/g)) {
      const val = Number(m[3]) * (m[2] === '+' ? 1 : -1);
      (val > 0 ? good : bad).push([{
        '根系': 'root',
        '樹勢': 'vigor',
        '蟲害壓力': 'pests'
      }[m[1]], val, ref]);
    }
  }
  const rates = D.soilRules.benefit,
    applied = {};
  for (const [k, n, ref] of good.sort((a, b) => b[1] - a[1])) {
    let rank = applied[k] || 0;
    delta(ref, '改良土況', {
      [k]: n * rates[Math.min(rank, rates.length - 1)]
    });
    applied[k] = rank + 1;
  }
  for (const [k, n, ref] of bad) delta(ref, '改良選擇', {
    [k]: n
  });
  state.soilFactor = factor * worse;
  delta(soil().id, '土況剩餘影響', Object.fromEntries(Object.entries(soil().base).map(([k, n]) => [k, n * state.soilFactor])));
  if (f.clean) {
    expense(D.cost.clean, '清園浸水');
    delta('3-D', '清園', {
      pests: D.soilRules.cleanPests
    });
  }
  if (f.ridge) expense(D.cost.ridge, '高畦、開排水溝');
  if (state.wetSoil) {
    if (f.wait) expense(D.cost.wait, '等土乾');else delta('3-L1', '趁濕整地', {
      root: D.soilRules.wetRoot
    });
  }
  if (health()) {
    state.step = 'loosen';
    state.form = {};
  }
}
function meter() {
  let center = T.meter[state.fertility] + (cultivar().levels[5] === 5 ? -T.vigorShift : cultivar().levels[5] === 2 ? T.vigorShift : 0);
  let width = D.base.width[cultivar().levels[7] - 1];
  if (cultivar().id === 'ruby' && hasOverride(10)) width *= T.other.glassWidth;
  return [center - width / 2, center + width / 2];
}
function basePrice(i) {
  return i === 0 && state.flags.compost ? D.cost.compost : D.fertilizers[i].cost;
}
function omitFert() {
  checkpoint();
  state.flags.base = '太少';
  state.flags.shortStem = dice('short stem') < D.base.shortStem;
  delta('4-R1', '本季未施基肥', {
    leaf: D.base.small - 1
  });
  state.feedback = ['這季未施基肥。'];
  if (health()) newRound();
}
function applyFert(i, position) {
  checkpoint();
  const f = D.fertilizers[i],
    b = D.base,
    price = basePrice(i);
  expense(price, f.name);
  if (i === 0) delta(f.id, f.name, {
    root: b.compost
  });
  if (i === 2) delta(f.id, f.name, {
    root: b.chemical
  });
  if (i === 1) {
    state.flags.burnRemaining = -b.burnRoot;
    delta(f.id, f.name, {
      root: b.burnRoot,
      leaves: b.leafLoss,
      vigor: b.burnVigor
    });
    state.flags.leafOffset = (state.flags.leafOffset || 0) + b.leafLoss;
    if (dice('chicken burn') < b.burnRisk) return terminal('burn', f.lesson);
  }
  const [lo, hi] = meter(),
    risk = position >= 1,
    range = position < lo ? '太少' : position <= hi ? '適量' : risk ? '嚴重過量' : '過量';
  state.flags.base = range;
  log('4-G2', range, {
    position,
    lo,
    hi
  });
  if (range === '適量') delta('4-R2', range, b.ideal);else if (range === '太少') {
    money(Math.min(D.cost.refund, price), '用量較少退費', 'refund');
    delta('4-R1', range, {
      leaf: b.small - 1
    });
    state.flags.shortStem = dice('short stem') < b.shortStem;
  } else {
    delta('4-R3', range, b.over);
    expense(Math.min(state.coins, risk ? D.cost.full : D.cost.extra), '超量肥料');
    if (i === 2) delta('4-C', '化肥鹽傷', {
      root: b.salt
    });
    if (D.coldSeasons.includes(season().id)) {
      state.flags.leafOffset = (state.flags.leafOffset || 0) + b.leafLoss;
      delta('4-L4', '低溫時過量', {
        leaves: b.leafLoss
      });
    }
    if (risk) {
      delta('4-R4', range, {
        root: b.severeRoot
      });
      if (dice('severe burn') < b.severeRisk) delta('4-R4', '肥傷', {
        root: T.other.overBurn
      });
    }
  }
  state.feedback = ['基肥用量：' + range];
  if (range !== '適量') checkGlass();
  if (state.step !== 'result' && health()) newRound();
}
function hasOverride(index) {
  const r = D.overrides[index];
  if (!r || !r.names.includes(cultivar().name)) return false;
  const id = season().id,
    mmdd = dateAt(0).slice(5),
    harvest = dateAt(state.days).slice(5);
  if (index === 9 || index === 16) return true;
  if (index === 10) return mmdd >= '02-22' && mmdd <= '09-18';
  if (index === 11) return id === 'deep_winter';
  if (index >= 12 && index <= 14) return id === 'summer' || harvest >= '06-01' && harvest <= '08-31';
  if (index === 15) return harvest <= '05-31' || harvest >= '11-12' && harvest <= '11-18';
  return id === ['summer', 'winter', 'summer', 'winter', 'early_spring', 'winter', 'winter', 'early_spring', 'late_spring'][index];
}
function draw() {
  let pool = [],
    seen = state.counts;
  state.odds = {};
  for (const [id, name, risk] of D.events) {
    let p = D.risk[season().risk[risk]];
    if (risk === 6) p *= T.resistance[cultivar().levels[6] - 1];
    if (id === 'weed' && state.flags.clean) p *= T.cleanFactor;
    p = (seen[id] || 0) >= D.rounds.repeat ? 0 : clamp(p, 0, 1);
    state.odds[id] = round(p);
    if (dice('入池' + id) < p) pool.push(id);
  }
  for (const job of D.jobs) {
    let p = (seen[job.id] || 0) >= D.rounds.jobLimit ? 0 : T.jobEntry;
    state.odds[job.id] = p;
    if (dice('入池' + job.id) < p) pool.push(job.id);
  }
  pool.sort((a, b) => dice('抽' + a) - dice('抽' + b));
  state.cards = pool.slice(0, D.rounds.cards);
  for (const id of state.cards) seen[id] = (seen[id] || 0) + 1;
  while (state.cards.length < D.rounds.cards) state.cards.push('obs' + state.cards.length);
  log('第06題', '本回合抽卡', {
    odds: {
      ...state.odds
    },
    pool,
    cards: [...state.cards]
  });
}
function stageIndex() {
  return Math.min(D.work.length - 1, Math.floor((state.round - 1) * D.work.length / D.rounds.count));
}
function newRound() {
  state.round++;
  state.step = 'round';
  state.selection = {};
  state.form = {};
  state.jobResults = {};
  draw();
  checkpoint();
}
function initFruit() {
  const l = cultivar().levels;
  state.fruit = {
    size: D.levels[l[4]],
    shape: 100,
    net: D.levels[l[3]],
    ridge: D.levels[l[3]],
    sweet: D.brix[l[0]],
    flavor: D.levels[l[1]],
    texture: D.levels[l[2]],
    flesh: 100,
    stem: state.flags.shortStem ? 0 : 1
  };
  state.stats.count = 1;
  if (['過量', '嚴重過量'].includes(state.flags.base)) delta('4-R3', '基肥過量', {
    sweet: -D.base.sweetLoss
  });
  D.overrides.forEach((row, i) => {
    if (!hasOverride(i)) return;
    log('品種×季節!K' + (4 + i), row.rule);
    const scale = T.other;
    if (i >= 12 && i <= 14 && dice('hot trait') >= scale.hotChance - (state.flags.good || 0) * scale.careReduction) return;
    const keys = ['vigor', 'size', 'net', 'ridge', 'flesh', 'sweet', 'flavor', 'texture'];
    row.levels.forEach((word, j) => {
      const k = keys[j],
        v = (k === 'vigor' ? state.stats : state.fruit)[k];
      let mul = {
        '差': scale.poorQuality,
        '很差': scale.veryPoor,
        '偏小': scale.smallSize,
        '長不大': scale.veryPoor,
        '偏大': scale.bigSize,
        '太大': scale.bigSize,
        '很好': 1,
        '好': 1
      }[word];
      if (mul !== undefined) delta('品種×季節!' + 'CDEFGHIJ'[j] + (4 + i), row.period, {
        [k]: v * (mul - 1)
      });
    });
    if (i === 1 && dice('no net') < T.netLoss) delta('品種×季節!K5', '未裂出網紋', {
      net: -100,
      ridge: -100
    });
    if (i === 15) {
      delta('品種×季節!K19', '採收時涼爽', {
        net: 100,
        ridge: 100
      });
    }
  });
}
function applyWork(keys, skipped) {
  let i = stageIndex(),
    s = state.stats,
    f = state.flags,
    e = T.effects,
    has = k => keys.includes(k),
    code = '固定工作' + (i + 1);
  if (skipped) log('第11題', '略過' + D.work[i][0]);
  for (const k of keys) {
    if (e[k] && !['skipFeed', 'lowNode', 'highNode'].includes(k)) delta(code, D.work[i][0], e[k]);
  }
  if (i === 0) {
    f.double = has('double') || has('tangle');
    f.dirty = has('dirtyTool');
    if (f.dirty) delta('P-7', '剪刀沒消毒', {
      virus: D.infection.dirty[0]
    });
  }
  if (i <= 3) {
    let base = f.double ? D.plant.double : D.plant.leaves[i + 1];
    delta('P-3a', '葉片生長', {
      leaves: base + (f.leafOffset || 0) - s.leaves
    });
  }
  if (i === 1) {
    let prob = has('hand') ? T.set[0] : has('bee') ? T.set[1] : T.set[2];
    if (!has('none')) prob -= Number(['過量', '嚴重過量'].includes(f.base)) * D.base.setLoss + Number(f.hot) * T.other.heatSet + Number(!has('midNode')) * T.other.wrongNode + Number(s.leaf > D.plant.large) * T.other.softLeafSet;
    log('第13題', '著果判定', {
      prob
    });
    if (dice('fruit set') >= prob) return terminal('set');
    state.poll = dateAt(age(state.round));
    initFruit();
    if (has('lowNode') || has('highNode')) delta(code, '留果節位', has('lowNode') ? e.lowNode : e.highNode);
    if (has('none')) f.lucky = true;
    if (state.branch === 'other') {
      f.revealed = true;
      state.feedback.push('開花結果才發現，是' + state.odd[0] + '！' + state.odd[1]);
    }
  }
  if (i === 2) {
    s.count = has('three') ? 3 : has('two') ? 2 : 1;
    delta('P-6', '多留果的固定大小扣幅', {
      size: state.fruit.size * (D.multi.size[s.count - 1] - 1)
    });
  }
  if (i === 3) {
    if (f.dirty) delta('P-7', '摘心時剪刀沒消毒', {
      virus: D.infection.dirty[1]
    });
    if (has('strip')) state.fruit.stem = 0;
    if (has('untied') && dice('untied') < T.breakRate[state.actual]) return terminal('snap');
  }
  if (i === 4 && has('skipFeed')) {
    const mul = f.base === '太少' ? 2 : 1;
    delta('4-R1', '未追肥', {
      vigor: e.skipFeed.vigor * mul,
      leaf: e.skipFeed.leaf * mul
    });
  }
  if (i === 5) {
    if (!has('even')) delta('第6回', '膨大期水量', has('dry') ? e.dry6 : e.wet6);else if ([1, 2].includes(state.soil) && state.soilFactor && dice('salt water') < T.other.saltWet * state.soilFactor) delta(soil().id, '鹽分影響吸水', e.dry6);
  }
  if ((i === 5 || i === 6 || i === 7) && cultivar().id === 'glass' && !has('even')) {
    checkGlass();
    if (state.step === 'result') return;
  }
  if (i === 6 || i === 7) {
    if (has('dry')) delta('F-3', '網紋期偏乾', e.dryNet);
    if (has('wet')) {
      delta('F-3', '網紋期偏濕', e.wetNet);
      f.wet = (f.wet || 0) + T.other.wetUnits;
      if (f.wet >= T.wetLimit) return terminal('crack');
    }
  }
  if (i === 9 && has('early')) delta('品種影響!C9', '早採風味按品種上限調整', {
    flavor: -e.early.flavor * (1 - D.levels[cultivar().levels[1]] / 100)
  });
  if (i === 8 && has('normal') && dice('late crack') < T.lateCrack) return terminal('crack');
  if (i === 9) state.cut = dateAt(state.days + (has('early') ? -T.harvestShift : has('late') ? T.harvestShift : 0));
  const careful = !skipped && !keys.some(k => ['double', 'dirtyTool', 'keepBud', 'lowNode', 'highNode', 'none', 'scar', 'two', 'three', 'grow', 'strip', 'untied', 'nitrogen', 'skipFeed', 'dry', 'wet', 'normal', 'stop', 'early', 'late', 'tangle'].includes(k));
  if (careful) {
    f.good = (f.good || 0) + 1;
    if (i < 2) delta('P-2', '結果前照顧得當', {
      root: D.plant.rootGain[Number(cultivar().levels[7] >= D.soilGame.hardLevel)]
    });
  } else checkGlass();
}
function checkGlass() {
  if (cultivar().id === 'glass' && !state.flags.glassChecked) {
    state.flags.glassChecked = true;
    if (dice('glass') < D.special.glass) terminal('glass');
  }
}
function resisted(changes) {
  const factor = T.resistance[cultivar().levels[6] - 1];
  return Object.fromEntries(Object.entries(changes).map(([k, n]) => [k, n * factor]));
}
function resolveEvent(id, action) {
  const f = state.flags,
    e = T.effects,
    protect = action === 'protect';
  if (id.startsWith('obs')) return;
  if (id.startsWith('M-')) {
    if (action === 'play') {
      money(state.jobResults[id] || 0, D.jobs.find(j => j.id === id).name, 'job');
    }
    return;
  }
  const name = D.events.find(r => r[0] === id)[1];
  log('事件', name + '／' + action);
  if (id === 'freeze') {
    if (cultivar().type !== '極耐寒') {
      if (hasOverride(3) && dice('cold small') < T.hotRot) delta('品種×季節!K7', '低溫影響膨大', e.dry6);else return terminal('frost');
    }
    return;
  }
  if (id.startsWith('pest')) {
    delta('C-E', name, e[action] || resisted(e.ignoreBug));
    if (action === 'daily') f.daily = true;
    if (action === 'enemy') state.feedback.push(D.copy.enemy);
    return;
  }
  if (id === 'weed' || id === 'mildew') {
    if (!protect) {
      delta('P-4／P-5', name, resisted(e[id]));
      if (id === 'mildew') f.leafOffset = (f.leafOffset || 0) + Math.round(resisted(e[id]).leaves);
    }
    return;
  }
  if (id === 'rain' && f.hardWet) delta('3-L1', '硬整後遇陰雨', {
    root: D.soilRules.rainRoot
  });
  if (protect) return;
  delta('C-E', name, e[id] || {});
  if (id === 'cold' && [6, 7].includes(stageIndex())) delta('F-3', '網紋期遇寒流', {
    net: T.other.netCold
  });
  if (id === 'heat') f.hot = true;
  if (id === 'rain' && dice('rain wilt') < D.special.rain) return terminal('wilt');
  if (id === 'typhoon' || id === 'rain') {
    let hard = id === 'typhoon' && state.soil === 3 && state.soilFactor > 0;
    if (dice('flood' + id) < (hard ? D.soilRules.hardFlood : T.flood)) {
      const damage = hard ? state.stats.root : -e.typhoon.root;
      delta('3-E', '河水倒灌', {
        root: -damage * (f.ridge ? D.soilRules.ridgeDamage : 1)
      });
    }
  }
}
function natural() {
  const s = state.stats,
    f = state.flags,
    i = stageIndex(),
    e = T.effects;
  if (f.burnRemaining > 0) {
    let n = Math.min(f.burnRemaining, D.base.recover);
    delta('4-B', '燒根逐漸恢復', {
      root: n
    });
    f.burnRemaining -= n;
  }
  if (i >= 2) {
    delta('P-1／P-2', '結果後自然下降', {
      vigor: -D.plant.loss,
      root: -D.plant.loss
    });
  }
  if (!health()) return;
  const area = s.leaf * s.leaves;
  if (area > D.plant.ideal && dice('canopy') < (area - D.plant.ideal) * D.plant.excessRisk) delta('P-3', '葉面積過大', e.canopy);
  if (area < D.plant.lowArea && state.fruit) delta('P-3', '葉面積不足', e.fewLeaves);
  if (state.fruit && (s.root < D.plant.rootLow || s.vigor < state.vmax / 2)) {
    delta('P-1／P-2', '根系或樹勢不足', e.weak);
    if (s.root < D.plant.rootLow) delta('P-2', '根系弱', {
      sweet: T.other.weakSugar
    });
  }
  if (s.count > 1 && !f.multiHit) {
    let p = D.multi.risk[s.count - 1] + (state.cards.includes('rain') || s.root < 50 || s.vigor < state.vmax / 2 ? D.multi.extra : 0);
    if (dice('multi') < p) {
      f.multiHit = true;
      for (const k of D.fruitKeys) delta('P-6', '多留果品質受損（本局一次）', {
        [k]: state.fruit[k] * (D.multi.quality - 1)
      });
    }
  }
  delta('P-7', '媒介蟲累積', {
    virus: s.pests * D.infection.transmission
  });
  if (!f.virus && dice('virus') < s.virus / 100) {
    f.virus = true;
    for (const k of ['root', 'vigor', 'leaves', 'leaf', ...(state.fruit ? D.fruitKeys : [])]) delta('P-7', '病毒發病', {
      [k]: -(s[k] ?? state.fruit[k]) * D.infection.damage
    });
    if (dice('virus fatal') < T.virusFatal[Number(!!state.fruit)]) return terminal('virus');
  }
  if (s.disease >= (cultivar().id === 'amber' ? D.infection.amber : D.infection.threshold) && dice('disease') < D.infection.chance) return terminal('disease');
  if (i === 5 && state.soil === 6 && dice('soil wilt') < D.soilRules.infectedWilt * state.soilFactor) return terminal('wilt', soil().lesson);
  if (f.pairFail && (state.cards.some(x => ['cold', 'freeze', 'heat'].includes(x)) || i >= 6)) return terminal('season');
  if (i === 6 && hasOverride(11) && !f.warm && dice('deep winter') < T.deepLoss) return terminal('season');
  if (i === 7 && hasOverride(2) && dice('rot') < T.hotRot) return terminal('disease');
  if (i === 7 && hasOverride(6) && dice('amber infection') < T.amberLoss) return terminal('disease');
  if (state.fruit && !f.nightChecked && state.days - age(state.round) <= T.other.nightDays) {
    f.nightChecked = true;
    const night = dice('night temp') < D.risk[season().risk[5]];
    if (hasOverride(7) || hasOverride(8) || night && dice('night sweet') < D.special.night - (hasOverride(0) ? T.other.nightCare : 0)) {
      f.unsweet = true;
      delta('F-5', '採收前不入甜', {
        sweet: Math.min(0, T.other.nightMax - state.fruit.sweet)
      });
    }
  }
  health();
}
function brixScore(value) {
  const n = Math.round(value * 10) / 10;
  if (n > 6 && n < 7) return (n - 6) * 30;
  return (D.judging.sugar.find(r => n <= r[0]) || D.judging.sugar.at(-1))[1];
}
function linear(x, a, b, v, w) {
  return v + (x - a) * (w - v) / (b - a);
}
function kgScore(kg) {
  const points = D.judging.kg;
  if (kg < points[0][0]) return D.judging.light;
  for (let i = 1; i < points.length; i++) {
    if (kg <= points[i][0]) return linear(kg, ...[points[i - 1][0], points[i][0], points[i - 1][1], points[i][1]]);
  }
  return points.at(-1)[1];
}
function grade(score) {
  return D.grades.find(row => score >= row[2]) || D.grades.at(-1);
}
function assess(f = state.fruit) {
  const c = cultivar(),
    glass = c.id === 'glass',
    kg = round(linear(f.size, 0, 100, ...T.kg)),
    mm = round(linear(f.ridge, 0, 100, ...T.mm));
  const scores = [brixScore(f.sweet), f.flavor, f.texture, glass ? f.net : (f.net + f.ridge) / 2, f.shape, kgScore(kg), f.flesh, 100 * f.stem];
  const weights = D.judging.weights,
    sum = xs => xs.reduce((a, v, i) => a + v * weights[i], 0),
    l = c.levels;
  const cultivarCap = sum([brixScore(D.brix[l[0]]), D.levels[l[1]], D.levels[l[2]], D.levels[l[3]], 100, D.levels[l[4]], 100, 100]);
  const cap = Math.min(state.seasonCap, cultivarCap * state.pair[1]);
  const total = round(Math.min(sum(scores), cap));
  let g = grade(total);
  if (glass && mm > D.judging.glassMM && g[2] > D.grades[2][2]) g = D.grades[2];
  return {
    kg,
    mm,
    scores,
    total,
    cap,
    g
  };
}
function evaluate() {
  return state.fruit ? assess().total : (state.stats.vigor / state.vmax * 100 + state.stats.root - state.stats.pests - state.stats.disease - state.stats.virus) / 2;
}
function decision(label, fn) {
  let before = evaluate(),
    born = !!state.fruit;
  fn();
  const effect = born === !!state.fruit ? round(evaluate() - before) : 0;
  state.decisions.push({
    turn: state.round,
    label,
    effect,
    fatal: state.step === 'result' && !!state.fail
  });
}
function workOptions() {
  return D.work[stageIndex()][2];
}
function selectedPrice() {
  let cost = 0;
  for (const [id, arr] of Object.entries(state.selection)) {
    if (id === 'work') {
      arr.forEach((v, i) => cost += workOptions()[i][1][v]?.[1] || 0);
    } else cost += D.events.find(e => e[0] === id)?.[3][arr]?.[1] || 0;
  }
  return cost;
}
function finishRound() {
  if (state.step !== 'round' || Object.keys(state.selection).length > D.rounds.actions || selectedPrice() > state.coins) return;
  const sel = state.selection,
    i = stageIndex(),
    work = sel.work?.map((v, j) => workOptions()[j][1][v]);
  state.feedback = [];
  for (const [id, v] of Object.entries(sel)) {
    if (id === 'work') work.forEach(o => expense(o[1], o[0]));else if (D.events.some(e => e[0] === id)) {
      const a = D.events.find(e => e[0] === id)[3][v];
      expense(a[1], a[0]);
    }
  }
  for (const id of state.cards.filter(x => x.startsWith('M-') && sel[x] !== undefined)) resolveEvent(id, 'play');
  decision(D.work[i][0] + '／' + (work ? work.map(o => o[0]).join('、') : '略過'), () => applyWork(work ? work.map(o => o[2]) : D.skip[i], !work));
  if (state.step !== 'result') for (const id of state.cards.filter(x => !x.startsWith('M-') && !x.startsWith('obs'))) {
    const card = D.events.find(e => e[0] === id),
      opt = card[3][sel[id]];
    decision(card[1] + '／' + (opt?.[0] || '未介入'), () => resolveEvent(id, opt?.[2] || 'pass'));
    if (state.step === 'result') break;
  }
  if (state.step !== 'result') natural();
  if (state.step !== 'result') {
    if (state.round >= D.rounds.count) harvest();else {
      state.step = 'recap';
      state.feedback.push(appearance());
    }
  }
  persist();
}
function harvest() {
  if (state.flags.unsweet) state.fruit.sweet = Math.min(state.fruit.sweet, T.other.nightMax);else if (hasOverride(3)) state.fruit.sweet = Math.max(14, state.fruit.sweet);
  state.result = assess();
  state.step = 'result';
  let cash = state.result.g[3];
  if (state.branch === 'other') {
    const [lo, hi] = D.seed.otherSale;
    cash = lo + Math.floor(dice('odd sale') * (hi - lo + 1));
  }
  money(cash, '作物收入', 'crop');
  log('評鑑', '完成採收');
  recordResult();
}
function recordResult() {
  const book = load('book', {
    cultivars: [],
    failures: [],
    odd: []
  });
  const add = (k, v) => {
    if (!book[k].includes(v)) book[k].push(v);
  };
  if (state.fail) add('failures', state.fail === 'weed' ? state.odd[0] : state.fail);else if (state.branch === 'other') add('odd', state.odd[0]);else add('cultivars', cultivar().id);
  save('book', book);
  const achievements = load('achievements', []);
  if (state.flags.lucky && !achievements.includes('好孕到')) {
    achievements.push('好孕到');
    save('achievements', achievements);
  }
  const scores = load('results', {});
  scores[state.id] = {
    fail: state.fail || null,
    grade: state.fail ? null : state.branch === 'other' ? '搞笑評鑑' : state.result.g[0],
    profit: state.coins - D.budget
  };
  save('results', scores);
  persist();
}
function appearance() {
  const s = state.stats;
  if (Math.min(s.vigor, s.root) < D.plant.weak) return D.copy.dying;
  if (s.root < D.plant.rootLow) return D.copy.droop;
  if (s.vigor < state.vmax / 2) return D.copy.yellow;
  if (s.disease >= D.infection.threshold) return D.copy.spotted;
  if (s.leaves * s.leaf > D.plant.ideal) return D.copy.crowded;
  if (state.fruit && stageIndex() >= 6) return state.fruit.net < 55 ? D.copy.badNet : state.fruit.ridge < 55 ? D.copy.thinNet : D.copy.goodNet;
  if (state.fruit) return D.copy.hanging;
  return D.copy.seedling;
}
const app = document.getElementById('app');
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[c]);
const action = (text, id, primary = false, disabled = false) => '<button type="button" data-act="' + id + '" class="' + (primary ? 'primary' : '') + '" ' + (disabled ? 'disabled' : '') + '>' + escapeHTML(text) + '</button>';
const note = (text, name = '冠冠巡田') => '<div class="note"><b>' + name + '</b><br>' + escapeHTML(text) + '</div>';
const head = (tag, title) => '<div class="eyebrow">' + escapeHTML(tag) + '</div><h2>' + escapeHTML(title) + '</h2>';
const row = (a, b) => '<div class="row"><span>' + escapeHTML(a) + '</span><strong>' + escapeHTML(b) + '</strong></div>';
const coin = n => n ? ' <span class="price">◉ ' + n + '</span>' : '';
function art(cover = false) {
  const ripe = cover || !!state?.fruit,
    stage = cover ? 9 : state?.round || 0,
    sick = !cover && state.stats?.vigor < state.vmax / 2,
    wilt = !cover && state.stats?.root < D.plant.rootLow,
    leaf = sick ? '#adab57' : '#678b58';
  const melon = (x, y, r, i) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + i + ')"><path d="M0 ' + (-r + 5) + 'q-2 -15 8 -22m-20 4q12 2 23 -5" stroke="#455c3b" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse rx="' + r + '" ry="' + r * 1.07 + '" fill="url(#skin)" stroke="#425c39" stroke-width="2"/><ellipse rx="' + (r - 2) + '" ry="' + (r * 1.07 - 2) + '" fill="url(#mesh)" opacity="' + (stage >= 7 ? cover ? .94 : clamp((state.fruit?.ridge || 0) / 100, .12, .94) : .1) + '"/><path d="M-' + r * .53 + ' -' + r * .55 + 'q-' + r * .23 + ' ' + r * .43 + ' -' + r * .12 + ' ' + r * .74 + '" fill="none" stroke="#e3eab3" opacity=".6" stroke-width="4" stroke-linecap="round"/></g>';
  const leafPath = '<path d="M0 0Q-19 -22 -44 -7l6 13 -12 4 13 8 -5 8 18 2 3 10Q-2 25 0 0Z" fill="' + leaf + '" stroke="#385a3e" stroke-width="1.6"/><path d="M-1 2l-35 23m21-14-16-5m10 10-2 10" fill="none" stroke="#d0d49a" stroke-width="1.3"/>';
  const vine = '<path d="M155 244Q150 179 175 142T203 63Q212 29 234 -8" fill="none" stroke="#415e3c" stroke-width="5"/>' + Array.from({
    length: cover ? 6 : Math.min(7, 2 + stage)
  }, (_, i) => '<g transform="translate(' + (165 + i * 8) + ' ' + (174 - i * 23) + ') rotate(' + ((i % 2 ? 148 : -8) + (wilt ? 25 : 0)) + ') scale(' + (i % 3 === 0 ? 1 : .8) + ')">' + leafPath + '</g>').join('');
  const lines = Array.from({
    length: 12
  }, (_, i) => '<path d="M' + (i * 44 - 65) + ' 238l85 -75"/>').join('');
  let fruits = '';
  if (ripe) {
    const r = cover ? 54 : Math.max(14, Math.min(46, 12 + stage * 3)) * ((state?.fruit?.size ?? 85) / 250 + .65);
    fruits = melon(228, cover ? 146 : 143, r, -9);
    if (!cover && state.stats.count > 1) fruits += melon(140, 155, r * .73, 6);
    if (!cover && state.stats.count > 2) fruits += melon(184, 175, r * .62, -4);
  }
  return '<svg viewBox="0 0 400 235" role="img" aria-label="' + (cover ? '網紋洋香瓜掛在莿桐溫室的藤上' : escapeHTML(appearance())) + '"><defs><pattern id="mesh" width="17" height="21" patternUnits="userSpaceOnUse" patternTransform="rotate(-14)"><path d="M-3 4l7 4 5-8m-5 8 4 7 8-1 4-7m-12 8-3 7m11-8 4 7" fill="none" stroke="#dce1af" stroke-width="2.4"/></pattern><radialGradient id="skin" cx=".3" cy=".22" r=".9"><stop stop-color="#a8b981"/><stop offset=".65" stop-color="#809967"/><stop offset="1" stop-color="#5b7856"/></radialGradient><pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".55" fill="#435f45" opacity=".25"/></pattern></defs><rect width="400" height="235" fill="#dce6c7"/><circle cx="90" cy="67" r="27" fill="#e9be76"/><path d="M0 133Q43 102 82 120T171 115T250 109T400 123V235H0Z" fill="#b6c9a2"/><path d="M0 153Q90 128 174 151T400 138V235H0Z" fill="#9eb591"/><path d="M0 193Q121 161 400 182V235H0Z" fill="#afad74"/><g stroke="#6f845b" stroke-width="1" opacity=".52">' + lines + '</g><g fill="none" stroke="#829980" stroke-width="2"><path d="M-18 225V59L84 -12m-11 219V69L168 0m-23 190V67L245 -5m139 209V49L303 -4M0 60l400-13M0 122l400-8"/></g><g stroke="#8a9770" stroke-dasharray="3 4"><path d="M220 0v160m-80-160v140m176-140v160"/></g>' + vine + fruits + '<rect width="400" height="235" fill="url(#grain)" pointer-events="none"/></svg>';
}
function field() {
  return '<div class="field">' + art() + '<div class="caption"><span>' + escapeHTML(appearance()) + '</span></div></div>';
}
function home() {
  const saved = load('game', null);
  app.innerHTML = '<section class="cover"><div class="coverText"><div class="eyebrow">莿桐溫室　／　田間手記</div><h1>' + D.copy.homeTitle + '</h1><p class="lede">從一株苗，到一顆能送人的洋香瓜。<br>這季的溫室，換你顧。</p><div class="heroActions">' + action(saved && saved.step !== 'result' ? D.copy.resume : D.copy.newGame, saved && saved.step !== 'result' ? 'resume' : 'new', true) + (saved && saved.step !== 'result' ? action(D.copy.resumeMenu, 'restartAsk') : saved ? action(D.copy.review, 'resume') : '') + '</div><div class="introLine"><span>單局約 5～8 分鐘</span><span>進度自動儲存</span></div></div><div class="coverArt">' + art(true) + '<div class="caption"><span>溫室網紋洋香瓜</span><span class="seasonTag">植日生農場</span></div></div></section><div class="footerLine"><span>農夫冠冠的種瓜挑戰</span><span>雲林莿桐</span></div>';
  document.getElementById('wallet').textContent = '雲林・莿桐';
}
function opts(key, items, selected, multi = false, budget = Infinity) {
  return '<div class="choices">' + items.map(([name, price], i) => {
    let checked = multi ? selected.includes(i) : selected === i,
      disabled = !checked && price > budget;
    return '<label class="option ' + (disabled ? 'disabled' : '') + '"><input type="' + (multi ? 'checkbox' : 'radio') + '" data-key="' + key + '" name="' + key + '" value="' + i + '" ' + (checked ? 'checked ' : '') + (disabled ? 'disabled' : '') + '><span>' + escapeHTML(name) + '</span>' + coin(price) + '</label>';
  }).join('') + '</div>';
}
function check(key, label, price, checked, budget) {
  return '<label class="option"><input type="checkbox" data-key="' + key + '" ' + (checked ? 'checked' : '') + (!checked && price > budget ? ' disabled' : '') + '><span>' + label + '</span>' + coin(price) + '</label>';
}
function guessedName() {
  return state.branch === 'melon' && cultivar().id === 'online' ? '無以名狀的洋香瓜' : cultivar().name;
}
function lateBan() {
  return state.days - age(state.round) < T.other.cutDay || state.days - age(state.round) === T.other.cutDay;
}
function eventAllowed(k) {
  return !(state.flags.daily && k === 'enemy') && !(lateBan() && ['spray', 'daily'].includes(k)) && (k !== 'material' || lateBan());
}
function cardControls(id) {
  const sel = state.selection,
    active = id in sel,
    left = D.rounds.actions - Object.keys(sel).length;
  if (id === 'work') {
    const work = D.work[stageIndex()],
      choices = work[2];
    let cheapest = choices.map(g => Math.min(...g[1].map(o => o[1]))).reduce((a, b) => a + b, 0);
    let body = '';
    if (active) body = choices.map(([question, list], j) => {
      let labels = list.map(o => [stageIndex() === 9 ? o[0] + '（' + dateAt(state.days + (o[2] === 'early' ? -T.harvestShift : o[2] === 'late' ? T.harvestShift : 0)) + '）' : o[0], o[1]]);
      return '<h3>' + question + '</h3>' + opts('work' + j, labels, sel.work[j], false, state.coins - selectedPrice() + list[sel.work[j]][1]);
    }).join('');
    return '<div class="panel"><div class="cardHead"><div><div class="tag">固定工作</div><h3>' + work[0] + '</h3></div>' + action(active ? '收回行動' : '安排工作', 'toggle:work', false, !active && (left <= 0 || cheapest > state.coins - selectedPrice())) + '</div>' + body + '</div>';
  }
  const e = D.events.find(r => r[0] === id),
    job = D.jobs.find(r => r.id === id),
    ob = id.startsWith('obs'),
    name = e?.[1] || job?.name || D.observe[Number(id.slice(3)) % D.observe.length];
  let body = '';
  if (active && e) {
    body = '<div class="choices inset">' + e[3].map(([n, p, k], j) => {
      const checked = sel[id] === j;
      return '<label class="option"><input type="radio" name="' + id + '" data-key="event:' + id + '" value="' + j + '" ' + (checked ? 'checked ' : '') + (!eventAllowed(k) || p > state.coins - selectedPrice() + e[3][sel[id]][1] ? 'disabled' : '') + '>' + n + coin(p) + '</label>';
    }).join('') + '</div>';
  }
  return '<div class="panel"><div class="cardHead"><div><div class="tag">' + (job ? '打工卡' : ob ? '觀察卡' : '隨機事件') + '</div><h3>' + name + '</h3></div>' + (id === 'freeze' ? '<span class="stamp">直接判定</span>' : action(active ? '收回行動' : job ? '去打工' : ob ? '去看看' : '處理', 'toggle:' + id, false, !active && left <= 0)) + '</div>' + (ob ? '<small>這回略過也沒關係。</small>' : job ? '<small>' + job.quote + '</small>' : '') + body + '</div>';
}
function screen() {
  const f = state.form || {},
    s = season(),
    next = (title, id, disabled = false) => '<div class="actions">' + action(title, id, true, disabled) + '</div>';
  switch (state.step) {
    case 'season':
      return head('開局 ／ 定植', D.copy.seasonTitle) + '<div class="coverArt">' + art(true) + '<div class="caption"><span>' + s.name + '定植</span><span>' + dateAt(0) + '</span></div></div>' + note(s.hint) + row('定植日', dateAt(0)) + row('採收參考日', dateAt(state.days)) + next(D.copy.chooseSeed, 'toCultivar');
    case 'cultivar':
      {
        const book = load('book', {
          cultivars: []
        });
        let pick = f.pick;
        return head('開局 ／ 選種', D.copy.varietyTitle) + '<p>這季在' + s.name + '定植。採收過的品種，可以翻看種植筆記。</p><div class="varieties">' + D.cultivars.map((c, i) => '<button data-act="pick:' + i + '" aria-pressed="' + (pick === i) + '"><i class="pip"></i>' + c.name + '</button>').join('') + '</div>' + (pick != null && book.cultivars.includes(D.cultivars[pick].id) ? note(D.cultivars[pick].reveal, '品種筆記') : '') + next(D.copy.confirmSeed, 'plant', pick == null);
      }
    case 'nursery':
      {
        let cost = nurseryPrice(f);
        return head('開局 ／ 網購種子', D.copy.nurseryTitle) + note(D.copy.nurseryHint) + '<h3>育苗介質</h3>' + opts('medium', D.nursery.slice(0, 4).map(o => [o.name, o.cost]), f.medium) + '<h3>穴盤</h3>' + opts('tray', D.nursery.slice(4, 8).map(o => [o.name, o.cost]), f.tray) + '<h3>加購</h3>' + check('fungus', '菌根菌', D.nursery[8].cost, f.fungus, state.coins - cost) + (D.coldSeasons.includes(s.id) ? check('heat', '保溫設備', D.nursery[9].cost, f.heat, state.coins - cost) : '') + row('含穴盤用土費', cost + ' 金幣') + next(D.copy.sow, 'sow', cost > state.coins);
      }
    case 'soil':
      return head('開局 ／ 整地', D.copy.soilTitle) + note(state.soil === 0 && dice('acid hint') < D.soilRules.acidClue ? D.copy.earlyLeaf : soil().clue, '田區外觀') + '<div class="actions">' + action('先驗土　◉ ' + D.cost.test, 'test', true, state.coins < D.cost.test) + action(D.copy.skipTest, 'noTest') + '</div>';
    case 'amend':
      {
        let left = state.coins - soilCost(f);
        return head('開局 ／ 整地', D.copy.amendTitle) + (state.test ? '<section class="report"><b>土壤檢驗報告</b>' + row('pH', report()[0]) + row('EC（土水比 1:5）', report()[1] + ' dS/m') + row('有機質', report()[2] + '%') + '</section>' : note(soil().clue, '田區外觀')) + '<h3>土壤改良</h3><p>' + D.copy.amendHelp + '</p>' + opts('improve', D.improvements.map(o => [o.name, o.cost]), f.improve || [], true, left) + '<h3>田區整理</h3><div class="choices">' + check('clean', '清園、浸水', D.cost.clean, f.clean, left) + check('ridge', '做高畦、開排水溝', D.cost.ridge, f.ridge, left) + (state.wetSoil ? check('wait', '田土很濕，等土乾再整', D.cost.wait, f.wait, left) : '') + '</div>' + next('確認整地　◉ ' + soilCost(f), 'amend', left < 0);
      }
    case 'loosen':
      return head('開局 ／ 鬆土', D.copy.loosenTitle) + note(D.copy.soilHint) + next(D.copy.loosen, 'loosen');
    case 'mini':
      return miniView();
    case 'base':
      {
        const name = D.fertilizers[f.fert ?? 0].name;
        return head('開局 ／ 基肥', D.copy.baseTitle) + (state.feedback.length ? note(state.feedback.join(' '), '田間紀錄') : '') + (state.test ? row('土壤肥力', ['偏瘦', '正常', '偏肥'][state.fertility]) : '') + (D.coldSeasons.includes(s.id) ? note(D.copy.cold) : '') + opts('fert', D.fertilizers.map((a, i) => [a.name + (state.flags.compost && i === 0 ? '（整地已施堆肥）' : ''), basePrice(i)]), f.fert ?? 0, false, state.coins) + note(state.test ? D.copy.testedHint : D.copy.untestedHint) + '<div class="meter">' + (state.test ? '<span class="zone" style="left:' + meter()[0] * 100 + '%;width:' + (meter()[1] - meter()[0]) * 100 + '%"></span>' : '') + '<i class="needle" id="needle"></i></div><button class="pad" id="pour" ' + (basePrice(f.fert ?? 0) > state.coins ? 'disabled' : '') + '>按住倒肥，放開結算</button><div class="actions">' + action(D.copy.noBase, 'noBase') + '</div>';
      }
    case 'round':
      {
        const w = D.work[stageIndex()],
          l = D.rounds.actions - Object.keys(state.selection).length;
        return head('生長期 ／ ' + dateAt(age(state.round)), w[0]) + '<div class="track" aria-label="作期進度"><i style="width:' + state.round / D.rounds.count * 100 + '%"></i></div>' + field() + (state.round === 1 && state.feedback.length ? note(state.feedback.join(' '), '整地紀錄') : '') + note(w[1]) + (stageIndex() === 9 ? row('授粉日', state.poll) + row('距參考採收日', Math.round((Date.parse(dateAt(state.days)) - Date.parse(state.poll)) / MS) + ' 天') : '') + '<div class="cardHead"><h3>這週要做的事</h3><span aria-label="剩餘行動" class="points">' + ('● '.repeat(l) + '○ '.repeat(D.rounds.actions - l)) + '</span></div>' + cardControls('work') + state.cards.map(cardControls).join('') + row('已安排花費', selectedPrice() + ' 金幣') + next(D.copy.commit, 'commit');
      }
    case 'recap':
      return head('田間紀錄 ／ ' + dateAt(age(state.round)), D.copy.recapTitle) + field() + note(state.feedback.join(' '), '巡田紀錄') + next(D.copy.next, 'nextRound');
    case 'result':
      return resultsView();
    default:
      return '';
  }
}
function resultsView() {
  const fail = !!state.fail,
    odd = state.branch === 'other',
    res = state.result;
  const title = fail ? D.failures[state.fail][0] : odd ? state.odd[0] + '收成了' : res.g[1];
  let h = head(fail ? '本季失收' : odd ? '採收 ／ 搞笑評鑑' : '採收 ／ 切瓜評鑑', title);
  if (fail) {
    h += note(state.fail === 'weed' ? state.odd.join('，') : D.copy.loseLine) + note(state.lesson, D.copy.lessonTitle);
  } else if (odd) {
    h += note(state.odd[1]) + row('本季稱號', T.other.oddTitle[D.otherCrops.findIndex(o => o[0] === state.odd[0])]);
  } else {
    h += '<div class="field endArt">' + art() + '</div>' + row('總評', res.g[0] + ' ／ ' + res.total + ' 分') + row('糖度', state.fruit.sweet.toFixed(1) + ' °Brix') + row('果重', res.kg.toFixed(2) + ' kg') + (cultivar().id === 'glass' ? row('網紋粗度', res.mm.toFixed(2) + ' mm') : '') + '<ul class="gradeList">' + res.scores.map((n, i) => {
      const g = grade(n);
      return '<li><b>' + D.judging.names[i] + '　' + g[0] + '</b><small>' + D.verdict[D.grades.indexOf(g)] + '</small></li>';
    }).join('') + '</ul>';
  }
  if (!fail) h += row('實際採收日', state.cut || dateAt(state.days));
  if (!state.branch || state.branch === 'melon') h += note(state.branch === 'melon' && cultivar().id === 'online' ? '這包種子到切瓜還是認不出來。' : cultivar().reveal, guessedName());
  if (state.test) h += note(soil().lesson, '土壤報告怎麼看');
  const dec = state.decisions || [];
  for (const sign of [1, -1]) {
    const picked = dec.filter(d => sign > 0 ? d.effect > 0 : d.effect < 0 || d.fatal).sort((a, b) => sign < 0 ? Number(b.fatal) - Number(a.fatal) || a.effect - b.effect : b.effect - a.effect).slice(0, 2);
    h += '<h3>' + (sign > 0 ? '幫最多的決定' : '傷最大的決定') + '</h3>' + (picked.length ? picked.map(d => '<p>' + escapeHTML(d.label) + '</p>').join('') : '<small>本局尚無可比較的決定。</small>');
  }
  const total = c => state.ledger.filter(x => x.category === c).reduce((s, x) => s + x.amount, 0),
    net = state.coins - D.budget;
  h += '<h3>這季收支表</h3>' + row('作物收入', total('crop')) + row('打工收入', total('job')) + row('實際花費（已扣退費）', -(total('expense') + total('refund'))) + row('本季淨利', net + ' 金幣') + row('期末錢包', state.coins + ' 金幣') + (net < 0 ? note(D.copy.lossLine) : '') + '<details><summary>逐筆收支</summary>' + state.ledger.map(x => row(x.label, x.amount)).join('') + '</details><div class="actions">' + (fail ? action(state.used ? '本局重來已用過' : D.copy.rewind, 'rewind', true, state.used || !state.snapshot) : '') + action(D.copy.restart, 'new', !fail) + (debug ? action(D.copy.download, 'download') : '') + '</div>';
  return h;
}
let timer = 0,
  pourStart = null,
  pourFrame = 0;
function startMini(kind) {
  let seconds = kind === 'soil' ? cultivar().levels[7] >= D.soilGame.hardLevel ? D.soilGame.hardSeconds : D.soilGame.seconds : D.job.seconds;
  if (kind === 'soil' && hasOverride(10)) seconds *= T.other.shortTime;
  let hits = kind === 'soil' ? 1 + Number(state.flags.hardWet) + (state.soil === 3 && state.soilFactor ? 2 : 0) + (state.soil === 7 && state.soilFactor ? 1 : 0) : 1;
  state.mini = {
    kind,
    duration: seconds * 1000,
    start: 0,
    hits,
    index: 0,
    done: 0,
    mistakes: 0,
    taps: 0
  };
  state.step = 'mini';
  persist();
}
function miniSlot(m, wave) {
  return Math.floor(dice(m.kind + '位置' + wave) * 9);
}
function miniView() {
  const m = state.mini,
    job = D.jobs.find(j => j.id === m.kind),
    title = job?.name || '鬆土';
  let h = head(job ? '打工 ／ 鄰田' : '整地 ／ 手上工夫', title) + note(job?.hint || '點土塊，避開蚯蚓。');
  if (!m.start) return h + action(D.copy.miniStart, 'miniStart', true);
  const decoy = m.index % Math.ceil((T.targets + T.decoys) / T.decoys) === 0;
  const symbol = m.kind === 'soil' ? decoy ? '蚯蚓' : '土塊' : m.kind === 'M-1' ? decoy ? '瓜苗' : '雜草' : decoy ? m.index % 2 ? '過小' : '過老' : '剛好';
  const icon = m.kind === 'soil' ? decoy ? '∿' : '◆' : m.kind === 'M-1' ? decoy ? '♧' : '♒' : decoy ? '◒' : '◐';
  return h + '<div class="track" aria-label="剩餘時間"><i id="clock"></i></div><div class="grid">' + Array.from({
    length: 9
  }, (_, i) => '<button aria-label="' + (miniSlot(m, m.index) === i ? symbol : '空地') + '" class="tile ' + (miniSlot(m, m.index) === i ? '' : 'empty') + '" data-slot="' + i + '">' + (miniSlot(m, m.index) === i ? icon + '<small>' + symbol + '</small>' : '') + '</button>').join('') + '</div><small>' + (m.kind === 'M-1' ? '手指往上滑拔草。鍵盤可用 Enter。' : '看到目標再點下去。') + '</small>';
}
function miniWave() {
  const m = state.mini;
  if (!m?.start) return;
  let elapsed = Date.now() - m.start,
    pct = clamp(elapsed / m.duration, 0, 1),
    wave = Math.min(T.targets + T.decoys - 1, Math.floor(pct * (T.targets + T.decoys)));
  if (pct >= 1) {
    finishMini();
    return;
  }
  if (m.index !== wave) {
    m.index = wave;
    m.taps = 0;
    m.hit = false;
    persist();
    render(false);
  }
  const clock = document.getElementById('clock');
  if (clock) clock.style.width = (1 - pct) * 100 + '%';
}
function hit(slot) {
  const m = state.mini;
  if (!m?.start || m.hit || miniSlot(m, m.index) !== slot) return;
  const bad = m.index % Math.ceil((T.targets + T.decoys) / T.decoys) === 0;
  if (bad) m.mistakes++;else if (++m.taps < m.hits) {
    persist();
    return;
  } else m.done++;
  m.hit = true;
  const el = app.querySelector('[data-slot="' + slot + '"]');
  if (el) {
    el.textContent = bad ? '×' : '✓';
    el.disabled = true;
  }
  persist();
}
function finishMini() {
  clearInterval(timer);
  const m = state.mini;
  if (!m) return;
  const ratio = clamp(m.done / T.targets - m.mistakes * (m.kind === 'soil' ? D.soilGame.penalty : D.job.penalty), 0, 1);
  log(m.kind === 'soil' ? '3-G1' : m.kind, '小遊戲結算', {
    ratio
  });
  delete state.mini;
  if (m.kind === 'soil') {
    const band = D.soilGame.bands.find(b => ratio >= b[0]);
    const label = '鬆土' + (ratio >= .7 ? '打得挺鬆' : '還留了些硬塊');
    decision(label, () => delta('3-G' + (D.soilGame.bands.indexOf(band) + 2), '鬆土完成度', {
      root: band[1]
    }));
    if (ratio < 1) checkGlass();
    if (state.step !== 'result' && health()) {
      state.step = 'base';
      state.form = {
        fert: 0
      };
      state.feedback = [label];
    }
  } else {
    state.jobResults[m.kind] = Math.round(ratio * D.job.maximum / D.job.roundTo) * D.job.roundTo;
    continueJobs();
  }
  persist();
  render();
}
function continueJobs() {
  if (state.pending.length) {
    startMini(state.pending.shift());
  } else {
    state.step = 'round';
    finishRound();
  }
}
function toggle(id) {
  const selected = state.selection;
  if (id in selected) {
    delete selected[id];
    return;
  }
  if (Object.keys(selected).length >= D.rounds.actions) return;
  if (id === 'work') {
    selected.work = workOptions().map(g => 0);
    if (selectedPrice() > state.coins) selected.work = workOptions().map(g => g[1].findIndex(o => o[1] === Math.min(...g[1].map(v => v[1]))));
  } else {
    const e = D.events.find(x => x[0] === id);
    selected[id] = e ? e[3].findIndex(o => eventAllowed(o[2]) && o[1] <= state.coins - selectedPrice()) : 0;
  }
  if (selectedPrice() > state.coins) delete selected[id];
}
function debugPanel() {
  const el = document.getElementById('debug');
  if (!debug || !state) {
    el.innerHTML = '';
    return;
  }
  const opened = el.querySelector('details')?.open;
  const data = {
    時段: season().name,
    品種: state.actual != null ? cultivar().name : null,
    土況: soil().id,
    行動點: D.rounds.actions - Object.keys(state.selection).length,
    抽卡: state.cards,
    入池機率: state.odds,
    植株: {
      ...state.stats,
      area: round((state.stats.leaf || 0) * (state.stats.leaves || 0))
    },
    果實: state.fruit,
    旗標: state.flags,
    本局紀錄: state.log
  };
  el.innerHTML = '<details ' + (opened ? 'open' : '') + '><summary>除錯面板</summary><pre>' + escapeHTML(JSON.stringify(data, null, 2)) + '</pre></details>';
}
function render(scroll = true) {
  clearInterval(timer);
  if (scroll) window.scrollTo(0, 0);
  if (!state) {
    home();
    debugPanel();
    return;
  }
  const w = document.getElementById('wallet');
  w.className = 'wallet';
  w.innerHTML = '<span class="coin">·</span>' + state.coins + ' 金幣';
  app.innerHTML = '<section class="screen">' + screen() + '</section>';
  if (!storageOK) app.insertAdjacentHTML('afterbegin', '<small>這個瀏覽器無法保存進度，請在同一頁完成本局。</small>');
  debugPanel();
  if (state.step === 'mini' && state.mini?.start) {
    timer = setInterval(miniWave, 90);
  }
}
function download() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json'
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = '植日生-單局紀錄-' + dateAt(0) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
app.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const [id, arg] = btn.dataset.act.split(':');
  let scroll = true;
  switch (id) {
    case 'new':
      fresh();
      break;
    case 'restartAsk':
      if (!confirm('另開一局會取代目前進度，確定嗎？')) return;
      fresh();
      break;
    case 'resume':
      state = load('game', null);
      break;
    case 'toCultivar':
      state.step = 'cultivar';
      state.form = {};
      {
        const i = forced(D.cultivars, 'cultivar');
        if (i >= 0) state.form.pick = i;
      }
      break;
    case 'pick':
      state.form.pick = Number(arg);
      scroll = false;
      break;
    case 'plant':
      beginCultivar(state.form.pick);
      if (state.step === 'nursery') {
        state.form = {
          medium: 0,
          tray: 0
        };
        checkpoint();
      }
      break;
    case 'sow':
      decision('自己播種育苗', () => sow(state.form));
      break;
    case 'test':
    case 'noTest':
      soilTest(id === 'test');
      break;
    case 'amend':
      decision('土壤改良／' + ((state.form.improve || []).map(i => D.improvements[i].name).join('、') || '直接整地'), () => amend(state.form));
      break;
    case 'loosen':
      checkpoint();
      startMini('soil');
      break;
    case 'miniStart':
      state.mini.start = Date.now();
      break;
    case 'noBase':
      decision('本季不施基肥', omitFert);
      break;
    case 'toggle':
      toggle(arg);
      scroll = false;
      break;
    case 'commit':
      state.pending = state.cards.filter(k => k.startsWith('M-') && k in state.selection);
      continueJobs();
      break;
    case 'nextRound':
      newRound();
      break;
    case 'rewind':
      rewind();
      break;
    case 'download':
      download();
      return;
    default:
      return;
  }
  persist();
  render(scroll);
});
app.addEventListener('change', ev => {
  const el = ev.target,
    k = el.dataset.key;
  if (!k) return;
  const v = Number(el.value);
  if (k.startsWith('work')) state.selection.work[Number(k.slice(4))] = v;else if (k.startsWith('event:')) state.selection[k.slice(6)] = v;else if (k === 'improve') {
    const arr = state.form.improve || [];
    state.form.improve = el.checked ? [...arr, v] : arr.filter(n => n !== v);
  } else state.form[k] = el.type === 'checkbox' ? el.checked : v;
  persist();
  render(false);
});
function pourTick() {
  if (pourStart === null) return;
  const t = clamp((performance.now() - pourStart) / D.base.duration, 0, 1);
  const needle = document.getElementById('needle');
  if (needle) needle.style.left = t * 100 + '%';
  if (t < 1) pourFrame = requestAnimationFrame(pourTick);
}
function pourEnd(cancel = false) {
  if (pourStart === null) return;
  const t = clamp((performance.now() - pourStart) / D.base.duration, 0, 1);
  pourStart = null;
  cancelAnimationFrame(pourFrame);
  if (!cancel) {
    const i = state.form.fert ?? 0;
    decision('基肥／' + D.fertilizers[i].name, () => applyFert(i, t));
    persist();
  }
  render();
}
let swipe = null;
app.addEventListener('pointerdown', ev => {
  const e = ev.target.closest('button');
  if (!e || e.disabled) return;
  if (e.id === 'pour') {
    ev.preventDefault();
    e.setPointerCapture(ev.pointerId);
    pourStart = performance.now();
    pourTick();
  }
  if (e.hasAttribute('data-slot')) {
    e.setPointerCapture(ev.pointerId);
    swipe = {
      y: ev.clientY,
      slot: Number(e.dataset.slot),
      wave: state.mini.index
    };
  }
});
app.addEventListener('pointerup', ev => {
  if (pourStart !== null) {
    pourEnd();
    return;
  }
  if (swipe && state.mini && state.mini.index === swipe.wave && (state.mini.kind !== 'M-1' || swipe.y - ev.clientY > 12)) hit(swipe.slot);
  swipe = null;
});
app.addEventListener('pointercancel', () => {
  swipe = null;
  pourEnd(true);
});
app.addEventListener('keydown', ev => {
  if (!['Enter', ' '].includes(ev.key) || ev.repeat) return;
  if (ev.target.id === 'pour') {
    ev.preventDefault();
    pourStart = performance.now();
    pourTick();
  } else if (ev.target.hasAttribute('data-slot')) {
    ev.preventDefault();
    hit(Number(ev.target.dataset.slot));
  }
});
app.addEventListener('keyup', ev => {
  if (ev.target.id === 'pour' && ['Enter', ' '].includes(ev.key)) {
    ev.preventDefault();
    pourEnd();
  }
});
window.addEventListener('blur', () => {
  if (pourStart !== null) pourEnd(true);
});
render();
