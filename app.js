"use strict";
// Port of the Dear ImGui "D&D Gamble Optimizer" to plain DOM + JS.

const RES = ["Neutral", "Resistance", "Immunity", "Vulnerability"]; // indices match C++ enum
const AC_MIN = 8, AC_ROWS = 23;

const newDie = () => ({ n: 1, f: 6, bonus: 0, res: 0, weapon: false, gwf: false, pierce: false });
const newAttack = () => ({ hitBonus: 0, numberPerTurn: 1, diceTypes: 1, dice: [newDie()] });
const newBonus = () => ({ size: 6, count: 0, res: 0 });

const S = {
  hitDrop: 5, damageBump: 10,
  crit19: false, crit18: false, critALL: false,
  reroll1: false, brutalCriticals: 0, savageAttacks: false,
  greatWeaponFighting: false, piercer: false, savageAttacker: false,
  attackCount: 0, attacks: [],
  bonusTypes: 0, bonus: [],
  trials: 10000,
  table: Array.from({ length: AC_ROWS }, () => Array(6).fill(0)),
  conclusions: Array(AC_ROWS).fill(""),
  status: "",
};
let activeTab = "General";

// ---------------------------------------------------------------- simulation
const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function resistanceMod(x, r) {
  switch (r) {
    case 1: return Math.trunc(x / 2); // resistant
    case 2: return 0;                 // immune
    case 3: return x * 2;             // vulnerable
    default: return x;
  }
}

// st = {brutal, savage} and pierce = {v} are passed by reference, like the C++ bool&
function damageRoll(faces, count, res, bonus, isCrit, gamble, st, isWeapon, pierce, gwf) {
  let sum = 0;
  const rollOne = (div) => {
    let r = rint(1, faces);
    if (isWeapon) {
      if (gwf && (r === 1 || r === 2)) r = rint(1, faces);
      if (pierce.v && r < Math.floor(faces / div)) { r = rint(1, faces); pierce.v = false; }
      if (st.savage && r < Math.floor(faces / div)) { r = rint(1, faces); st.savage = false; }
    }
    return r;
  };
  for (let i = 0; i < count; i++) sum += rollOne(2);
  if (isCrit) {
    let total = (isWeapon && st.brutal) ? count + S.brutalCriticals : count;
    st.brutal = false;
    if (isWeapon && S.savageAttacks) total++;
    if (isWeapon && S.piercer) total++;
    for (let i = 0; i < total; i++) sum += rollOne(3);
  }
  sum += bonus;
  if (gamble) sum += S.damageBump;
  return resistanceMod(sum, res);
}

function runSimulation() {
  const trials = Math.max(1, S.trials | 0);
  let critrange = 20 - Number(S.crit19) - Number(S.crit18);

  for (let ac = AC_MIN; ac < AC_MIN + AC_ROWS; ac++) {
    for (let column = 0; column < 6; column++) {
      const gamble = column % 2 === 1;
      let agg = 0;
      for (let t = 0; t < trials; t++) {
        const st = { brutal: S.brutalCriticals > 0, savage: S.savageAttacker };
        const pState = { v: S.piercer };
        let hit = false, critFirst = false;

        const dealDamage = (atk, isCrit) => {
          let dmg = 0;
          for (let d = 0; d < atk.diceTypes; d++) {
            const die = atk.dice[d];
            const pr = { v: pState.v && die.pierce };
            dmg += damageRoll(die.f, die.n, die.res, die.bonus, isCrit, gamble && d === 0,
                              st, die.weapon, pr, die.gwf);
            if (!pr.v && pState.v) pState.v = false;
          }
          return dmg;
        };

        for (let a = 0; a < S.attackCount; a++) {
          const atk = S.attacks[a];
          for (let k = 0; k < atk.numberPerTurn; k++) {
            let dieRoll = rint(1, 20);
            if (column >= 4) dieRoll = Math.min(dieRoll, rint(1, 20));      // disadvantage
            else if (column >= 2) dieRoll = Math.max(dieRoll, rint(1, 20)); // advantage

            if (dieRoll === 1) {
              if (S.reroll1) dieRoll = rint(1, 20);
              else continue;
            }

            let attackDamage = 0;
            if (S.critALL) {
              critrange = ac;
              dieRoll += atk.hitBonus;
              if (gamble) dieRoll -= S.hitDrop;
            }
            if (dieRoll >= critrange) {
              attackDamage += dealDamage(atk, true);
              if (!hit) critFirst = true;
              hit = true;
            } else {
              dieRoll += atk.hitBonus;
              if (gamble) dieRoll -= S.hitDrop;
              if (dieRoll >= ac) {
                hit = true;
                attackDamage += dealDamage(atk, false);
              }
            }
            agg += attackDamage;
          }
        }

        // once-per-turn bonus dice (sneak attack, hunter's mark...), doubled on a first-hit crit
        const rollBonus = () => {
          let s = 0;
          for (let j = 0; j < S.bonusTypes; j++) {
            const b = S.bonus[j];
            for (let d = 0; d < b.count; d++) s += resistanceMod(rint(1, Math.max(1, b.size)), b.res);
          }
          return s;
        };
        if (hit) agg += rollBonus();
        if (critFirst) agg += rollBonus();
      }
      S.table[ac - AC_MIN][column] = Math.trunc((agg / trials) * 100) / 100;
    }

    const r = S.table[ac - AC_MIN];
    const [std, gmb, stdAdv, gmbAdv] = r;
    S.conclusions[ac - AC_MIN] =
      (gmb >= std && gmbAdv >= stdAdv) ? "Gamble" :
      (std >= gmb && stdAdv >= gmbAdv) ? "Standard" :
      (std >= gmb && gmbAdv >= stdAdv) ? "With Advantage" : "WTF?";
  }
}

