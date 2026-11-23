'use strict';

const Q = new URLSearchParams(location.search);
const debug = Q.get('debug') === '1';
const param = key => debug ? Q.get(key) : null;
const keyPrefix = 'zhirisheng.melon.daily.v1.';
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
  state.daily = {ap:0,tasks:{},ongoing:{},completed:[],known:[],visits:[],logbook:[],applied:{},badWater:0};
  state.spun = false;
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
  const planted = load('planted', []);
  const chosenId = D.cultivars[index].id;
  if (!planted.includes(chosenId)) save('planted', [...planted, chosenId]);
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
    const max = levelIndex !== undefined ? D.levels[cultivar().levels[levelIndex]] : k === 'vigor' ? state.vmax*((state.daily?.npk?.[0]||0)>daily.farm.excess?daily.farm.vigorLimit:1) : k === 'sweet' ? D.brix[cultivar().levels[0]] : k === 'leaf' ? D.plant.leafRange[1] : 100;
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
  state.flags.ridgeGain=soilQuality('ridge');
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
    const quality = soilQuality(i);
    if (effect.includes('解除')) factor = Math.min(factor, 1 - quality);else if (effect.includes('減半')) factor = Math.min(factor, 1 - .5*quality);
    if (effect.includes('加倍')) worse = 2;
    for (const m of effect.matchAll(/(根系|樹勢|蟲害壓力) ([+−-])(\d+)/g)) {
      const val = Number(m[3]) * (m[2] === '+' ? 1 : -1);
      (val > 0 ? good : bad).push([{
        '根系': 'root',
        '樹勢': 'vigor',
        '蟲害壓力': 'pests'
      }[m[1]], val > 0 ? val * quality : val, ref]);
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
      pests: D.soilRules.cleanPests*soilQuality('clean')
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
  if (i === 1) {
    let prob = has('hand') ? T.set[0] : has('bee') ? T.set[1] : T.set[2];
    if (!has('none')) prob -= Number(['過量', '嚴重過量'].includes(f.base)) * D.base.setLoss + Number(!!f.hot) * T.other.heatSet + Number(!has('midNode')) * T.other.wrongNode + Number(s.leaf > D.plant.large) * T.other.softLeafSet;
    if(!has('none') && s && state.daily.tasks.poll?.quality!=null)prob*=.85+.15*state.daily.tasks.poll.quality;
    if(has('hand'))prob=clamp((state.daily.tasks.poll?.handPoints||0)/farm.pollTotal,0,1);
    log('第13題', '著果判定', {
      prob
    });
    if (dice('fruit set') >= prob) return terminal('set',has('hand')?'人工授粉完成 '+Math.round(prob*100)+'%。下次多留幾天授粉，或在花期結束前改放蜂。':undefined);
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
    if(has('sound') && state.daily.currentQuality!=null)scaleDelta('G-5','挑果完成度',e.scar,1-state.daily.currentQuality);
    delta('P-6', '多留果的固定大小扣幅', {
      size: state.fruit.size * (D.multi.size[s.count - 1] - 1)
    });
  }
  if (i === 3) {
    if (f.dirty && !f.topHandled) delta('P-7', '摘心時剪刀沒消毒', {
      virus: D.infection.dirty[1]
    });
    if (has('strip') && state.fruit) state.fruit.stem = 0;
    if ((has('untied') || (has('tie') && dice('吊繩作業')>(state.daily.currentQuality??1))) && dice('untied') < T.breakRate[state.actual]) return terminal('snap');
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
  const careful = !skipped && (state.daily.currentQuality??1)>=.8 && !keys.some(k => ['double', 'dirtyTool', 'keepBud', 'lowNode', 'highNode', 'none', 'scar', 'two', 'three', 'grow', 'strip', 'untied', 'nitrogen', 'skipFeed', 'dry', 'wet', 'normal', 'stop', 'early', 'late', 'tangle'].includes(k));
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
        root: -damage * (f.ridge ? 1-(1-D.soilRules.ridgeDamage)*(f.ridgeGain??1) : 1)
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
  if (state.round > 0) unlockStage();
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
  if(state.step==='round'&&state.daily?.reading?.caption&&!state.daily.recording)return state.daily.reading.caption;
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
    stage = cover ? 9 : state?.round ? Math.max(0,phase()[2]) : 0,
    sick = !cover && state.stats?.vigor < state.vmax / 2,
    wilt = !cover && state.stats?.root < D.plant.rootLow,
    leaf = sick ? '#adab57' : '#678b58';
  const melon = (x, y, r, i) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + i + ')"><path d="M0 ' + (-r + 5) + 'q-2 -15 8 -22m-20 4q12 2 23 -5" stroke="#455c3b" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse rx="' + r + '" ry="' + r * 1.07 + '" fill="url(#skin)" stroke="#425c39" stroke-width="2"/><ellipse rx="' + (r - 2) + '" ry="' + (r * 1.07 - 2) + '" fill="url(#mesh)" opacity="' + (stage >= 7 ? cover ? .94 : clamp((state.fruit?.ridge || 0) / 100, .12, .94) : .1) + '"/><path d="M-' + r * .53 + ' -' + r * .55 + 'q-' + r * .23 + ' ' + r * .43 + ' -' + r * .12 + ' ' + r * .74 + '" fill="none" stroke="#e3eab3" opacity=".6" stroke-width="4" stroke-linecap="round"/></g>';
  const leafPath = '<path d="M0 0Q-19 -22 -44 -7l6 13 -12 4 13 8 -5 8 18 2 3 10Q-2 25 0 0Z" fill="' + leaf + '" stroke="#385a3e" stroke-width="1.6"/><path d="M-1 2l-35 23m21-14-16-5m10 10-2 10" fill="none" stroke="#d0d49a" stroke-width="1.3"/>';
  const growthFraction = cover || !state?.daily?.growth ? 1 : clamp((state.daily.growth.height ?? state.daily.growth.leaves * 3) / daily.curve.at(-1)[2], .1, 1);
  const vine = '<g transform="translate(155 235) scale(' + (0.45 + .55 * growthFraction) + ' ' + growthFraction + ') translate(-155 -235)"><path d="M155 244Q150 179 175 142T203 63Q212 29 234 -8" fill="none" stroke="#415e3c" stroke-width="5"/>' + Array.from({
    length: cover ? 6 : Math.max(1, Math.min(7, Math.ceil((state?.stats?.leaves ?? 1) / 4)))
  }, (_, i) => '<g transform="translate(' + (165 + i * 8) + ' ' + (174 - i * 23) + ') rotate(' + ((i % 2 ? 148 : -8) + (wilt ? 25 : 0)) + ') scale(' + (i % 3 === 0 ? 1 : .8) + ')">' + leafPath + '</g>').join('') + '</g>';
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
function eventAllowed(k,id) {
  return !(state.flags.daily && k === 'enemy') && !(lateBan() && ['spray', 'daily'].includes(k)) && (k !== 'material' || id==='mildew' || lateBan());
}
function baseScreen() {
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
    h += note(state.fail === 'weed' ? state.odd.join('，') : D.daily.loseLine) + note(state.lesson, D.copy.lessonTitle);
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
  h += '<h3>這季收支表</h3>' + row('作物收入', total('crop')) + row('打工收入', total('job')) + (total('bonus')?row('彩蛋獎金',total('bonus')):'') + row('實際花費（已扣退費）', -(total('expense') + total('refund'))) + row('本季淨利', net + ' 金幣') + row('期末錢包', state.coins + ' 金幣') + (net < 0 ? note(D.copy.lossLine) : '') + '<details><summary>逐筆收支</summary>' + state.ledger.map(x => row(x.label, x.amount)).join('') + '</details><div class="actions">' + (fail ? action(state.used ? '本局重來已用過' : D.copy.rewind, 'rewind', true, state.used || !state.snapshot) : '') + action(D.copy.restart, 'new', !fail) + (debug ? action(D.copy.download, 'download') : '') + '</div>';
  return h;
}
let timer = 0,
  pourStart = null,
  pourFrame = 0;

function marketRound(m){
  const j=D.jobs.find(j=>j.id===m.kind),r=m.index,items=daily.market.items;
  const rand=(tag,n)=>Math.floor(dice(m.kind+'／'+r+'／'+tag)*n);
  m.started=Date.now();m.revealed=false;m.picks=[];m.counts=[0,0];m.cells=[];m.rotation=0;
  m.order=Array.from({length:9},(_,i)=>i).sort((a,b)=>dice(m.kind+r+'格'+a)-dice(m.kind+r+'格'+b));
  m.labels=[...items].sort((a,b)=>dice(m.kind+r+a)-dice(m.kind+r+b));
  m.answer=rand('答',m.labels.length);m.delay=0;
  if(m.kind==='M-6')m.prompt='這張單要找「'+m.labels[m.answer]+'」。';
  if(m.kind==='M-7'){m.delay=2000;m.quantities=[1+rand('甲',2+r),1+rand('乙',2+r)];}
  if(m.kind==='M-8'){m.delay=2000;m.targets=m.order.slice(0,2+r);}
  if(m.kind==='M-9'||m.kind==='M-10'){
    const count=m.kind==='M-10'?3+rand('瓜',5+r):0,paid=r<2?100:500,price=1+rand('錢',paid-1);
    const correct=count||paid-price;
    m.labels=[correct,correct+1,correct+3,Math.max(0,correct-1)].sort((a,b)=>dice(r+'選'+a)-dice(r+'選'+b));
    m.answer=m.labels.indexOf(correct);m.prompt=count?'籃子裡有幾顆瓜？':'收 '+paid+' 元，售價 '+price+' 元，要找多少？';
    if(count){m.delay=3000;m.count=count;}
  }
  if(m.kind==='M-12'){
    const q=daily.market.seedQuestions[r];m.photo=q.image;m.labels=q.options;m.answer=q.answer;m.prompt='這是哪種作物的種子？';
  }
  m.limit=m.delay+Math.round(D.job.seconds*1000/j.questions);
}
function marketView(m){
  const j=D.jobs.find(j=>j.id===m.kind),hidden=Date.now()-m.started<m.delay;
  let h=head('鄰田打工・'+(m.index+1)+'／'+j.questions,j.name)+note(j.hint);
  if(!m.start)return h+action('開始打工','miniStart',true);
  h+='<div class="track"><i id="clock"></i></div>';
  const btn=(s,i)=>action(String(s),'market:'+i);
  if(m.kind==='M-7')return h+(hidden?note(m.labels[0]+' × '+m.quantities[0]+'、'+m.labels[1]+' × '+m.quantities[1],'今天的訂單'):
    m.labels.slice(0,2).map((x,i)=>btn(x+' × '+m.counts[i]+'　＋',i)).join('')+btn('清空',2)+btn('交貨',3));
  if(m.kind==='M-8')return h+'<div class="grid">'+Array.from({length:9},(_,i)=>btn(hidden?(m.targets.includes(i)?'病斑':'葉片'):m.picks.includes(i)?'✓':'葉片',i)).join('')+'</div>';
  if(m.kind==='M-10'&&hidden)return h+note('🍈 '.repeat(m.count),'點收瓜籃');
  if(m.kind==='M-11')return h+btn('旋轉・'+(m.rotation?'直放':'橫放'),16)+'<div class="packShape" style="touch-action:none">拖動貨品 '+(m.rotation?'▣ ↕':'▣ ↔')+'</div><div class="packGrid">'+Array.from({length:16},(_,i)=>'<button data-act="market:'+i+'" data-pack="'+i+'">'+(m.cells.includes(i)?'瓜':'空')+'</button>').join('')+'</div>'+btn('送出這箱',17);
  return h+note(m.prompt)+(m.photo?'<img width="180" src="'+escapeHTML(m.photo)+'" alt="種子題目">':'')+m.labels.map(btn).join('');
}
function marketNext(m,correct){
  if(correct)m.done++;else m.mistakes++;
  const j=D.jobs.find(j=>j.id===m.kind);
  if(++m.index>=j.questions){finishMini();return;}
  marketRound(m);persist();render(false);
}
function marketTap(m,i){
  if(!m.start||Date.now()-m.started<m.delay)return;
  if(Date.now()-m.started>=m.limit){marketNext(m,false);return;}
  if(m.kind==='M-11'){
    if(i===16)m.rotation=1-m.rotation;
    else if(i===17){marketNext(m,true);return;}
    else{const other=i+(m.rotation?4:1);if(i>=0&&i<16&&other<16&&(m.rotation||i%4!==3)&&![i,other].some(x=>m.cells.includes(x)))m.cells.push(i,other);}
  }else if(m.kind==='M-7'){
    if(i===3){marketNext(m,m.counts.every((v,k)=>v===m.quantities[k]));return;}
    if(i===2)m.counts=[0,0];else m.counts[i]++;
  }else if(m.kind==='M-8'){
    if(m.picks.includes(i))return;
    if(!m.targets.includes(i)){marketNext(m,false);return;}
    m.picks.push(i);if(m.picks.length===m.targets.length){marketNext(m,true);return;}
  }else{marketNext(m,i===m.answer);return;}
  persist();render(false);
}

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
    title = job?.name || (m.kind==='homeWeed'?'自家拔草':'鬆土');
  let h = head(job ? '打工 ／ 鄰田' : '整地 ／ 手上工夫', title) + note(job?.hint || (m.kind==='homeWeed'?'往上滑拔草，避開瓜苗。':'點土塊，避開蚯蚓。'));
  if(job?.questions)return marketView(m);
  if (!m.start) return h + action(D.copy.miniStart, 'miniStart', true);
  if(['M-1','M-2','homeWeed'].includes(m.kind))return h+cropGrid(m);
  const decoy = m.index % Math.ceil((T.targets + T.decoys) / T.decoys) === 0;
  const symbol = m.kind === 'soil' ? decoy ? '蚯蚓' : '土塊' : m.kind === 'M-1' ? decoy ? '瓜苗' : '雜草' : decoy ? m.index % 2 ? '過小' : '過老' : '剛好';
  const icon = m.kind === 'soil' ? decoy ? '∿' : '◆' : m.kind === 'M-1' ? decoy ? '♧' : '♒' : decoy ? '◒' : '◐';
  return h + '<div class="track" aria-label="剩餘時間"><i id="clock"></i></div><div class="grid">' + Array.from({
    length: 9
  }, (_, i) => '<button aria-label="' + (miniSlot(m, m.index) === i ? symbol : '空地') + '" class="tile ' + (miniSlot(m, m.index) === i ? '' : 'empty') + '" data-slot="' + i + '">' + (miniSlot(m, m.index) === i ? icon + '<small>' + symbol + '</small>' : '') + '</button>').join('') + '</div><small>' + (m.kind === 'M-1' ? '手指往上滑拔草。鍵盤可用 Enter。' : '看到目標再點下去。') + '</small>';
}
function cropSlots(m){
  const first=miniSlot(m,m.index),slots=new Map();
  if(m.kind==='M-2'){slots.set(first,['剛好','過老','剛好','過小'][m.index%4]);return slots;}
  slots.set(first,'雜草');
  if(dice('雙草'+m.index)<.5)slots.set((first+4)%9,'雜草');
  slots.set((first+2)%9,'瓜苗');return slots;
}
function cropGrid(m){
  const slots=cropSlots(m);
  return '<div class="track"><i id="clock"></i></div><div class="grid">'+Array.from({length:9},(_,i)=>{
    const item=slots.get(i),picked=m.picked?.includes(i);
    return '<button class="tile '+(!item?'empty':'')+'" data-slot="'+i+'" '+(picked?'disabled':'')+'>'+ (picked?'✓':item||'')+'</button>';
  }).join('')+'</div><small>'+ (m.kind==='M-2'?'點選要採的瓜。':'往上滑拔草。')+'</small>';
}
function missedCucumber(m,to){
  if(m.kind!=='M-2')return;
  for(let i=m.index;i<to;i++)if(i%4===1&&(i!==m.index||!m.picked?.length))m.mistakes++;
}
function miniWave() {
  const m = state.mini;
  if (!m?.start) return;
  if(D.jobs.find(j=>j.id===m.kind)?.questions){
    const t=Date.now()-m.started;
    if(t>=m.limit){marketNext(m,false);return;}
    if(!m.revealed&&t>=m.delay){m.revealed=true;render(false);}
    const bar=document.getElementById('clock');if(bar)bar.style.width=(100*(1-t/m.limit))+'%';
    return;
  }
  let elapsed = Date.now() - m.start,
    pct = clamp(elapsed / m.duration, 0, 1),
    wave = Math.min(T.targets + T.decoys - 1, Math.floor(pct * (T.targets + T.decoys)));
  if (pct >= 1) {
    missedCucumber(m,T.targets+T.decoys);finishMini();
    return;
  }
  if (m.index !== wave) {
    missedCucumber(m,wave);m.picked=[];
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
  if(m?.start&&['M-1','M-2','homeWeed'].includes(m.kind)){
    const item=cropSlots(m).get(slot);if(!item||(m.picked||[]).includes(slot))return;
    (m.picked??=[]).push(slot);
    if(['雜草','剛好'].includes(item)){m.done++;m.valid=(m.valid||0)+1;}
    else if(item==='過老')m.valid=(m.valid||0)+1;
    else m.mistakes++;
    persist();render(false);return;
  }
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
    if(m.kind==='homeWeed'){
      const o=state.daily.ongoing.weed;o.cleared=(o.cleared||0)+m.spend;
      const left=weedWork(o);if(!left)delete state.daily.ongoing.weed;
      state.daily.message='自家田區除草，剩 '+left+' 點工作量。';state.step='round';persist();render();return;
    }
    const job=D.jobs.find(j=>j.id===m.kind);
    const fraction=m.kind==='M-11'?m.cells.length/16:job.questions?clamp(m.done/job.questions-m.mistakes*D.job.penalty,0,1):ratio;
    const valid=m.kind==='M-11'?m.cells.length:(m.valid||m.done);
    const pay=valid?Math.max(1,Math.round(fraction*D.job.maximum)):0;
    money(pay, D.jobs.find(j => j.id === m.kind).name, 'job');
    state.daily.message = '完成 '+valid+' 次有效動作，領到 ' + pay + ' 金幣，餘額 '+state.coins+'。';
    state.step = 'round';
  }
  persist();
  render();
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
    日序: state.round,
    行動點: state.daily?.ap,
    生長: state.daily?.growth,
    跨日工作: state.daily?.tasks,
    持續事件: state.daily?.ongoing,
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
  if(state.step==='arc'&&state.daily.arc.start){drawArc(state.daily.arc,arcTime(state.daily.arc));timer=setInterval(arcFrame,50);}
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
const daily = D.daily;
const age = day => day;
function baselineDay(base) {
  if (state.actual != null && hasOverride(4)) {
    const flower = clamp(state.days - daily.referenceDaysAfterFlower, ...daily.flowerRange);
    const anchor = daily.phases[2][0];
    return Math.round(base <= anchor ? base * flower / anchor :
      flower + (base - anchor) * (state.days - flower) / (daily.baseDays - anchor));
  }
  return Math.round(base * state.days / daily.baseDays);
}
function calendarDay(base){
  const day=baselineDay(base);
  return base>=31&&base<daily.baseDays?Math.max(1,day-(state.daily?.flowerAdvance||0)):day;
}
function currentBand(bands,day=state.round) {
  return bands.filter(b => calendarDay(b[0]) <= day).at(-1);
}
function phase() { return currentBand(daily.phases); }
function stageIndex() { return state.daily?.workIndex ?? phase()[2]; }
function scoreReward(score) {return daily.reward.find(([minimum])=>score>=minimum)[1];}
function growthReading(atClose) {
  const knots = daily.curve;
  const past = knots.filter(k=>calendarDay(k[0]) <= state.round);
  const last = past.at(-1), firstToday = past.find(k=>calendarDay(k[0]) === state.round);
  const next = knots.find(k=>calendarDay(k[0]) > state.round);
  if (firstToday) return (atClose ? last : firstToday).slice(1);
  if (!next) return last.slice(1);
  const pct = (state.round-calendarDay(last[0]))/(calendarDay(next[0])-calendarDay(last[0]));
  return last.slice(1).map((v,i)=> v == null || next[i+1] == null ? null : Math.round(v+(next[i+1]-v)*pct));
}
function grow(atClose) {
  const d=state.daily, [leaves,height]=growthReading(atClose);
  const previous=d.growth?.leaves ?? daily.curve[0][1];
  if (previous !== leaves) delta('日-03','主蔓展葉',{leaves:leaves-previous});
  if (previous !== leaves || height !== d.growth?.height) log('日-03',atClose?'收工量測':'上午量測',{leaves,height});
  if((previous!==leaves||height!==d.growth?.height) && daily.curve.some(k=>calendarDay(k[0])===state.round)) d.logbook.push({day:state.round,text:(atClose?'收工':'上午')+'・'+leaves+' 葉'+(height==null?'':' ／ '+height+' cm')});
  if (atClose && previous !== leaves) d.evening = '第 '+state.round+' 天收工量到 '+leaves+' 葉、'+height+' cm。';
  d.growth={leaves,height:height==null?null:Math.round(height*(state.fruit?1:1+(d.heightBonus||0)))};
}
function unlockStage() {
  const d=state.daily, name=phase()[1];
  if (!d.visits.includes(name)) d.visits.push(name);
  const title=daily.milestones.find(([stage])=>stage===name)?.[1];
  if (!title) return;
  if (!d.known.includes(title)) d.known.push(title);
  const list=load('achievements',[]);
  if (!list.includes(title)) save('achievements',[...list,title]);
}
function deadline(task) {
  if(task.id==='prune') return calendarDay(task.from)+(task.to-task.from);
  if(task.id==='poll' && hasOverride(4)) return calendarDay(task.from);
  return calendarDay(task.to);
}
function taskGroups(task) {
  const groups=D.work[task.work][2];
  if(task.id==='poll')return groups.slice(0,1);
  if(task.id==='prune')return groups.map(([q,list])=>[q,list.map(([n,,k])=>[n,0,k])]);
  return task.id==='top'?groups.slice(0,1):task.id==='tie'?groups.slice(1):groups;
}
function dailyDraw() {
  const d=state.daily;
  state.cards=[];state.odds={};
  const exponent=D.rounds.count/state.days;
  const candidates=[];
  function rollCard(id,p,limit) {
    const prob = id in d.ongoing || (state.counts[id]||0)>=limit ? 0 : 1-(1-clamp(p,0,1))**exponent;
    state.odds[id]=prob;
    if (dice('每日新增'+id)<prob) candidates.push(id);
  }
  for(const [id,,risk] of D.events) {
    let p=D.risk[season().risk[risk]];
    if(risk===6)p*=T.resistance[cultivar().levels[6]-1];
    if(id==='weed'&&state.flags.clean)p*=T.cleanFactor;
    rollCard(id,p,D.rounds.repeat);
  }

  for(const id of candidates.sort((a,b)=>dice('抽'+a)-dice('抽'+b)).slice(0,D.rounds.cards)) {
    state.counts[id]=(state.counts[id]||0)+1;
    d.ongoing[id]={since:state.round,level:daily.pressureStart,treated:false};
  }
  state.cards=Object.keys(d.ongoing);
  log('日-09','今日新增及持續事件',{candidates,cards:[...state.cards],odds:{...state.odds}});
}
function newRound() {
  state.round++;
  state.step='round';state.form={};state.selection={};state.jobResults={};
  const d=state.daily;
  d.ap=daily.points;d.fed=false;d.water=null;d.open=null;
  for(const item of Object.values(d.ongoing))item.treated=false;
  for(const t of daily.tasks) {
    if(state.round===calendarDay(t.from)) d.tasks[t.id]={left:t.points,choices:taskGroups(t).map(()=>0),locked:false};
  }
  d.guardOffer=null;d.waterQuality=1;
  grow(false); unlockStage(); dailyDraw(); prepareDay(); checkpoint();
}
function scaleDelta(code,why,effects,scale) {
  delta(code,why,Object.fromEntries(Object.entries(effects).map(([k,v])=>[k,v*scale])));
}
function workResult(task,missed) {
  const d=state.daily, entry=d.tasks[task.id];
  const options=taskGroups(task).map(([,list],i)=>list[entry.choices[i]]);
  let keys=missed?D.skip[task.work]:options.map(o=>o[2]);
  if(task.id==='poll')keys=[options[0][2],entry.bees?'bee':'hand'];
  d.workIndex=task.work;d.currentQuality=entry.quality;
  try {
    decision(task.name+(missed?'／逾期':'／'+options.map(o=>o[0]).join('、')),()=>{
      if(task.id==='top'){
        if(!missed && keys.includes('top') && entry.quality>0)state.flags.topped=true;
        else delta('日-05','錯過摘心',T.effects.grow);
        if(state.flags.dirty)delta('P-7','摘心時剪刀未消毒',{virus:D.infection.dirty[1]});
        state.flags.topHandled=true;
      }else{
        if(task.id==='tie' && missed)keys=['strip','untied'];
        if(task.id==='prune' && entry.quality!=null && keys.includes('trim')) {
          scaleDelta('日-10','漏剪側芽',T.effects.keepBud,1-entry.quality);
        }
        applyWork(keys,missed);
      }
    });
  }finally{delete d.workIndex;delete d.currentQuality;}
  entry.done=true;d.completed.push(task.name+(missed?'（逾期）':''));
  d.logbook.push({day:state.round,text:task.name+(missed?'逾期':'完成')});
}
function taskPrice(task) {
  const entry=state.daily.tasks[task.id];
  if(entry.locked)return 0;
  return taskGroups(task).reduce((n,[,list],i)=>n+list[entry.choices[i]][1],0);
}
function advanceTask(id) {
  const t=daily.tasks.find(t=>t.id===id),d=state.daily,entry=d.tasks[id];
  if(!entry||entry.done||!d.ap||state.round>deadline(t))return;
  const price=taskPrice(t);
  if(price>state.coins)return;
  const spend=id==='poll'?farm.pollStep:chosenSpend(id,entry.left);
  if(!spend || spend>d.ap || (id==='poll'&&entry.played===state.round))return;
  if(!entry.locked){expense(price,t.name);entry.locked=true;}
  d.ap-=spend;entry.left-=spend;
  log('日-05',t.name,{spend,left:entry.left});
  if(entry.played===state.round)taskSession(t,entry,spend,entry.lastGain);
  else boardGame(t,{type:'task',id,spend});
}
function dailyFeed(i,gain=1){
  const d=state.daily,ratio=farm.formulas[i],price=feedPrice(i);
  if(!ratio||d.fed||d.ap<daily.applyAP||state.coins<price)return;
  expense(price,'追肥 '+ratio.join('：'));d.ap-=daily.applyAP;d.fed=d.fedThisSeason=true;
  ratio.forEach((n,j)=>{d.npk[j]=round(d.npk[j]+n*(.5+.5*gain));});
  d.message='已施用 '+ratio.join('：')+'，花了 '+price+' 金幣。';
}
function absorb(){
  const d=state.daily,[n,p,k]=d.npk;
  const factor=(v,i)=>clamp(v/farm.minimum[i],0,1);
  const floor=farm.minimum[0],bend=farm.diminishing;
  const nEffect=n<floor?(n-floor)/40:.4+(Math.min(n,bend)-floor)*.04+Math.log1p(Math.max(0,n-bend))*.035;
  delta('日-07','每日養分吸收',{vigor:nEffect,root:p>=farm.minimum[1]?.4*factor(p,1)+(p-farm.minimum[1])*.01:-(1-factor(p,1)),leaf:.02*nEffect,size:.08*(nEffect+factor(k,2)),sweet:.025*(k/farm.minimum[2]-1)});
  if(state.round<calendarDay(31)&&!hasOverride(4)){
    const speed=farm.speedLimit*clamp(state.stats.vigor/state.vmax,0,1);
    d.heightBonus=Math.min(farm.speedLimit,((d.heightBonus||0)*(state.round-1)+speed)/state.round);
    const target=Math.floor(baselineDay(31)*d.heightBonus/(1+d.heightBonus));
    d.flowerAdvance=Math.max(d.flowerAdvance||0,Math.min(target,baselineDay(31)-state.round-1));
  }
  d.npk=d.npk.map((v,i)=>round(Math.max(0,v-farm.uptake[i])));
  if(d.npk[0]<=farm.excess&&state.stats.vigor>state.vmax)delta('日-07','過旺消退',{vigor:state.vmax-state.stats.vigor});
}
function dailyTreat(id,index,gain=1) {
  const d=state.daily, ongoing=d.ongoing[id],event=D.events.find(e=>e[0]===id),opt=event?.[3][index];
  if(!ongoing||ongoing.treated||!opt||!eventAllowed(opt[2],id)||opt[2]==='pass')return;
  const [name,price,mode]=opt, cost=['spray','daily','material'].includes(mode)?daily.applyAP:1;
  if(d.ap<cost||state.coins<price)return;
  expense(price,name);d.ap-=cost;ongoing.treated=true;
  decision(event[1]+'／'+name,()=>{
    if(id.startsWith('pest')){scaleDelta('C-E',name,T.effects[mode]||{},gain);if(mode==='daily')state.flags.daily=true;}
    else if(gain>0 && !(id==='mildew'&&['spray','material'].includes(mode)))resolveEvent(id,mode);
  });
  ongoing.level=Math.max(0,Math.ceil(ongoing.level)-(id==='mildew'&&mode==='spray'?3:id==='mildew'&&mode==='material'?2:Math.round((daily.control[mode]??1)*gain)));
  ongoing.observed=ongoing.level;
  if(ongoing.level<=0 || (event[2]!==6 && gain>0))delete d.ongoing[id];
  d.message=(mode==='enemy'?D.copy.enemy+' ':'')+(d.ongoing[id]?(gain>0?'今天有改善，明天還要再看看。':'這次處理效果有限，明天還要再看看。'):event[1]+'，已處理。');
  health();
}
function endEvents() {
  const d=state.daily;
  for(const [id,o] of Object.entries(d.ongoing)){
    if(id.startsWith('M-')){delete d.ongoing[id];continue;}
    const event=D.events.find(e=>e[0]===id);
    if(event[2]===6){
      if(!o.treated){
        const effect=id.startsWith('pest')?T.effects.ignoreBug:T.effects[id];
        scaleDelta('日-09',event[1]+'未處理',resisted(effect),o.level*D.rounds.count/state.days);
        if((state.round-o.since+1)%(farm.intervals[id]||farm.weedDays)===0)o.level=Math.min(id==='mildew'?4:5,Math.ceil(o.level)+1);
      }
    }else{
      resolveEvent(id,'pass');delete d.ongoing[id];
    }
    if(state.step==='result'||!health())return;
  }
}
function waterEffect() {
  const band=currentBand(daily.water),d=state.daily;
  if(!band||!state.fruit||state.round>=state.days)return;
  const [,target,kind]=band,actual=d.water??0, diff=actual-target;
  const i=daily.water.indexOf(band), end=calendarDay(daily.water[i+1]?.[0]??daily.baseDays);
  const scale=1/Math.max(1,end-calendarDay(band[0]));
  if(diff===0){
    if(kind==='sweet')scaleDelta('日-06','成熟期節水',T.effects.control,scale*(d.waterQuality??1));
    if(d.waterQuality<1 && kind!=='sweet')scaleDelta('日-06','灌水操作偏差',kind==='net'?T.effects.dryNet:T.effects.dry6,scale*(1-d.waterQuality));
    return;
  }
  const wet=diff>0,net=kind==='net';
  let effects=kind==='sweet'?T.effects.normal:net?(wet?T.effects.wetNet:T.effects.dryNet):(wet?T.effects.wet6:T.effects.dry6);
  scaleDelta('日-06',phase()[1]+(wet?'偏濕':'偏乾'),effects,scale);
  if(cultivar().id==='glass')checkGlass();
  if(net && wet){d.badWater+=scale*Math.abs(diff);if(d.badWater+1e-8>=T.wetLimit)terminal('crack');}
  if(kind==='sweet' && wet && dice('每日裂果') < 1-(1-T.lateCrack)**scale)terminal('crack');
}
function closeDay() {
  if(state.step!=='round')return;
  const d=state.daily;
  for(const t of daily.tasks){
    const e=d.tasks[t.id];
    if(e&&!e.done&&state.round>=deadline(t)){workResult(t,t.id!=='poll'||!e.handPoints);if(state.step==='result')return;}
  }
  absorb();grow(true);endEvents();
  if(state.step==='result')return;
  if(state.round===calendarDay(daily.water[0][0])-1 && !d.fedThisSeason){
    scaleDelta('4-R1','未追肥',T.effects.skipFeed,state.flags.base==='太少'?2:1);
  }
  waterEffect();if(state.step==='result'||!health())return;
  const bucket=n=>Math.floor(n*D.rounds.count/state.days);
  if(bucket(state.round)>bucket(state.round-1))natural();
  if(state.step==='result')return;
  log('日-01','親自收工',{day:state.round,unused:d.ap});
  if(state.round>=state.days){
    if(!state.fruit){terminal('set');return;}
    const shift=harvestOptions()[d.harvestChoice??1];
    if(shift)delta('G-9','採收時機',shift<0?T.effects.early:T.effects.late);
    state.cut=dateAt(state.round+shift);harvest();
  }else{
    d.message=(d.evening||'昨天收工了。')+(Object.entries(d.ongoing).some(([id,o])=>!hiddenField(id)||o.seen)?'田裡還有狀況要追。':'今天再巡一圈。');
    d.evening='';
    newRound();
  }
}
function report(){
  return [state.soil===0?3:state.soil===5?6:0,state.soil===1?4:state.soil===2?5:1,state.soil===7?7:2].map((idx,i)=>{
    const [lo,hi]=daily.soilRanges[idx];
    return (lo+(hi-lo)*dice('土樣讀數'+i)).toFixed(i===1?2:1);
  });
}
function openFieldGame(kind){
  state.daily.fieldGame={kind,picks:[],errors:0};state.step='fieldGame';
}
function fieldScore(game) {
  const spec=daily.fieldGame[game.kind];
  if(spec.targets){
    const hit=game.picks.filter(i=>spec.targets.includes(i)).length;
    return Math.round(100*clamp((hit-game.errors)/spec.targets.length,0,1));
  }
  const correct=spec.labels.reduce((sum,_,i)=>sum+Math.min(spec.target,game.picks.filter(v=>v===i).length),0);
  return Math.round(100*correct/(spec.target*spec.labels.length));
}
function finishFieldGame(){
  const d=state.daily, g=d.fieldGame,score=fieldScore(g),gain=scoreReward(score);
  log('日-10',daily.fieldGame[g.kind].title,{score,reward:gain});
  d.lastScore=daily.fieldGame[g.kind].title+' '+score+' 分，完成獎勵 '+Math.round(100*gain)+'%。';
  delete d.fieldGame;
  if(g.kind==='sample'){
    state.testGuides=Math.ceil(gain*daily.soilGuide.length); state.step='amend';
  }else if(g.kind==='lime'){
    state.limeQuality=gain;
    decision('土壤改良／撒石灰',()=>amend(state.form));
  }else{
    state.step='round';d.tasks.prune.quality=gain;workResult(daily.tasks.find(t=>t.id==='prune'),false);
  }
}


const rev=D.daily.revision, farm=daily.farm;
function hiddenField(id){return id.startsWith('pest')||id==='mildew';}
function snapshot(){
  const d=state.daily;
  d.recording=true;d.reading={day:state.round,stats:{...state.stats},npk:[...d.npk],height:d.growth?.height,caption:appearance()};delete d.recording;
}
function inspectField(index){
  const d=state.daily;
  d.ap-=farm.inspectAP[index];d.inspected.push(index);
  if(!index)snapshot();
  const found=Object.entries(d.ongoing).filter(([id])=>hiddenField(id)&&(!index||id!=='mildew'));
  for(const [,o] of found){o.seen=true;o.observed=Math.ceil(o.level);}
  const insects=found.filter(([id])=>id.startsWith('pest')).map(([id,o])=>D.events.find(e=>e[0]===id)[1]+' '+farm.insect[o.observed]);
  const disease=found.find(([id])=>id==='mildew');
  d.message=rev.inspections[index]+'完成。'+(insects.join('、')||'黏紙上有 0 隻')+(!index?'。病斑 '+farm.spots[disease?.[1].observed||0]:'')+'。';
  d.logbook.push({day:state.round,text:d.message});
}
function weedWork(o){return Math.max(0,2**(Math.ceil(o.level)-1)-(o.cleared||0));}
function prepareDay(){
  const d=state.daily;
  if(!d.npk){d.npk=[...farm.nutrients];d.boardDay=null;
    const e=d.tasks.poll;if(e&&!e.done){e.left=farm.pollTotal;e.handPoints=0;}
  }
  if(!d.reading)snapshot();
  if(d.boardDay===state.round)return;
  d.boardDay=state.round;d.inspected=[];d.inspections=[0,1];
  let count=2,points=farm.inspectAP.reduce((a,b)=>a+b);
  for(const t of daily.tasks){
    const e=d.tasks[t.id];if(!e||e.done||taskPrice(t)>state.coins)continue;
    count++;points+=Math.min(t.id==='poll'?farm.pollStep:e.left,daily.points);
  }
  let jobs=0;
  for(const [id,o] of Object.entries(d.ongoing)){
    if(id.startsWith('M-')){jobs++;count++;points+=daily.jobAP;continue;}
    if(hiddenField(id)&&!o.seen)continue;
    const opts=D.events.find(e=>e[0]===id)?.[3].filter(([,p,m])=>p<=state.coins&&m!=='pass'&&eventAllowed(m,id));
    if(opts?.length&&!o.treated){count++;points+=id==='weed'?Math.min(weedWork(o),daily.points):1;}
  }
  const pool=D.jobs.filter(j=>!d.ongoing[j.id]&&j.enabled!==false).sort((a,b)=>dice(a.id+'班表')-dice(b.id+'班表'));
  while(pool.length&&(!jobs||count<rev.minimum||points<=daily.points)){
    const j=pool.pop();d.ongoing[j.id]={since:state.round,level:1};count++;points+=daily.jobAP;jobs++;
  }
  state.cards=Object.keys(d.ongoing);
}
function startArc(kind,context,variant=0){
  const descriptor=rev.games[kind]||rev.games.look;
  let [title,hint,mode,label]=descriptor;
  if(kind==='prune'){
    [title,mode]=rev.prune[variant%rev.prune.length];
    label='低節側芽';
    hint={slice:'劃過低節側芽，避開主蔓。',avoid:'點掉低節側芽，保留標記的留果枝。',memory:'記住要剪的位置，照順序剪掉側芽。',order:'從最低節開始，依序修剪標出的側芽。',timing:'側芽進入剪刀範圍時點一下。',find:'小心看看，找出漏剪的側芽。',trail:'沿主蔓由下往上，劃過亮起的側芽。'}[mode];
  }
  const recipe=rev.forms[kind]?.[variant%rev.forms[kind].length];
  if(recipe){[title,mode,hint,label]=recipe;}
  if(['feed','water','net','look'].includes(kind)){
    const route=rev.series[kind],form=route[variant%route.length];
    [title,mode,hint,label]=form;
    if(kind==='look')title=rev.inspections[context.index]+'・'+title;
  }
  if(kind==='plane')title=rev.boss[Number(context.id.slice(-1))];
  const sequence=Array.from({length:9},(_,i)=>i).sort((a,b)=>dice(kind+variant+'位置'+a)-dice(kind+variant+'位置'+b));
  state.daily.arc={kind,context,variant,title,hint,mode,label,sequence,start:0,elapsed:0,hit:0,miss:0,marks:[],stage:0,values:[0,0,0],knob:0.5,player:[.5,.82],shots:[],hazards:[],nextShot:0,nextHazard:0,frame:0,goodTime:0,totalTime:0,power:1};
  state.step='arc';
}
function arcView(){
  const g=state.daily.arc;
  const part=g.context.span?'・第 '+(g.variant+1)+'／'+g.context.span+' 款':'';
  const clue=g.mode==='calendar'?row('授粉日',state.poll)+row('授粉至參考採收',Math.round((Date.parse(dateAt(state.days))-Date.parse(state.poll))/MS)+' 天'):g.mode==='guess'?field():'';
  return head('田間小遊戲'+part,g.title)+note(g.hint)+clue+(g.start?
    '<div class="arcStatus"><span id="arcClock"></span><span id="arcScore"></span></div><canvas id="farmCanvas" width="360" height="320" aria-label="'+escapeHTML(g.title)+'"></canvas><small>點選或滑動田區操作</small>':
    action('開始挑戰','arcStart',true));
}
function arcScore(g){
  if(['balance','net','depth'].includes(g.mode))return Math.round(100*g.goodTime/Math.max(rev.duration*.9,g.totalTime));
  const goal=arcGoal(g);
  return Math.round(100*clamp((g.hit-g.miss*.35)/goal,0,1));
}
function guardPosition(i,t){
  const angle=i*Math.PI/2,progress=(t*.29+i*.19)%1;
  return [.5+Math.cos(angle)*(.49-progress*.41),.5+Math.sin(angle)*(.49-progress*.41)];
}
function arcGoal(g){
  return ({paint:9,slice:5,avoid:5,memory:4,order:5,trail:5,timing:4,find:3,node:1,swap:3,portion:3,scale:2,pipes:3,clean:4,ridge:5,calendar:1,guess:1,guard:5,plane:10})[g.mode]||1;
}
function arcDays(task){return deadline(task)-calendarDay(task.from)+1;}
function boardGame(t,ctx){
  const variant=state.round-calendarDay(t.from);
  startArc(t.id,{...ctx,span:arcDays(t)},variant);
}
function arcTarget(g){
  return g.sequence[(g.stage+g.variant)%9];
}
function arcTime(g){return Math.max(0,(Date.now()-g.start)/1000);}
function oscillate(g,time){
  return .5+.34*Math.sin(time*(1.65+(g.variant%4)*.18)+g.variant);
}
function waterTarget(g,t){
  return g.mode==='depth'?.53+.19*Math.sin(t*1.15+g.variant):.32+.14*(g.context.value??1)+.05*Math.sin(t+g.variant);
}
function targetWidth(g){
  if(g.mode==='net')return cultivar().id==='glass'?.065:.105;
  return .14;
}
function bossX(g,t){
  const type=Number(g.context.id?.slice(-1))||0;
  return .5+(type===0?.32*Math.sin(t*2.4):type===1?.19*Math.sin(t*.8):.3*Math.sin(t*1.5));
}
function flyFrame(g,t,dt){
  const bx=bossX(g,t),type=Number(g.context.id.slice(-1));
  if(t>=g.nextShot){g.shots.push([g.player[0],g.player[1]-.05]);g.nextShot=t+.22;}
  if(t>=g.nextHazard){
    const aim=(g.player[0]-bx)*.29;
    for(const dx of (type===0?[aim]:type===1?[-.12,.12]:[-.19,aim,.19]))g.hazards.push([bx,.22,dx]);
    g.nextHazard=t+(type===0?.52:type===1?.74:.95);
  }
  for(const s of g.shots){s[1]-=dt*.94;if(s[1]<.24&&s[1]>.09&&Math.abs(s[0]-bx)<.105){g.hit++;s[1]=-1;}}
  g.shots=g.shots.filter(s=>s[1]>0);
  for(const b of g.hazards){b[0]+=b[2]*dt;b[1]+=dt*.47;if(Math.hypot(b[0]-g.player[0],b[1]-g.player[1])<.06){g.miss++;b[1]=2;}}
  g.hazards=g.hazards.filter(b=>b[1]<1.05);
}
function arcFrame(){
  if(state?.step!=='arc')return;
  const g=state.daily.arc;if(!g.start)return;
  const t=arcTime(g),dt=clamp(t-g.frame,0,.15);g.frame=t;
  if(['balance','net','depth'].includes(g.mode)){
    if(g.mode==='depth')g.knob=clamp(g.knob+dt*(held?.6:-.44),0,1);
    else g.knob=clamp(g.knob+dt*(g.mode==='net'?.19:.10)*Math.sin(t*(1.4+g.variant*.09)+g.variant+.7),0,1);
    g.totalTime+=dt;
    if(Math.abs(g.knob-waterTarget(g,t))<=targetWidth(g))g.goodTime+=dt;
  }
  if(g.mode==='plane')flyFrame(g,t,dt);
  if(t>=rev.duration||g.hit>=arcGoal(g)){finishArc();return;}
  drawArc(g,t);
  const clock=document.getElementById('arcClock'),score=document.getElementById('arcScore');
  if(clock)clock.textContent='剩 '+Math.ceil(rev.duration-t)+' 秒';
  if(score)score.textContent='操作 '+arcScore(g)+' 分';
}
function cellFor(x,y){return clamp(Math.floor(y/105),0,2)*3+clamp(Math.floor(x/120),0,2);}
function harvestOptions(){return [-T.harvestShift,0,T.harvestShift];}
function guessOptions(g){
  const kg=assess().kg;
  const gap=rev.guessGap;
  return Array.from({length:3},(_,i)=>Math.max(.05,kg+(i-g.sequence[0]%3)*gap).toFixed(2));
}
function cellText(g,i,t){
  const done=g.marks.includes(i),goal=arcGoal(g),pos=g.sequence.indexOf(i),right=arcTarget(g);
  switch(g.mode){
    case 'paint':return done?'已撒':'畦土';
    case 'slice':case 'avoid':return done?'剪好了':pos<goal?g.label:(pos%2?'留果枝':'主蔓');
    case 'memory':return g.marks.includes(i)?'完成':t<2.6&&pos<4?'記 '+(pos+1):g.label+' '+(i+1);
    case 'order':case 'trail':return done?'完成':pos<goal?(g.mode==='order'?'順序 '+(pos+1):(pos===g.stage?'◎ ':'○ ')+(pos+1)):'·';
    case 'find':return i===right?g.label:({select:'端正幼果',poll:'未開花苞',tie:'已固定',water:'正常水滴',seal:'壓好的膜',mildew:'健康葉',prune:'主蔓'})[g.kind]||'正常';
    case 'node':return i===g.sequence[0]?'第 25 節':'第 '+(16+pos)+' 節';
    case 'pipes':return i>=3&&i<6?((g.values[i-3]+g.sequence[i])%4===0?'━':'┃┏┓'[((g.values[i-3]+g.sequence[i])%4)-1]):i===0?'入口 ↘':i===8?'↘ 出口':'田埂';
    case 'portion':return i===0?'半勺':i===1?'整勺':i>=3&&i<=5?g.values[i-3]+'／'+(i-1)+' 份':'';
    case 'swap':return i<6?(g.marks.includes(i%3)?'已交換':i<3?'表土 '+(i+1):'底土 '+(i-2)):'';
    case 'scale':return i<3?'＋'+[1,2,4][i]+' 勺':i===4?g.values[0]+'／'+(5+g.stage+g.variant%3):i===6?'重秤':i===8?'送出':'';
    case 'clean':return i===8?'開水閘':g.marks.includes(i)?'已清':g.sequence.filter(k=>k!==8).slice(0,3).includes(i)?'殘株':'瓜苗';
    case 'ridge':return [0,2].includes(i)?'堆畦 '+g.values[i===0?0:1]+'/2':i===4?'挖通溝槽':'畦溝';
    case 'calendar':return i>=3&&i<6?dateAt(state.days+harvestOptions()[i-3]).slice(5):'';
    case 'guess':return i>=3&&i<6?guessOptions(g)[i-3]+' kg':'';
    case 'guard':return i===right?'害蟲':i===(right+4)%9?'天敵':i===4?'洋香瓜':'';
    default:return '';
  }
}
function drawFieldIcon(c,g,word,x,y){
  c.save();c.translate(x,y);c.lineWidth=2.7;c.lineCap='round';c.strokeStyle='#365a44';c.fillStyle='#829d64';
  const line=(...p)=>{c.beginPath();c.moveTo(p[0],p[1]);for(let k=2;k<p.length;k+=2)c.lineTo(p[k],p[k+1]);c.stroke();};
  const oval=(x,y,rx,ry,angle=0)=>{c.beginPath();c.ellipse(x,y,rx,ry,angle,0,Math.PI*2);c.fill();c.stroke();};
  if(g.kind==='prune'||g.kind==='mildew'||g.kind==='weed'||g.kind==='top'||g.kind==='tie'){
    line(-8,17,0,-15);if(!/完成|剪好了/.test(word)){line(-4,6,8,-2);oval(12,-5,12,5,-.5);}
    if(/主蔓|留果/.test(word)){oval(-9,-3,8,4,.5);if(word==='留果枝'){c.fillStyle='#c6a34d';oval(10,5,5,6);}}
    if(word.includes('病斑')){c.fillStyle='#f6f4e6';oval(10,-6,3,2);oval(16,-8,2,1);}
  }else if(g.kind==='select'){
    c.fillStyle='#96ad6f';oval(0,2,14,18);line(0,-15,3,-21,9,-22);
    if(word==='擦傷幼果'){c.strokeStyle='#955e38';line(-9,4,-2,1,2,4,8,0);}
  }else if(['paint','clean','swap','ridge','portion','memory','find','scale'].includes(g.mode)){
    c.fillStyle=word.includes('已')?'#b6b67e':'#c9ae79';oval(0,5,24,9);c.strokeStyle='#926f42';line(-14,5,13,3);
    if(g.mode==='paint'&&word==='已撒'){c.fillStyle='#fff9e1';for(let k=0;k<9;k++)c.fillRect(-16+k*4,1+(k%3)*3,3,2);}
    if(g.mode==='clean'&&!word.includes('清')){c.strokeStyle=word==='殘株'?'#996239':'#647f45';line(-7,1,-3,-10,7,-14);}
  }
  c.restore();
}
function drawArc(g,t){
  const canvas=document.getElementById('farmCanvas');if(!canvas)return;
  const c=canvas.getContext('2d'),w=360,h=320;
  c.fillStyle='#edf0d9';c.fillRect(0,0,w,h);
  function label(msg,x,y,size=18,col='#234f42'){c.fillStyle=col;c.font='bold '+size+'px sans-serif';c.textAlign='center';c.fillText(msg,x,y);}
  function dot(x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
  if(g.mode==='guard'){
    label('瓜',180,169,31);for(let i=0;i<4;i++){const [x,y]=guardPosition(i,t);const ally=(i+g.stage)%4===0;dot(x*w,y*h,23,ally?'#89bba4':'#df997a');label(ally?'天敵':'害蟲',x*w,y*h+5,14);}
    return;
  }
  if(g.mode==='plane'){
    c.fillStyle='#224c45';c.fillRect(0,0,w,h);
    for(let i=0;i<17;i++)dot((i*83)%w,(i*67+t*28)%h,2,'#90b592');
    const x=bossX(g,t)*w;label(g.title,x,30,16,'#fff4cd');label(['薊','蚜','粉'][Number(g.context.id.slice(-1))],x,69,40,'#ffbe77');
    for(let i=0;i<6;i++){const side=i%2?1:-1;c.beginPath();c.moveTo(x+side*12,49+Math.floor(i/2)*6);c.lineTo(x+side*(24+4*Math.sin(t*7)),40+Math.floor(i/2)*11);c.strokeStyle='#ffc18a';c.lineWidth=3;c.stroke();}
    for(const [x,y] of g.shots)dot(x*w,y*h,4,'#ffe896');
    for(const [x,y] of g.hazards){dot(x*w,y*h,8,'#ff9883');if(g.context.id==='pest1')label('蚜',x*w,y*h+5,12,'#533623');if(g.context.id==='pest2'){dot(x*w-5,y*h-4,3,'#fff');dot(x*w+5,y*h-4,3,'#fff');}}
    const [px,py]=g.player;label('✈',px*w,py*h+8,35,'#fff');return;
  }
  if(['balance','net','depth','timing'].includes(g.mode)){
    const timing=g.mode==='timing',target=timing?.5:waterTarget(g,t),width=timing?.15:targetWidth(g);
    if(g.mode==='depth'){
      c.fillStyle='#b99666';c.fillRect(0,51,360,79);c.strokeStyle='#765835';c.lineWidth=9;c.beginPath();
      for(let x=0;x<=360;x+=5){const y=51+78*waterTarget(g,t+(x-180)/135);if(x===0)c.moveTo(x,y);else c.lineTo(x,y);}c.stroke();
      c.fillStyle='#4f6253';c.fillRect(176,25,8,26+78*g.knob);label('耕刀',143,40,13);
    }
    if(g.kind==='poll'){for(let i=0;i<5;i++){const a=i*2*Math.PI/5,r=10+(1-Math.abs(oscillate(g,t)-.5)*2)*18;dot(180+r*Math.cos(a),76+r*Math.sin(a),14,'#e8bb4c');}dot(180,76,10,'#996b36');}
    if(g.kind==='net'){
      c.save();c.beginPath();c.ellipse(180,77,44,51,0,0,7);c.clip();c.fillStyle='#94ac65';c.fillRect(120,20,120,115);
      c.strokeStyle='#e0e7b2';c.lineWidth=2;
      for(let i=0;i<2+Math.floor(g.goodTime*2);i++){c.beginPath();c.moveTo(128+i*7,22);c.bezierCurveTo(200-i,83,130+i*4,88,150+i*8,133);c.stroke();}
      c.restore();
    }else if(g.kind!=='poll'&&g.mode!=='depth')label(timing?(Math.abs(oscillate(g,t)-.5)<width?'現在！':g.label):g.label,180,90,29);
    c.fillStyle='#ced5b6';c.fillRect(20,147,320,36);c.fillStyle='#83b98a';c.fillRect(20+320*(target-width),147,640*width,36);
    dot(20+320*(timing?oscillate(g,t):g.knob),165,10,'#9c592d');
    label(timing?'點一下抓時機':g.mode==='depth'?'按住下降　放開上升':'− 減少　　　　　增加 ＋',180,259);
    return;
  }
  for(let i=0;i<9;i++){
    const x=i%3*120,y=Math.floor(i/3)*105,word=cellText(g,i,t);
    c.fillStyle=g.marks.includes(i)?'#c3dcb3':i===g.selected?'#f4d790':'#faf7e9';c.fillRect(x+3,y+3,114,99);
    if(word){drawFieldIcon(c,g,word,x+60,y+34);label(word,x+60,y+76,word.length>6?14:19);}
  }
}
let held=false, lastArcCell=-1;
function playCell(g,i){
  const pos=g.sequence.indexOf(i),goal=arcGoal(g),t=arcTime(g);
  function mark(){if(g.marks.includes(i))return;g.marks.push(i);g.hit++;g.stage++;}
  switch(g.mode){
    case 'paint':if(g.marks.includes(i))g.miss++;else mark();break;
    case 'slice':case 'avoid':if(pos<goal)mark();else g.miss++;break;
    case 'memory':if(t<2.6)return;
    case 'order':case 'trail':if(pos===g.stage)mark();else if(!g.marks.includes(i))g.miss++;break;
    case 'find':case 'guard':if(i===arcTarget(g)){g.hit++;g.stage++;}else g.miss++;break;
    case 'node':if(pos===0)g.hit++;else g.miss++;break;
    case 'timing':if(t-(g.lastTap??-1)<.35)return;g.lastTap=t;if(Math.abs(oscillate(g,t)-.5)<.15)g.hit++;else g.miss++;break;
    case 'net':case 'balance':g.knob=clamp(g.knob+(i%3===0?-.065:.065),0,1);break;
    case 'pipes':if(i<3||i>5)return;g.values[i-3]++;g.hit=g.values.filter((v,j)=>(v+g.sequence[j+3])%4===0).length;break;
    case 'portion':if(i<2)g.power=i+1;else if(i>=3&&i<=5){const j=i-3;g.values[j]+=g.power;if(g.values[j]>i-1){g.values[j]=0;g.miss++;}g.hit=g.values.filter((v,j)=>v===j+2).length;}break;
    case 'swap':if(i>=6)return;if(i<3){g.selected=i;return;}if(g.selected===i-3&&!g.marks.includes(i-3)){g.marks.push(i-3);g.hit++;}else g.miss++;g.selected=null;break;
    case 'scale':if(i<3)g.values[0]+=[1,2,4][i];else if(i===6)g.values[0]=0;else if(i===8){if(g.values[0]===5+g.stage+g.variant%3){g.hit++;g.stage++;}else g.miss++;g.values[0]=0;}break;
    case 'clean':if(i===8&&g.hit===3)g.hit++;else if(g.sequence.filter(k=>k!==8).slice(0,3).includes(i))mark();else g.miss++;break;
    case 'ridge':if(i===0||i===2){const j=i===0?0:1;if(g.values[j]<2){g.values[j]++;g.hit++;}}else if(i===4&&g.hit===4)g.hit++;else g.miss++;break;
    case 'calendar':case 'guess':if(i<3||i>5)return;g.choice=i-3;g.hit=Number(g.mode==='calendar'?g.choice===1:g.choice===g.sequence[0]%3);finishArc();return;
  }
}
function arcPointer(ev){
  if(state?.step!=='arc'||!state.daily.arc.start||ev.target.id!=='farmCanvas')return;
  ev.preventDefault();const canvas=ev.target,r=canvas.getBoundingClientRect(),g=state.daily.arc;
  const x=clamp((ev.clientX-r.left)/r.width,0,.999),y=clamp((ev.clientY-r.top)/r.height,0,.999);
  if(ev.type==='pointerdown'){held=true;lastArcCell=-1;canvas.setPointerCapture(ev.pointerId);}
  if(!held)return;
  if(g.mode==='plane')g.player=[clamp(x,.04,.96),clamp(y,.3,.95)];
  else if(g.mode==='guard'&&ev.type==='pointerdown'){
    const i=[0,1,2,3].find(i=>{const [px,py]=guardPosition(i,arcTime(g));return Math.hypot(px-x,py-y)<.1;});
    if(i!=null){if((i+g.stage)%4===0)g.miss++;else{g.hit++;g.stage++;}}
  }
  else if(ev.type==='pointerdown'||['paint','trail','slice'].includes(g.mode)){
    const cell=cellFor(x*360,y*320);
    if(cell!==lastArcCell){lastArcCell=cell;playCell(g,cell);}
  }
  if(state.step==='arc'){persist();arcFrame();}
}
app.addEventListener('pointerdown',arcPointer);
app.addEventListener('pointermove',arcPointer);
window.addEventListener('pointerup',()=>{held=false;lastArcCell=-1;});
window.addEventListener('pointercancel',()=>{held=false;lastArcCell=-1;});


function soilQueue(){
  const f=state.form,d=state.daily;
  d.soilScores={};
  d.soilList=(f.improve||[]).map(i=>({key:String(i),kind:rev.soilKinds[i]}));
  if(f.clean)d.soilList.push({key:'clean',kind:'clean'});
  if(f.ridge)d.soilList.push({key:'ridge',kind:'ridge'});
  nextSoil();
}
function nextSoil(){
  const next=state.daily.soilList.shift();
  if(next)startArc(next.kind,{type:'soil',key:next.key});
  else{state.step='amend';decision('土壤改良',()=>amend(state.form));}
}
function soilQuality(key){return state.daily.soilScores?.[key]??(key===0?state.limeQuality:undefined)??1;}
function hirePrune(){
  const task=daily.tasks.find(t=>t.id==='prune'),entry=state.daily.tasks.prune;
  if(!entry||entry.done||state.round>deadline(task))return;
  const price=entry.left*rev.hirePerPoint;
  if(price>state.coins)return;
  expense(price,'整枝請工');entry.quality=((entry.earned||0)+entry.left)/task.points;
  entry.left=0;entry.locked=true;workResult(task,false);
  state.daily.message='已付 '+price+' 金幣，剩下的整枝今天完成。';
}
function taskSession(task,entry,spend,gain){
  if(task.id==='poll')entry.handPoints=Math.min(farm.pollTotal,(entry.handPoints||0)+spend);
  entry.earned=(entry.earned||0)+spend*gain;entry.quality=entry.earned/task.points;
  entry.played=state.round;entry.lastGain=gain;
  if(entry.left===0)workResult(task,false);
}
function finishArc(){
  if(state.step!=='arc')return;
  const d=state.daily,g=d.arc,ctx=g.context;
  if(!d.npk&&['task','water','feed','event','inspect'].includes(ctx.type))prepareDay();
  const score=arcScore(g),gain=scoreReward(score);
  clearInterval(timer);held=false;delete d.arc;state.step='round';
  const summary=g.title+' '+score+' 分，完成度獎勵 '+Math.round(gain*100)+'%。';
  d.lastScore=summary;log('日-10',summary,{kind:g.kind,variant:g.variant});
  switch(ctx.type){
    case 'soil':d.soilScores[ctx.key]=gain;nextSoil();break;
    case 'sow':state.step='nursery';decision('自己播種育苗',()=>sow(state.form));break;
    case 'sample':
      state.testGuides=Math.ceil(gain*daily.soilGuide.length);state.step='amend';break;
    case 'task':{
      const task=daily.tasks.find(t=>t.id===ctx.id);
      taskSession(task,d.tasks[ctx.id],ctx.spend,gain);break;
    }
    case 'feed':dailyFeed(ctx.value,gain);break;
    case 'water':if(d.water==null)d.ap--;d.water=ctx.value;d.waterQuality=gain;break;
    case 'event':dailyTreat(ctx.id,ctx.index,gain);
      if(g.kind==='plane'&&state.step!=='result')d.guardOffer=ctx.id;break;
    case 'guard':if(gain)money(Math.round(rev.guardBonus*gain),'黏紙守塔加分','bonus');break;
    case 'inspect':if(!d.npk)prepareDay();inspectField(ctx.index===3?1:Math.min(ctx.index,1));break;
    case 'calendar':
      d.harvestChoice=g.choice??1;d.calendarDone=true;
      if(state.fruit&&state.branch!=='other')startArc('guess',{type:'guess'});
      else closeDay();break;
    case 'guess':
      if(gain)money(rev.guessBonus,'猜瓜重彩蛋','bonus');
      closeDay();break;
  }
  persist();render();
}
function statsView(){
  const r=state.daily.reading,s=r.stats;
  const box=(title,v)=>'<div><small>'+title+'</small><b>'+v+'</b></div>';
  return '<small>上次植株紀錄 '+dateAt(r.day)+'・氮／磷／鉀 '+r.npk.map(Math.round).join('／')+'</small><div class="plantStats">'+box('生長勢',(r.npk[0]>farm.excess?'<strong style="color:#a82725">'+round(s.vigor)+'</strong>':round(s.vigor))+'／'+state.vmax)+box('根系',round(s.root)+'／'+rev.rootMax)+box('葉片數',round(s.leaves)+' 片')+box('葉片大小',round(s.leaf))+'</div>';
}
function extrasView(){
  const d=state.daily;
  const list=d.inspections||[];
  return (d.guardOffer?action('黏紙守塔・試玩加分關','guard'):'')+
    list.map(i=>'<article class="panel cardHead"><h3>'+rev.inspections[i]+'</h3>'+action(d.inspected.includes(i)?'今天已巡過':rev.inspections[i]+'・'+farm.inspectAP[i]+' 點','inspect:'+i,false,d.inspected.includes(i)||d.ap<farm.inspectAP[i])+'</article>').join('');
}

let menuPage='';
function star(v){return '★'.repeat(v)+'☆'.repeat(5-v);}
function varietyInfo(c,full){
  const props=[['甜度',0],['風味',1],['網紋',3],['果重',4]];
  return props.map(([label,i])=>row(label,star(c.levels[i]))).join('')+(full?note(c.reveal,'種植筆記')+row('適合定植',D.seasons.filter((s,i)=>c.pair[i]==='最適合').map(s=>s.name).join('、')||'依作期評估'):'');
}
function home(){
  const saved=load('game',null),planted=load('planted',[]),scores=Object.values(load('results',{}));
  const returnBtn=action('回主選單','mainMenu');
  let body='';
  if(menuPage==='origin')body=head('植日生','遊戲初衷')+note(daily.origin)+returnBtn;
  else if(menuPage==='awards') {
    const earned=load('achievements',[]);
    body=head('田間手記','成就')+(earned.length?earned.map(x=>row(x,'已達成')).join(''):'<p>第一株瓜走到開花，就會留下第一枚生長成就。</p>')+returnBtn;
  } else if(menuPage==='book')body=head('田間手記','瓜瓜圖鑑')+D.cultivars.map(c=>planted.includes(c.id)?'<details><summary>'+escapeHTML(c.name)+'</summary>'+varietyInfo(c,true)+'</details>':row(c.name,'還沒種過')).join('')+returnBtn;
  else body='<section class="cover"><div class="coverText"><div class="eyebrow">莿桐溫室　／　逐日試玩版</div><h1>今天來種瓜</h1><p class="lede">從一株苗，到一顆能送人的洋香瓜。<br>這季的溫室，換你每天來顧。</p><div class="dailyMenu">'+action('開始遊戲','new',true)+action('從上次開始','resume',false,!saved)+action('遊戲初衷','menu:origin')+action('成就','menu:awards')+action('瓜瓜圖鑑','menu:book')+'</div></div><div class="coverArt">'+art(true)+'</div></section><div class="footerLine"><span>每日收工・自動存檔</span><span>成功 '+scores.filter(s=>!s.fail).length+' 次 ／ 失敗 '+scores.filter(s=>s.fail).length+' 次</span></div>';
  app.innerHTML=menuPage?'<section class="screen">'+body+'</section>':body;
  document.getElementById('wallet').textContent='雲林・莿桐';
}
function wheelView(){
  const n=D.seasons.length, arc=360/n, turn=360*3-state.season*arc;
  const wheel=D.seasons.map((s,i)=>'<span style="--sector:'+i*arc+'deg">'+s.name+'</span>').join('');
  return head('開局 ／ 作期轉盤','這次，哪一天定植？')+'<div class="wheelFrame"><i aria-hidden="true">▼</i><div class="wheel '+(state.spun?'spun':'')+'" style="--end:'+turn+'deg">'+wheel+'</div></div>'+(state.spun?row('抽中的定植時段',season().name)+row('定植日',dateAt(0))+row('參考採收日',dateAt(state.days))+note(season().hint)+action('來挑種子','toCultivar',true):'<p class="center">八個時段，抽到的機會一樣。</p>'+action('轉動作期轉盤','spin',true));
}
function gameFieldView(){
  const g=state.daily.fieldGame,s=daily.fieldGame[g.kind];
  const total=s.targets?s.targets.length:s.labels.length*s.target;
  let keys=s.labels.map((name,i)=>{
    const used=g.picks.filter(x=>x===i).length,lock=!!s.targets&&used>0;
    return action(name+(used?' ×'+used:''),'sampleTap:'+i,false,lock||g.picks.length>=total);
  }).join('');
  return head('田間小遊戲',s.title)+note(s.hint)+'<div class="gardenTiles">'+keys+'</div>'+row('操作進度',g.picks.length+' ／ '+total)+action('完成這次操作','sampleDone',true,!g.picks.length);
}
function chosenSpend(id,left){
  const max=Math.min(state.daily.ap,left,daily.points);
  const el=document.getElementById('spend-'+id);
  return max?clamp(Math.floor(Number(el?.value)||Math.min(max,daily.workChunk)),1,max):0;
}
function spendSelect(id,left){
  const max=Math.min(left,state.daily.ap,daily.points);
  return max?'<label>這次投入 <select id="spend-'+id+'">'+Array.from({length:max},(_,i)=>'<option '+(i+1===Math.min(daily.workChunk,max)?'selected':'')+'>'+ (i+1)+'</option>').join('')+'</select> 點</label>':'';
}
function fieldTaskView(t){
  const d=state.daily,e=d.tasks[t.id],active=d.open===t.id,price=taskPrice(t);
  if(t.id==='poll'){
    const pts=e.handPoints||0,prob=(100*pts/farm.pollTotal).toFixed(1);
    return '<article class="panel"><h3>授粉</h3>'+row('最晚收工日','第 '+deadline(t)+' 天')+row('人工進度',pts+'／'+farm.pollTotal+' 點・著果率 '+prob+'%')+
      (e.locked?row('留果節位',taskGroups(t)[0][1][e.choices[0]][0]):opts('dailyOpt:poll:0',taskGroups(t)[0][1],e.choices[0],false,state.coins))+
      action(e.played===state.round?'今天已人工授粉':'人工授粉・4 點','advance:poll',true,e.played===state.round||d.ap<farm.pollStep)+
      action('改放蜜蜂・100 金幣','bees',false,state.coins<farm.beePrice)+'</article>';
  }
  return '<article class="panel"><div class="cardHead"><div><div class="tag">第 '+deadline(t)+' 天收工前</div><h3>'+t.name+'</h3></div>'+action(active?'收起':'查看工作','showTask:'+t.id)+'</div>'+row('剩餘工作量',e.left+' 點')+(active?taskGroups(t).map(([label,list],i)=>'<h3>'+label+'</h3>'+(e.locked?'<p>'+escapeHTML(list[e.choices[i]][0])+'</p>':opts('dailyOpt:'+t.id+':'+i,list,e.choices[i],false,state.coins-taskPrice(t)+list[e.choices[i]][1]))).join('')+spendSelect(t.id,e.left)+action('開始工作'+(price?'・付 '+price+' 金幣':''),'advance:'+t.id,true,!d.ap||price>state.coins)+(t.id==='prune'?action('請人完成・'+e.left*rev.hirePerPoint+' 金幣・0 點','hirePrune',false,state.coins<e.left*rev.hirePerPoint):''):'')+'</article>';
}
function eventView(id,o){
  const d=state.daily,job=D.jobs.find(j=>j.id===id);
  if(hiddenField(id)&&!o.seen)return '';
  if(id==='weed')return '<article class="panel"><h3>自家拔草・'+farm.weedNames[Math.ceil(o.level)-1]+'</h3>'+row('剩餘工作',weedWork(o)+' 點')+row('下次升級',Math.ceil(o.level)>=farm.weedNames.length?'已達最高等級':(farm.weedDays-(state.round-o.since)%farm.weedDays)+' 天後')+spendSelect('weed',weedWork(o))+action('拔草','homeWeed',false,!d.ap)+'</article>';
  if(job)return '<article class="panel"><div class="tag">今天的打工</div><h3>'+job.name+'</h3>'+action('去打工・'+daily.jobAP+' 點','dayJob:'+id,false,d.ap<daily.jobAP)+'</article>';
  const ev=D.events.find(r=>r[0]===id);
  const status=o.since===state.round?'今天發現':'已持續 '+(state.round-o.since+1)+' 天';
  const text=hiddenField(id)?'上次檢查 '+(id==='mildew'?farm.spots:farm.insect)[o.observed||1]:o.treated?'今天已處理，明天再看。':o.level>=daily.pressureMax?'情況嚴重':o.level>daily.pressureStart?'情況在加重':'巡田紀錄';
  return '<article class="panel"><div class="tag">'+status+'</div><h3>'+ev[1]+'</h3><p>'+text+'</p>'+ev[3].map(([n,p,mode],i)=>{
    if(mode==='pass'||!eventAllowed(mode,id))return '';
    const ap=['spray','daily','material'].includes(mode)?daily.applyAP:1;
    return action(n+'・'+ap+' 點'+(p?'・'+p+' 金幣':''),'treat:'+id+','+i,false,o.treated||d.ap<ap||state.coins<p);
  }).join('')+(id==='freeze'?'<p>收工時判定植株能不能撐住。</p>':'')+'</article>';
}
function dayView(){
  prepareDay();
  const d=state.daily,g=d.growth,band=currentBand(daily.water),open=daily.tasks.filter(t=>d.tasks[t.id]&&!d.tasks[t.id].done);
  const info='最近量測 '+Math.round(d.reading.stats.leaves)+' 葉'+(d.reading.height!=null?'・株高 '+d.reading.height+' cm':'');
  // 上方文字與最近巡田同步
  const stage=phase()[1];
  let h='<div class="eyebrow">逐日田間手記　／　'+dateAt(state.round)+'</div><div class="dayHead"><h2>第 '+state.round+' 天</h2><span class="seasonTag">'+stage+'</span></div><div class="track"><i style="width:'+Math.min(100,state.round/state.days*100)+'%"></i></div>'+statsView()+field()+'<div class="dayMeta">'+escapeHTML(info)+'</div>';
  if(d.message)h+='<p class="dayMsg" role="status">'+escapeHTML(d.message)+'</p>';
  if(open.length)h+='<h3>田裡的工作</h3>'+open.map(fieldTaskView).join('');
  if(Object.keys(d.ongoing).length)h+='<h3>巡田發現</h3>'+Object.entries(d.ongoing).map(([id,o])=>eventView(id,o)).join('');
  if(band&&state.round<state.days)h+='<div class="panel"><div class="tag">'+stage+'</div><h3>今天的水量</h3>'+daily.waterNames.map((n,i)=>action((d.water===i?'✓ ':'')+n,'water:'+i,d.water===i,d.water==null&&!d.ap)).join('')+'<small>用 1 點調整，收工前可改。沒安排就按節水結算。</small></div>';
  h+=extrasView();
  if(state.round<state.days)h+='<details class="panel" '+(d.feedOpen?'open':'')+'><summary>施肥</summary><p>今天還能施肥'+(d.fed?' 0':' 1')+' 次，每次 '+daily.applyAP+' 點。</p>'+farm.formulas.map((ratio,i)=>{const p=feedPrice(i);return action(ratio.join('：')+'・'+p+' 金幣','feed:'+i,false,d.fed||d.ap<daily.applyAP||p>state.coins);}).join('')+'</details>';
  if(d.logbook.length)h+='<details><summary>田間紀錄</summary>'+d.logbook.slice().reverse().map(x=>row('第 '+x.day+' 天',x.text)).join('')+'</details>';
  if(d.lastScore)h+='<small>'+escapeHTML(d.lastScore)+'</small>';
  if(state.round>=state.days)h+=note('翻一下授粉紀錄，今天切開看看。');
  h+='<div class="clockOut"><span>行動點 <b>'+d.ap+' ／ '+daily.points+'</b></span>'+action(state.round>=state.days?'收工並採收':'今天收工','closeDay',true)+'</div>'+action('存檔回主選單','mainMenu');
  return h;
}
function feedPrice(i){
  const list=D.work[4][2][0][1];
  return [list[0][1],list[1][1],list[1][1]+D.cost.extra][i];
}
function screen(){
  const d=state.daily;
  if(state.step==='arc')return arcView();
  if(state.step==='round')return dayView();
  if(state.step==='season')return wheelView();
  if(state.step==='fieldGame')return gameFieldView();
  if(state.step==='cultivar'){
    const i=state.form.pick,c=D.cultivars[i],known=load('planted',[]);
    let h=head('定植 ／ '+season().name,'挑一包種子')+'<div class="varieties">'+D.cultivars.map((v,i)=>action(v.name,'pick:'+i)).join('')+'</div>';
    if(c&&state.preview)h+='<div class="sheetBack"><section class="seedSheet" role="dialog" aria-modal="true" aria-label="種子預覽"><div class="tag">種子預覽</div><h2>'+c.name+'</h2>'+varietyInfo(c,known.includes(c.id))+action('選這包種子','plant',true)+action('再看看','hideSeed')+'</section></div>';
    else if(c)h+=action('選 '+c.name,'plant',true);
    return h;
  }
  let h=baseScreen();
  if(state.step==='amend' && state.test){
    const guide=daily.soilGuide.slice(0,state.testGuides||0).join(' ／ ');
    h=h.replace('</section>','<small>'+escapeHTML(d.lastScore||'')+'</small>'+(guide?'<p>檢驗參考範圍　'+guide+'</p>':'')+'</section>');
  }
  if(state.step==='result')h=row('本季進度',state.round?'第 '+state.round+' 天・'+phase()[1]:'定植準備')+(d.known.length?row('這季走到的成就',d.known.join('、')):'')+h+action('回主選單','mainMenu');
  return h;
}
let lastClose=-Infinity;
function dailyAction(id,arg){
  if(id==='menu'||id==='mainMenu'){menuPage=id==='menu'?arg:'';state=null;render();return true;}
  if(!state)return false;
  const d=state.daily;
  if(state.step==='mini'&&id==='market'){marketTap(state.mini,Number(arg));return true;}
  if(state.step==='arc'){
    if(id==='arcStart'&&!d.arc.start){d.arc.start=Date.now();held=false;persist();render();}return true;
  }
  if(id==='spin'&&state.step==='season')state.spun=true;
  else if(id==='hideSeed')state.preview=false;
  else if(id==='sampleTap'&&state.step==='fieldGame'){
    const g=d.fieldGame,s=daily.fieldGame[g.kind],i=Number(arg),total=s.targets?s.targets.length:s.target*s.labels.length;
    if(!Number.isInteger(i)||!s.labels[i]||g.picks.length>=total||(s.targets&&g.picks.includes(i)))return true;
    g.picks.push(i);
    if(s.targets&&!s.targets.includes(i))g.errors++;
  }else if(id==='sampleDone'&&state.step==='fieldGame'&&d.fieldGame.picks.length)finishFieldGame();
  else if(state.step==='round'){
    if(id==='closeDay'){
      if(performance.now()-lastClose<330)return true;
      lastClose=performance.now();
      if(state.round===state.days&&!d.calendarDone)startArc('harvest',{type:'calendar'});else closeDay();
    }else if(id==='showTask')d.open=d.open===arg?null:arg;
    else if(id==='advance')advanceTask(arg);
    else if(id==='bees'){
      const t=daily.tasks.find(x=>x.id==='poll'),e=d.tasks.poll;
      if(!e||e.done||state.round>deadline(t)||state.coins<farm.beePrice)return true;
      expense(farm.beePrice,'授粉／放蜂');e.bees=true;e.left=0;workResult(t,false);
    }else if(id==='hirePrune')hirePrune();
    else if(id==='guard'&&d.guardOffer){d.guardOffer=null;startArc('guard',{type:'guard'});}
    else if(id==='inspect'){const index=Number(arg);if(d.ap>=farm.inspectAP[index]&&d.inspections.includes(index)&&!d.inspected.includes(index))startArc('look',{type:'inspect',index},state.round-1);}
    else if(id==='feed'){const value=Number(arg);if(!d.fed&&d.ap>=daily.applyAP&&state.coins>=feedPrice(value))startArc('feed',{type:'feed',value,span:state.days-1},state.round-1);}
    else if(id==='water'){
      if(d.water==null && d.ap){
        const band=currentBand(daily.water),i=daily.water.indexOf(band),start=calendarDay(band[0]);
        startArc(band[2]==='net'?'net':'water',{type:'water',value:Number(arg),span:calendarDay(daily.water[i+1]?.[0]??daily.baseDays)-start},state.round-start);
      }else if(d.water!=null)d.water=Number(arg);
    }else if(id==='treat'){const [id,i]=arg.split(',');const e=d.ongoing[id];if(e&&!e.treated)startArc(id.startsWith('pest')?'plane':id,{type:'event',id,index:Number(i)},state.round-e.since);}
    else if(id==='homeWeed'){
      const o=d.ongoing.weed;if(!o||!d.ap)return true;
      const spend=chosenSpend('weed',weedWork(o));d.ap-=spend;
      startMini('homeWeed');state.mini.spend=spend;
    }else if(id==='dayJob'){
      if(!d.ongoing[arg]||d.ap<daily.jobAP)return true;
      d.ap-=daily.jobAP;delete d.ongoing[arg];startMini(arg);
    }else return false;
  }else return false;
  persist();render(['closeDay','spin','sampleDone','dayJob'].includes(id)||state.step==='result');return true;
}

app.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const [id, arg] = btn.dataset.act.split(':');
  let scroll = true;
  if (dailyAction(id,arg)) return;
  switch (id) {
    case 'new':
      if (load('game', null)?.step && load('game', null)?.step !== 'result' && !confirm('另開一局會取代這個逐日版存檔，確定嗎？')) return;
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
      state.preview = true;
      scroll = false;
      break;
    case 'plant':
      state.preview = false;
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
      startArc('sow',{type:'sow'});
      break;
    case 'test':
      if (state.step !== 'soil' || state.coins < D.cost.test) return;
      soilTest(true);
      startArc('sample',{type:'sample'});
      break;
    case 'noTest':
      soilTest(id === 'test');
      break;
    case 'amend':
      soilQueue();
      break;
    case 'loosen':
      checkpoint();
      startMini('soil');
      break;
    case 'miniStart':
      state.mini.start = Date.now();if(D.jobs.find(j=>j.id===state.mini.kind)?.questions)marketRound(state.mini);
      break;
    case 'noBase':
      decision('本季不施基肥', omitFert);
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
  if (k.startsWith('dailyOpt:')) {
    const [,id,j] = k.split(':');
    if (state.daily.tasks[id].locked) return;
    state.daily.tasks[id].choices[Number(j)] = Number(el.value);
    persist(); render(false); return;
  }
  const v = Number(el.value);
  if (k === 'improve') {
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
let packing=false;
app.addEventListener('pointerdown',ev=>{if(ev.target.closest('.packShape')){ev.preventDefault();packing=true;ev.target.setPointerCapture(ev.pointerId);}});
app.addEventListener('pointerup',ev=>{
  if(!packing)return;packing=false;
  const el=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-pack]');
  if(el&&state?.mini?.kind==='M-11')marketTap(state.mini,Number(el.dataset.pack));
});
app.addEventListener('pointercancel',()=>{packing=false;});
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
  if (swipe && state.mini && state.mini.index === swipe.wave && (!['M-1','homeWeed'].includes(state.mini.kind) || swipe.y - ev.clientY > 12)) hit(swipe.slot);
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
