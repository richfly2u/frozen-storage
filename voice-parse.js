/* 語音指令解析引擎（純函式、無外部依賴，可單元測試）
   輸入：「香菇頭 一包」「移出素排骨兩袋」「放回當歸五包」「中藥區 當歸 一包」「我是陳師姐」
   輸出：{ action, name, qty, unit, floor, operatorName, match, score, raw }
   action: "out"（移出，預設）| "in"（置入）
*/

const CN_DIGIT = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 兩: 2, 貳: 2,
  三: 3, 參: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};

/* 單位：長的排前面（台兩 先於 兩） */
export const UNITS = ["台兩", "公斤", "包", "袋", "盒", "罐", "瓶", "斤", "兩", "份", "個", "顆", "條", "把", "箱", "桶", "捲", "片"];

const FILLERS = ["請幫我", "幫我", "請", "我要", "我", "要", "把", "的", "了", "一共", "總共", "共", "是", "啊", "喔", "吧", "嗎", "呢", "然後", "那個", "這個", "一下"];

const OUT_WORDS = ["拿出", "拿出來", "取出來", "移出來", "移出", "取出", "拿掉", "用掉", "扣掉", "扣", "少了", "減少", "消耗", "拿出", "拿", "取", "出"];
const IN_WORDS = ["放回去", "放回", "放進去", "放入", "置入", "補進去", "補進", "進貨", "補貨", "增加", "補", "放", "進", "加"];

const FLOOR_WORDS = [
  { id: 1, keys: ["中藥區", "中藥", "藥材區", "第一層", "第1層", "一樓", "上門上層"] },
  { id: 2, keys: ["餡料區", "餡料", "第二層", "第2層", "二樓", "上門下層"] },
  { id: 3, keys: ["素料區", "第三層", "第3層", "三樓", "下門上層"] },
  { id: 4, keys: ["第四層", "第4層", "四樓", "下門下層"] }
];

/* 全形→半形、去標點、壓空白 */
export function normalize(s) {
  return String(s == null ? "" : s)
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[，。、！？,.!?；;：:「」『』（）()【】《》]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* 中文數字 → 阿拉伯數字（支援 一 / 十二 / 二十 / 二十三 / 兩 / 一二三） */
export function cn2num(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^([零〇一壹二兩貳三參四五六七八九])?十([零〇一壹二兩貳三參四五六七八九])?$/);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  if (/^[零〇一壹二兩貳三參四五六七八九]+$/.test(t)) {
    return Number([...t].map(c => CN_DIGIT[c]).join(""));
  }
  const n = Number(t.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const stripAll = (t, words) => words.reduce((acc, w) => acc.split(w).join(" "), t);

/* 品項模糊比對：完全相等 > 互相包含 > 共同字元比例 */
export function matchItem(name, items) {
  const target = String(name || "").replace(/\s+/g, "");
  if (!target) return { item: null, score: 0 };
  let best = { item: null, score: 0 };
  for (const it of items || []) {
    const n = normalize(it.name).replace(/\s+/g, "");
    if (!n) continue;
    let sc = 0;
    if (n === target) sc = 100;
    else if (n.includes(target) || target.includes(n)) {
      sc = 70 + Math.min(20, Math.min(n.length, target.length) * 5) - Math.abs(n.length - target.length);
    } else {
      const common = [...new Set(target)].filter(c => n.includes(c)).length;
      sc = Math.round((common / Math.max(n.length, target.length)) * 60);
    }
    if (sc > best.score) best = { item: it, score: sc };
  }
  return best;
}

/* 主解析 */
export function parseUtterance(text, items) {
  const raw = String(text == null ? "" : text);
  let t = normalize(raw);
  const out = {
    raw, text: t, action: "out", name: "", qty: 1, unit: "",
    floor: null, operatorName: "", match: null, score: 0
  };
  if (!t) return out;

  /* 1. 「我是 XXX」→ 經手人 */
  const mOp = t.match(/我是\s*([^\s]{1,12})/);
  if (mOp) {
    out.operatorName = mOp[1].replace(/[，。、].*$/, "");
    t = t.replace(mOp[0], " ");
  }

  /* 2. 動作（先長詞） */
  const hitOut = OUT_WORDS.find(w => t.includes(w));
  const hitIn = IN_WORDS.find(w => t.includes(w));
  if (hitIn && (!hitOut || hitIn.length >= hitOut.length)) out.action = "in";
  else if (hitOut) out.action = "out";
  t = stripAll(t, OUT_WORDS);
  t = stripAll(t, IN_WORDS);

  /* 3. 樓層 */
  for (const f of FLOOR_WORDS) {
    const hit = f.keys.find(k => t.includes(k));
    if (hit) { out.floor = f.id; t = t.split(hit).join(" "); break; }
  }

  /* 4. 數量 + 單位（取第一組） */
  const reUnit = new RegExp(`(\\d+|[零〇一壹二兩貳三參四五六七八九十]+)\\s*(${UNITS.join("|")})?`);
  const mQ = t.match(reUnit);
  if (mQ) {
    const n = cn2num(mQ[1]);
    if (n != null) { out.qty = n; out.unit = mQ[2] || ""; t = t.replace(mQ[0], " "); }
  } else {
    /* 只講單位沒講數量：「香菇頭 包」→ 1 包 */
    const mU = t.match(new RegExp(`(${UNITS.join("|")})`));
    if (mU) { out.qty = 1; out.unit = mU[1]; t = t.replace(mU[0], " "); }
  }

  /* 5. 剩下的字＝品名（去掉語氣詞） */
  t = stripAll(t, FILLERS).replace(/\s+/g, " ").trim();
  out.name = t;

  /* 6. 模糊比對現有品項 */
  const m = matchItem(out.name, items);
  out.match = m.item;
  out.score = m.score;
  if (!out.name && m.item) out.name = m.item.name;
  return out;
}

export default { normalize, cn2num, matchItem, parseUtterance, UNITS };