// ---------------------------------------------------------------- UI helpers
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e[k] = v;
  }
  e.append(...kids);
  return e;
};
const sep = (t) => el("h3", {}, t);
const note = (t) => el("p", { class: "note" }, t);

function numField(label, obj, key, { min = -Infinity, rerender = false } = {}) {
  const input = el("input", {
    type: "number", step: 1, value: obj[key],
    onchange: () => {
      let v = parseInt(input.value, 10);
      if (Number.isNaN(v)) v = obj[key];
      obj[key] = Math.max(min, v);
      input.value = obj[key];
      if (rerender) render();
    },
  });
  return el("div", { class: "field" }, el("label", {}, label), input);
}
function checkField(label, obj, key, rerender = false) {
  const input = el("input", {
    type: "checkbox", checked: obj[key],
    onchange: () => { obj[key] = input.checked; if (rerender) render(); },
  });
  return el("div", { class: "field check" }, el("label", {}, input, label));
}
function selectField(label, obj, key) {
  const sel = el("select", { onchange: () => { obj[key] = parseInt(sel.value, 10); } },
    ...RES.map((r, i) => el("option", { value: i, selected: obj[key] === i }, r)));
  return el("div", { class: "field" }, el("label", {}, label), sel);
}

// ---------------------------------------------------------------- tabs
function generalTab(root) {
  root.append(
    sep("Martials only club"),
    note("Welcome to the D&D Gamble Optimizer!\nIf you are worried whether you should use Great Weapon Master/Sharpshooter\nagainst a particular Armor Class, this has you covered!\nYou can also use it as a general damage calculator\nagainst an AC by removing gamble penalties and buffs."),
    sep("Gamble Stats"),
    numField("To Hit Penalty", S, "hitDrop"),
    numField("Damage Bonus", S, "damageBump"),
    sep("Critical Range"),
    checkField("Crit on 19", S, "crit19"),
    checkField("Crit on 18", S, "crit18"),
    checkField("Crit on all hits", S, "critALL"),
    sep("Racial Abilities"),
    checkField("Halfling Lucky", S, "reroll1"),
    checkField("Half Orc Savage Attacks", S, "savageAttacks", true),
    sep("Class/Feat Abilities"),
    numField("Brutal Critical", S, "brutalCriticals", { min: 0, rerender: true }),
    checkField("Great Weapon Fighting", S, "greatWeaponFighting", true),
    checkField("Savage Attacker", S, "savageAttacker", true),
    checkField("Piercer", S, "piercer", true),
  );
}

function attacksTab(root) {
  root.append(
    sep("Bump those numbers up"),
    note("Declare attacks here, and how many times per turn they are used.\nThis application will always assume the first dice roll of the first attack is your weapon dice."),
    sep("Attacks"),
    numField("Number of attacks", S, "attackCount", { min: 0, rerender: true }),
  );
  while (S.attacks.length < S.attackCount) S.attacks.push(newAttack());

  const anyWeaponFeature = S.brutalCriticals > 0 || S.savageAttacker || S.savageAttacks || S.piercer || S.greatWeaponFighting;

  for (let i = 0; i < S.attackCount; i++) {
    const atk = S.attacks[i];
    root.append(
      sep(`Attack ${i + 1}`),
      numField("Number Per Turn", atk, "numberPerTurn", { min: 0 }),
      numField("To Hit Bonus", atk, "hitBonus"),
      numField("Dice Types", atk, "diceTypes", { min: 0, rerender: true }),
    );
    while (atk.dice.length < atk.diceTypes) atk.dice.push(newDie());

    for (let j = 0; j < atk.diceTypes; j++) {
      const d = atk.dice[j];
      root.append(
        el("div", { class: "dice-title" }, `Dice type ${j + 1}`),
        numField("Damage Bonus", d, "bonus"),
        numField("Number of Dice", d, "n", { min: 0 }),
        numField("Dice Faces", d, "f", { min: 1 }),
      );
      if (anyWeaponFeature) root.append(checkField("Weapon Damage", d, "weapon"));
      if (S.greatWeaponFighting) root.append(checkField("Great Weapon Fighting", d, "gwf"));
      if (S.piercer) root.append(checkField("Piercer", d, "pierce"));
      root.append(selectField("Resistance", d, "res"));
    }
  }
}

function bonusTab(root) {
  root.append(
    sep("One shot, one kill"),
    note("Once off damage added to only one attack, like sneak attack or hunters mark"),
    sep("Weapon Dice"),
    numField("Number of dice sets", S, "bonusTypes", { min: 0, rerender: true }),
  );
  while (S.bonus.length < S.bonusTypes) S.bonus.push(newBonus());
  for (let i = 0; i < S.bonusTypes; i++) {
    const b = S.bonus[i];
    root.append(
      sep(`Dice Set ${i + 1}`),
      numField("Dice Size", b, "size", { min: 1 }),
      numField("Dice Amount", b, "count", { min: 0 }),
      selectField("Resistance", b, "res"),
    );
  }
}

function buildTab(root) {
  const status = el("p", { class: "note" }, S.status);
  const trials = numField("Trials per Case", S, "trials", { min: 1 });
  const btn = el("button", { class: "build", onclick: () => {
    S.status = "Running simulation...";
    status.textContent = S.status;
    btn.disabled = true;
    setTimeout(() => {
      runSimulation();
      S.status = "Done.";
      btn.disabled = false;
      renderOutput();
      status.textContent = S.status;
    }, 30);
  } }, "Build!");
  root.append(sep("Put it together"), note("More trials will give more accurate information!"), trials, btn, status);
}

// ---------------------------------------------------------------- rendering
const TABS = { "General": generalTab, "Attacks": attacksTab, "1/Turn": bonusTab, "Build Table": buildTab };

function render() {
  const root = document.getElementById("settings");
  root.replaceChildren();
  const bar = el("div", { class: "tabs" },
    ...Object.keys(TABS).map((name) =>
      el("button", { class: name === activeTab ? "active" : "", onclick: () => { activeTab = name; render(); } }, name)));
  root.append(bar);
  TABS[activeTab](root);
}

function renderOutput() {
  const heads = ["AC", "Normal STD", "Gamble STD", "Normal ADV", "Gamble ADV", "Normal DIS", "Gamble DIS", "Gamble?"];
  const rows = S.table.map((r, i) =>
    el("tr", {}, el("td", {}, String(i + AC_MIN)), ...r.map((v) => el("td", {}, v.toFixed(2))), el("td", {}, S.conclusions[i])));
  document.getElementById("output").replaceChildren(
    el("table", {}, el("thead", {}, el("tr", {}, ...heads.map((h) => el("th", {}, h)))), el("tbody", {}, ...rows)));
}

render();
renderOutput();
