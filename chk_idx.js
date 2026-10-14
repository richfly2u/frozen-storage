

import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
         query, orderBy, limit, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================= 設定 ================= */
const COLL_ITEMS = "frozen_items";
const COLL_LOG   = "frozen_log";
/* 門別（上門／下門）；每扇門有幾層、叫什麼，看下面的 FLOORS */
const DOORS = [
  { key: "U", label: "上門" },
  { key: "D", label: "下門" }
];
/* 食材庫內建常備品項（拖進冰箱就建檔）
   ※ 一定要放在 renderMap() 首次執行之前（它會呼叫 renderOutside()），否則 TDZ 例外會讓整頁掛掉 */
const STAPLES = ["當歸", "枸杞", "紅棗", "豆包", "麵腸", "火腿", "素丸子", "牛蒡排", "鱈魚排",
                 "飯巾布", "麵線", "饅頭", "包子", "綠豆沙餡",
                 "小魚干", "紅糟麵腸", "黑豆", "花生仁", "大薏仁", "豆干", "大胖干",
                 "核桃", "腰果", "海帶芽", "味噌"];

/* 樓層：key 決定屬哪一扇門；同一扇門裡的先後順序決定「第幾層」（每扇門各自從第 1 層算）
   ※ id 是資料庫用的固定編號：新增樓層要給「沒用過的號碼」，不要動舊號碼，免得住錯位置 */
const FLOORS = [
  { id: 1, door: "上門", key: "U", name: "中藥 湯料 五穀堅果" },   /* 前賢：層名用空白分隔、不要標點 */
  { id: 2, door: "上門", key: "U", name: "素料/餡料" },
  { id: 5, door: "上門", key: "U", name: "素料" },
  { id: 3, door: "下門", key: "D", name: "其他/私人" },
  { id: 4, door: "下門", key: "D", name: "其他/粉類" }
];
/* 自動算「第幾層」與格位名稱（二層＝上/下格，三層＝上/中/下格） */
FLOORS.forEach(f => {
  const peers = FLOORS.filter(x => x.key === f.key);
  const n = peers.length, i = peers.indexOf(f);
  f.local = i + 1;
  f.slot = n === 2 ? ["上格", "下格"][i]
         : n === 3 ? ["上格", "中格", "下格"][i]
         : `第${i + 1}格`;
});
const floorOf = id => FLOORS.find(f => f.id === Number(id)) || { id: Number(id), name: "未指定", door: "", local: Number(id), slot: "" };
/* 層數：每扇門各自從第1層算起（上門＝1/2/3層、下門＝1/2層）；門名標在門牌（把手位置） */
const floorNo = id => { const f = floorOf(id); return f.local || Number(id); };
const floorLabel = id => { const f = floorOf(id); return `${f.door} 第${floorNo(id)}層`; };
const floorFull = id => { const f = floorOf(id); return `${floorLabel(id)} ${f.name}`; };

/* ================= Firebase ================= */
const app  = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);
let ready = false, items = [], editId = null, pendingHighlight = null, focusedFloor = null, outside = [], pendingPlace = null;
/* 搜尋：符合的品項標黃框、所在層框起來，其他變淡（renderMap 重建後會重新套用） */
let searchQ = "", searchHits = [];
function styleSearch() {
  document.querySelectorAll(".chip.hit,.os-chip.hit,.chip.dim,.os-chip.dim,.tier.sfocus")
    .forEach(el => el.classList.remove("hit", "dim", "sfocus"));
  const bar = document.getElementById("osHead");
  const t = searchQ;
  searchHits = [];
  if (!t) { if (bar) bar.classList.remove("hasQ", "noHit"); return; }
  document.querySelectorAll("#freezer .tier").forEach(tr => {
    let inThis = 0;
    tr.querySelectorAll(".chip").forEach(ch => {
      const nm = ch.dataset.name || ch.textContent.trim();
      if (nm.indexOf(t) >= 0) { ch.classList.add("hit"); inThis++; searchHits.push({ tier: tr.id, name: nm }); }
      else ch.classList.add("dim");
    });
    if (inThis) tr.classList.add("sfocus");
  });
  document.querySelectorAll(".outside .os-chip").forEach(ch => {
    const nm = ch.dataset.name || ch.textContent.trim();
    if (nm.indexOf(t) >= 0) { ch.classList.add("hit"); searchHits.push({ tier: "outside", name: nm }); }
    else ch.classList.add("dim");
  });
  if (bar) { bar.classList.add("hasQ"); bar.classList.toggle("noHit", searchHits.length === 0); }
}
/* 按 Enter：跳到第一個找到的位置（冰箱優先，其次食材庫） */
function gotoFirstHit() {
  if (!searchQ) return;
  styleSearch();
  const first = document.querySelector(".tier.sfocus");
  if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const os = document.querySelector(".outside .os-chip.hit");
  if (os) os.scrollIntoView({ behavior: "smooth", block: "center" });
  else toast("找不到「" + searchQ + "」");
}
/* ※ 這裡不能用 $()：$ 是後面才宣告的 const，會踩 TDZ 讓整個模組掛掉 */
const searchEl = document.getElementById("search"), searchClearEl = document.getElementById("searchClear");
searchEl.addEventListener("input", e => { searchQ = (e.target.value || "").trim(); styleSearch(); });
searchEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); gotoFirstHit(); } });
searchClearEl.addEventListener("click", () => {
  searchEl.value = ""; searchQ = ""; styleSearch(); try { searchEl.focus(); } catch (_) {}
});
/* 剛放進冰箱的層＋品項：不同顏色框 3 秒後恢復 */
let justInFloor = null, justInName = "", justInTimer = null;
function markJustIn(floor, name) {
  justInFloor = Number(floor) || null; justInName = name || "";
  if (justInTimer) clearTimeout(justInTimer);
  renderMap();
  justInTimer = setTimeout(() => { justInFloor = null; justInName = ""; justInTimer = null; renderMap(); }, 1500);   /* 前賢：置放閃爍 1.5 秒 */
}

/* ================= 小工具 ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}
function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return (sameYear ? "" : d.getFullYear() + "/") + `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sync(state, text) {
  const dot = $("#dot");
  dot.className = "dot" + (state === "on" ? " on" : state === "off" ? " off" : "");
  $("#syncTxt").textContent = text;
}

/* ================= 經手人（本機記憶，LINE 內建瀏覽器可能擋 localStorage → 退回記憶體） ================= */
const memStore = {};
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return memStore[k] || ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } }
};
let operator = store.get("frozen_operator");
/* 是否顯示經手人（預設不顯示；用左欄開關控制）
   ※ 宣告位置必須在 renderMap() 首次執行之前，且 store 已定義 */
let showBy = store.get("frozen_showby") === "1";
function byHistory() {
  const saved = (store.get("frozen_bys") || "").split("|").filter(Boolean);
  const used = items.map(i => i.by).filter(Boolean);
  return Array.from(new Set([...used, ...saved]));
}
function refreshByList() {
  $("#byList").innerHTML = byHistory().map(n => `<option value="${esc(n)}"></option>`).join("");
}
function renderOperator() {
  $("#opName").textContent = operator || "未填";        /* 手機版空間小，只寫「未填」 */
  $("#opName").title = operator ? `目前經手人：${operator}（按「修改」可換人）` : "第一次操作時會請您輸入姓名，填一次就記住這台裝置";
  const bar = document.querySelector(".opbar");
  if (bar) { bar.classList.toggle("need", !operator); bar.style.display = operator ? "" : "none"; }  /* 沒填過經手人（例如掃碼來看位置的人）就把這條藏起來 */
}
function setOperator(v) {
  operator = (v || "").trim();
  store.set("frozen_operator", operator);
  if (operator) rememberBy(operator);
  renderOperator();
}
function rememberBy(name) {
  if (!name) return;
  const arr = (store.get("frozen_bys") || "").split("|").filter(Boolean);
  if (!arr.includes(name)) arr.unshift(name);
  store.set("frozen_bys", arr.slice(0, 30).join("|"));
  refreshByList();
}
renderOperator();
/* ============ 經手人提醒：第一次要操作前先問一次，填過就記住這台裝置 ============ */
let opThen = null;
function ensureOperator(then) {
  if (operator) return true;                      // 已經填過 → 直接放行（不再問）
  opThen = typeof then === "function" ? then : null;
  $("#opInput").value = "";
  $("#opMask").classList.add("on");
  setTimeout(() => { try { $("#opInput").focus(); } catch (e) {} }, 90);
  return false;                                   // 對話框本身已經寫清楚，不再跳提示蓋住按鈕
}
function closeOpDialog() { $("#opMask").classList.remove("on"); }
function submitOperator() {
  const v = ($("#opInput").value || "").trim();
  if (!v) { toast("請輸入姓名"); return; }
  setOperator(v);
  closeOpDialog();
  toast("經手人：" + v + "（已記住，之後不用再輸入）");
  const f = opThen; opThen = null;
  if (f) f();
}
$("#opOk").addEventListener("click", submitOperator);
$("#opInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submitOperator(); } });
$("#opMask").addEventListener("click", e => { if (e.target.id === "opMask") closeOpDialog(); });
$("#btnOp").addEventListener("click", () => {
  $("#opInput").value = operator || "";
  $("#opMask").classList.add("on");
  setTimeout(() => { try { $("#opInput").select(); } catch (e) {} }, 90);
});
/* 顯示／隱藏經手人（預設隱藏） */
$("#showBy").checked = showBy;
$("#showBy").addEventListener("change", e => {
  showBy = !!e.target.checked;
  store.set("frozen_showby", showBy ? "1" : "0");
  renderMap();
  toast(showBy ? "已顯示經手人" : "已隱藏經手人");
});

/* LINE 內建瀏覽器提示 */
if (/Line\/|LIFF/i.test(navigator.userAgent)) {
  $("#lineTip").classList.add("on");
  const sd = document.querySelector(".side"); if (sd) sd.classList.add("show");

}



/* ================= 匿名登入，自動） ================= */
sync("", "連線中…");
onAuthStateChanged(auth, user => {
  if (user) { ready = true; sync("on", "已連線・即時同步"); listen(); }
  else {
    signInAnonymously(auth).catch(e => {
      console.error("匿名登入失敗", e);
      sync("off", "離線（僅檢視）");
      toast("無法連線雲端：" + (e && e.code ? e.code : e.message));
    });
  }
});

/* ================= 即時同步 ================= */
let unsubItems = null;
function listen() {
  if (unsubItems) return;
  unsubItems = onSnapshot(query(collection(db, COLL_ITEMS), orderBy("name")), snap => {
    items = snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
    /* 前賢：移到哪就待在哪，不要因為更新／改名就跳到該層第一位。
       順序改成「加入冰箱的先後」（createdAt），同一時間才用 id 當次序，永遠穩定。 */
    items.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
      || String(a._id).localeCompare(String(b._id)));
    renderMap();
  }, err => { console.error(err); sync("off", "讀取失敗"); toast("讀取失敗：" + err.code); });
}

/* ================= 位置圖 ================= */
function tierHTML(fid) {
  const f = floorOf(fid);
  /* 只顯示冰箱裡還有的（數量 0 的用完品項不顯示） */
  const list = items.filter(i => Number(i.floor) === fid && (Number(i.qty) || 0) > 0);
  /* 前賢：每層有幾項不用顯示，只顯示層名 + 品項名稱 */
  /* 前賢 2026-10-05：每層只留「第N層 ＋ 分類內容」一行（原本分類另外顯示在上方，現移到層數那） */
  /* 前賢 2026-10-07：層號(第N層＋層名)原本排在品項後面、被擠到該層最底部，緊鄰下面那扇門，
     看起來像「上門第3層跑到下門」→ 改成該層的標題列放在最上面，品項接在它下面 */
  return `<div class="tier" id="tier-${fid}" data-floor="${fid}" data-door="${f.key}">
      <span class="tier-no">第${floorNo(fid)}層 ${esc(f.name)}</span>
      <div class="items">
        ${list.length ? list.map(chipHTML).join("") : '<span class="empty">＋ 放入</span>'}
      </div>
    </div>`;
}

function renderMap() {
  const box = $("#freezer");
  const doors = DOORS.map(d => ({ ...d, floors: FLOORS.filter(f => f.key === d.key).map(f => f.id) }));
  box.innerHTML = `
    <div class="doors">
      ${doors.map(d => `
        <section class="door" data-door="${d.key}">
                    <div class="door-head">${d.label}</div>
          <div class="shelves">${d.floors.map(tierHTML).join("")}</div>
        </section>`).join("")}
    </div>`;

  box.querySelectorAll(".chip").forEach(el => {
    const it = items.find(i => i._id === el.dataset.id);
    if (it) bindChipGestures(el, it);
  });
  /* 選了食材庫的食材後，點某一層＝放進那一層 */
  box.querySelectorAll(".tier").forEach(t => t.addEventListener("click", ev2 => {
    if (!pendingPlace || (ev2.target.closest && ev2.target.closest(".chip"))) return;
    const fid = Number(t.dataset.floor);
    const entry = pendingPlace;
    putBack(entry, fid);
  }));
  refreshByList();
  renderOutside();   /* 食材庫跟著資料更新：用完／已移出的會自動列進去 */
  styleSearch();   /* 重建後把搜尋的黃框／淡出補回來 */
  /* 上下門依「各有幾層」比例分配高度（上門3層會比下門2層高一些，每層才塞得下） */
  box.querySelectorAll(".door").forEach(d => { d.style.flexGrow = String(d.querySelectorAll(".tier").length || 1); });
  /* 重繪後把焦點框補回來（語音/掃碼指定的樓層） */
  if (focusedFloor != null) {
    const ft = box.querySelector(`.tier[data-floor="${focusedFloor}"]`);
    if (ft) ft.classList.add("focus");
  }
  /* 語音/編輯更新後，讓剛動到的品項閃一下 */
  if (pendingHighlight) {
    const el = box.querySelector(`.chip[data-id="${pendingHighlight}"]`);
    if (el) {
      el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), 2600);
      pendingHighlight = null;
    }
  }
  /* 剛放進冰箱：該層綠框、剛放進去的品項橘框，3 秒後恢復 */
  if (justInFloor != null) {
    const jt = box.querySelector(`.tier[data-floor="${justInFloor}"]`);
    if (jt) {
      jt.classList.add("justIn");
      if (justInName) {
        const jc = jt.querySelector(`.chip[data-name="${String(justInName).replace(/"/g, '\\"')}"]`);
        if (jc) jc.classList.add("justIn");
      }
    }
  }
}
/* 捲到指定樓層、閃框、保留焦點框 10 秒 */
function focusTier(fid) {
  focusedFloor = Number(fid);
  const el = document.getElementById("tier-" + fid);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("focus", "pulse");
  setTimeout(() => el.classList.remove("pulse"), 3600);
  setTimeout(() => {
    const t = document.getElementById("tier-" + fid);
    if (t) t.classList.remove("focus");
    if (focusedFloor === Number(fid)) focusedFloor = null;
  }, 10000);
}
/* 先畫出空冰箱骨架，資料（Firestore）回來再填內容 → 斷線／慢連線時不會整片空白 */
renderMap();

/* 冰箱裡的品項：方框只寫品名（不顯示數量／經手人／⋯）；要細節＝長按（拖曳時浮動標籤會顯示），要編輯＝點一下 */
function chipHTML(it) {
  const q = Number(it.qty) || 0;
  const detail = [it.name, q > 0 ? q + (it.unit || "") : "", it.note ? "備註：" + it.note : "",
                  it.by ? "放入：" + it.by : "", it.updatedAt ? "更新：" + fmtTime(it.updatedAt) : ""].filter(Boolean).join("　");
  return `<button class="chip" data-id="${esc(it._id)}" data-name="${esc(it.name)}" title="${esc(detail)}">
      <span class="nm">${esc(it.name)}</span>${(showBy && it.by) ? `<span class="by">👤${esc(it.by)}</span>` : ""}
    </button>`;
}

/* ================= 就地操作：拖曳換層、就地選單（改名／移層／刪除） ================= */
let dragCtx = null, suppressClick = false, chipMenuEl = null;

function closeChipMenu() {
  if (chipMenuEl) { chipMenuEl.remove(); chipMenuEl = null; }
  document.removeEventListener("pointerdown", outsideCloseMenu, true);
}
function outsideCloseMenu(e) {
  const onMore = e.target.closest && e.target.closest(".more");
  if (chipMenuEl && !chipMenuEl.contains(e.target) && !onMore) closeChipMenu();
}

/* 前賢 2026-10-08：把關 —— 食材要對應到相對的分類層，放錯層先警告（可覆蓋） */
function warnFloorText(id) {
  const f = floorOf(id);
  return (f.door ? f.door + " " : "") + "第" + f.local + "層" + (f.name ? "（" + f.name + "）" : "");
}
/* 前賢 2026-10-08：「餡料」＝上門第2層（素料/餡料）→ 所有月餅餡等「品名含餡」的都算這一層 */
function xianFloorId() {
  const f = FLOORS.find(x => String(x.name).indexOf("餡料") >= 0);
  return f ? Number(f.id) : null;
}
function homeFloorOf(name, excludeId) {
  const n = String(name == null ? "" : name).trim();
  if (!n) return null;
  if (n.indexOf("餡") >= 0) { const x = xianFloorId(); if (x !== null) return x; }   /* 餡類專屬規則 */
  if (n.indexOf("豆包") >= 0) {                                                      /* 前賢 2026-10-08：豆包＝素料 */
    const f = FLOORS.find(x => String(x.name).trim() === "素料");
    if (f) return Number(f.id);
  }
  const hit = items.find(i => i && String(i.name).trim() === n && i._id !== excludeId);
  return hit ? Number(hit.floor) : null;
}
function askFloorWarn(name, fromFloor, toFloor) {
  return new Promise(resolve => {
    const mask = document.getElementById("warnMask");
    const txt = document.getElementById("warnText");
    if (!mask || !txt) { resolve(true); return; }
    txt.innerHTML = "「<b>" + esc(name) + "</b>」目前屬於 <b>" + warnFloorText(fromFloor) +
      "</b>，<br>你要放到 <b>" + warnFloorText(toFloor) + "</b>。<br>" +
      '<span class="wq">分類看起來不一樣，確定要放嗎？</span>';
    mask.classList.add("on");
    const done = ok => {
      mask.classList.remove("on");
      document.getElementById("warnOk").onclick = null;
      document.getElementById("warnCancel").onclick = null;
      resolve(ok);
    };
    document.getElementById("warnOk").onclick = () => done(true);
    document.getElementById("warnCancel").onclick = () => done(false);
  });
}
/* 前賢 2026-10-08：取分類「根」——「素料/餡料」「素料」都算同一大類「素料」（下門兩層 2026-10-12 起改名為「其他/…」故自成「其他」大類） */
function floorRoot(id) {
  const f = floorOf(id);
  const nm = String((f && f.name) || "");
  const root = nm.split("/")[0].trim();
  return root || nm;
}
/* 回傳 true＝放行；false＝使用者取消 */
async function floorGuard(name, toFloor, fromFloor, excludeId) {
  const target = Number(toFloor);
  /* 前賢 2026-10-08：餡類一律「上門第2層」為家 —— 不管它現在在哪一層，放到第2層都不提醒 */
  if (String(name == null ? "" : name).indexOf("餡") >= 0) {
    const xf = xianFloorId();
    if (xf === null || xf === target) return true;
    return await askFloorWarn(name, xf, target);
  }
  const home = (fromFloor === null || fromFloor === undefined)
    ? homeFloorOf(name, excludeId) : Number(fromFloor);
  if (!home || home === target) return true;
  /* 前賢：同一大類之間搬移不提醒（素料有兩層：素料/餡料、素料；下門兩層為「其他」大類） */
  if (floorRoot(home) === floorRoot(target)) return true;
  return await askFloorWarn(name, home, target);
}
async function moveItemTo(it, floor) {
  const from = Number(it.floor), to = Number(floor);
  if (!needReady() || from === to) return;
  const by = operator || it.by || "";
  if (!by) { toast("請先設定經手人"); return; }
  /* 前賢：換層＝換分類，先警告（可選「仍要放入」） */
  if (!(await floorGuard(it.name, to, from, it._id))) return;
  try {
    await updateDoc(doc(db, COLL_ITEMS, it._id), { floor: to, updatedAt: Date.now() });
    await addLog(to, it.name, Number(it.qty) || 0, it.unit || "", "move", by, from);
    /* 前賢：移出／移入不用跳狀態訊息（例如「已移動…」） */
    focusedFloor = to; markJustIn(to, it.name);
  } catch (e) { toast("移動失敗：" + (e.code || e.message)); }
}

async function renameItem(it, newName) {
  const nm = (newName || "").trim();
  if (!nm || nm === it.name || !needReady()) return;
  const by = operator || it.by || "";
  if (!by) { toast("請先設定經手人"); return; }
  try {
    await updateDoc(doc(db, COLL_ITEMS, it._id), { name: nm, updatedAt: Date.now() });
    await addLog(Number(it.floor), nm, Number(it.qty) || 0, it.unit || "", "rename", by, null, it.name);
    toast(`已改名：${it.name} → ${nm}`);
    pendingHighlight = it._id;
  } catch (e) { toast("改名失敗：" + (e.code || e.message)); }
}

async function removeItem(it) {
  if (!needReady()) return;
  const by = operator || it.by || "";
  if (!by) { toast("請先設定經手人"); return; }
  if (!confirm(`確定刪除「${it.name}」？\n（紀錄會保留一筆刪除記錄）`)) return;
  try {
    await deleteDoc(doc(db, COLL_ITEMS, it._id));
    await addLog(Number(it.floor), it.name, Number(it.qty) || 0, it.unit || "", "del", by);
    toast("已刪除：" + it.name);
  } catch (e) { toast("刪除失敗：" + (e.code || e.message)); }
}

/* 前賢：把食材庫的食材拖到「食材庫框的下方外面」＝刪除（會先問一次，避免誤刪） */
async function deleteOutsideEntry(entry) {
  if (!entry) return;
  if (!entry.id) { toast(`「${entry.name}」是常備食材，沒有紀錄可刪`); return; }
  if (!ensureOperator() || !needReady()) return;
  const by = operator || "";
  if (!by) { toast("請先設定經手人"); return; }
  if (!confirm(`確定刪除「${entry.name}」？\n（紀錄會保留一筆刪除記錄）`)) return;
  try {
    await deleteDoc(doc(db, COLL_ITEMS, entry.id));
    await addLog(Number(entry.floor) || 0, entry.name, 0, entry.unit || "", "del", by);
    outside = outside.filter(o => o.id !== entry.id);
    renderOutside();
    renderMap();
  } catch (e) { toast("刪除失敗：" + (e.code || e.message)); }
}

function openChipMenu(it, anchor) {
  if (!ensureOperator()) return;
  closeChipMenu();
  const others = FLOORS.filter(f => f.id !== Number(it.floor));
  const el = document.createElement("div");
  el.className = "cmenu";
  el.innerHTML = `
    <div class="cm-h">${esc(it.name)}</div>
    <button type="button" data-a="rename">✏️ 修改名稱</button>
    <label class="cm-l">📦 移到
      <select id="cmMove"><option value="">選樓層…</option>
        ${others.map(f => `<option value="${f.id}">${esc(floorFull(f.id))}</option>`).join("")}
      </select>
    </label>
    <button type="button" class="danger" data-a="del">🗑️ 刪除</button>`;
  document.body.appendChild(el);
  chipMenuEl = el;

  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  el.style.left = x + "px"; el.style.top = y + "px";

  el.querySelector('[data-a="rename"]').addEventListener("click", () => {
    el.innerHTML = `<div class="cm-h">修改名稱</div>
      <input id="cmName" value="${esc(it.name)}">
      <div class="cm-row"><button type="button" data-a="cancel">取消</button>
      <button type="button" class="ok" data-a="ok">確定</button></div>`;
    const inp = el.querySelector("#cmName");
    inp.focus(); inp.select();
    const ok = () => { const v = inp.value; closeChipMenu(); renameItem(it, v); };
    el.querySelector('[data-a="ok"]').addEventListener("click", ok);
    el.querySelector('[data-a="cancel"]').addEventListener("click", closeChipMenu);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
  });
  el.querySelector('[data-a="del"]').addEventListener("click", () => { closeChipMenu(); removeItem(it); });
  el.querySelector("#cmMove").addEventListener("change", e => {
    const v = e.target.value; closeChipMenu();
    if (v) moveItemTo(it, Number(v));
  });
  setTimeout(() => document.addEventListener("pointerdown", outsideCloseMenu, true), 0);
}

/* ================= 冰箱外暫存區：拖出去＝移出冰箱、拖回來＝放回 ================= */
/* （outside 陣列宣告在最上面的狀態列，因為 renderMap() 在載入時就會呼叫 renderOutside()） */

/* 食材庫＝「冰箱裡沒有的」：本次拖出去的 ＋ 資料庫裡數量 0 的（重整後也還在，可拖回去） */
function osEntries() {
  const seen = new Set(outside.map(o => o.id));
  const gone = items.filter(i => (Number(i.qty) || 0) <= 0 && !seen.has(i._id))
    .map(i => ({ id: i._id, name: i.name, qty: 0, unit: i.unit || "", floor: Number(i.floor), gone: true }));
  /* 前賢：食材庫不要有重複 → 同名只留一筆（外面的暫存優先，其次資料庫） */
  const out = [], byName = new Set();
  for (const o of [...outside, ...gone]) {
    const k = (o.name || "").trim();
    if (!k || byName.has(k)) continue;
    byName.add(k);
    out.push(o);
  }
  return out;
}
/* 常備食材：冰箱裡目前沒有的（同名品項數量 > 0 就不列，避免重複） */
function stapleEntries() {
  const have = new Set(items.filter(i => (Number(i.qty) || 0) > 0).map(i => (i.name || "").trim()));
  return STAPLES.filter(n => !have.has(n)).map(n => ({ id: null, name: n, qty: 0, unit: "", staple: true }));
}
/* 點選入庫：先點食材庫的食材，再點要放進的樓層（手機不用拖也能放） */
function setPendingPlace(entry) {
  pendingPlace = entry || null;
  document.querySelectorAll(".tier").forEach(t => t.classList.toggle("awaitDrop", !!pendingPlace));
  renderOutside();
  /* 前賢：點選食材後不要在下方跳「要放進哪一層」的提示（選中的綠框＋各層綠虛線框已經夠清楚） */
}
function renderOutside() {
  const box = $("#osItems");
  if (!box) return;
  const gone = osEntries();
  const goneNames = new Set(gone.map(o => (o.name || "").trim()));
  const staples = stapleEntries().filter(s => !goneNames.has(s.name));   // 已列在「冰箱裡沒有的」就不要重複
  const list = [...staples, ...gone];
  if (!list.length) { box.innerHTML = '<span class="empty">（空）</span>'; return; }
  /* 前賢：食材庫格子不要「⋯」小點點 */
  const chip = (o, i) => `<button class="chip os-chip${o.staple ? " staple" : ""}${(pendingPlace && pendingPlace.name === o.name) ? " sel" : ""}" data-os="${i}" data-name="${esc(o.name)}"
      title="${o.staple ? "拖進冰箱任一層＝放進冰箱（或點一下再點樓層）" : "拖回冰箱任一層＝放回（或點一下再點樓層）"}">${esc(o.name)}${o.qty > 1 ? `<span class="q">${o.qty}${esc(o.unit || "")}</span>` : ""}</button>`;
  box.innerHTML = list.map((o, i) => chip(o, i)).join("");
  box.querySelectorAll(".os-chip").forEach(el => bindOutsideGestures(el, list[Number(el.dataset.os)]));
}

async function takeOut(it) {
  if (!ensureOperator()) return;
  const q = Number(it.qty) || 0;
  if (!needReady() || q <= 0) return;
  const by = operator || it.by || "";
  if (!by) { toast("請先設定經手人"); return; }
  const unit = it.unit || "";
  try {
    await updateDoc(doc(db, COLL_ITEMS, it._id), { qty: increment(-1), updatedAt: Date.now() });
    await addLog(Number(it.floor), it.name, 1, unit, "out", by);
    const e = outside.find(o => o.id === it._id);
    if (e) e.qty += 1;
    else outside.unshift({ id: it._id, name: it.name, qty: 1, unit, floor: Number(it.floor) });
    renderOutside();
    pendingHighlight = it._id;
    /* 前賢：移出不用跳狀態訊息 */
  } catch (err) { toast("移出失敗：" + (err.code || err.message)); }
}

async function putBack(entry, floor) {
  if (!entry || !ensureOperator() || !needReady()) return;
  setPendingPlace(null);
  /* 前賢 2026-10-08：同名食材只保留一筆 → 先以 id 找，找不到就用「名字」找既有的來合併 */
  const nmKey = String(entry.name || "").trim();
  const found = items.find(i => i._id === entry.id) ||
                items.find(i => i && String(i.name).trim() === nmKey);
  const by = operator || (found && found.by) || "";
  if (!by) { toast("請先設定經手人"); return; }
  /* 前賢：放錯層先警告（可選「仍要放入」） */
  if (!(await floorGuard(entry.name, floor, null, null))) return;
  const it = found;
  try {
    if (it) {
      await updateDoc(doc(db, COLL_ITEMS, it._id),
        { qty: increment(1), floor: Number(floor), updatedAt: Date.now() });
      await addLog(Number(floor), entry.name, 1, entry.unit || it.unit || "", "in", by);
      markJustIn(floor, entry.name);
    } else {
      await addDoc(collection(db, COLL_ITEMS), {
        name: entry.name, qty: 1, unit: entry.unit || "", floor: Number(floor), note: "", by,
        updatedAt: Date.now(), createdAt: Date.now()
      });
      await addLog(Number(floor), entry.name, 1, entry.unit || "", "new", by);
      markJustIn(floor, entry.name);
    }
    focusedFloor = Number(floor);
    const e = outside.find(o => o.id === entry.id);
    if (e) { e.qty -= 1; if (e.qty <= 0) outside = outside.filter(x => x !== e); }
    renderOutside();
    /* 前賢：移入不用跳狀態訊息 */
  } catch (err) { toast("放回失敗：" + (err.code || err.message)); }
}

$("#osClear").addEventListener("click", () => {
  if (!outside.length) { toast("「冰箱外」是空的"); return; }
  if (!confirm("清掉「剛拖出來」的暫存清單？\n（冰箱裡本來就沒有的那幾樣不會被清掉，庫存與紀錄也不受影響）")) return;
  outside = [];
  renderOutside();
});
renderOutside();

/* 拖曳中浮出的「移出」放置區 */
let dropOutEl = null, autoScrollRaf = 0;
function ensureDropOut() {
  if (dropOutEl) return dropOutEl;
  dropOutEl = document.createElement("div");
  dropOutEl.id = "dropOut";
  dropOutEl.textContent = "🗑️";          /* 前賢 2026-10-05：原本用 📤，看不出是回收 → 改垃圾桶 */
  document.body.appendChild(dropOutEl);
  return dropOutEl;
}
function autoScroll() {
  if (!dragCtx) { autoScrollRaf = 0; return; }
  const y = dragCtx.lastY;
  if (y < 100) window.scrollBy(0, -16);
  else if (y > innerHeight - 100) window.scrollBy(0, 16);
  autoScrollRaf = requestAnimationFrame(autoScroll);
}

/* 拖曳：滑鼠可直接拖；手指要橫向起手（直向＝捲動頁面） */
function startDrag(el, it, ev, kind) {
  /* 前賢：長按準備拖拉時，品名要跟著手勢跑（冰箱與食材庫都要） */
  const g = document.createElement("div");
  g.className = "chip-ghost";
  const q0 = Number(it.qty) || 0;
  g.textContent = [it.name, q0 > 0 ? `${q0}${it.unit || ""}` : "", (showBy && it.by) ? `👤${it.by}` : ""].filter(Boolean).join("　");
  document.body.appendChild(g);
  el.classList.add("dragging");
  dragCtx = { el, it, kind: kind || "item", ghost: g, targetTier: null, overOut: false, lastY: ev.clientY };
  suppressClick = true;
  ensureDropOut().classList.add("on");
  try { el.setPointerCapture(ev.pointerId); } catch (_) {}
  if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScroll);
  moveDrag(ev);
}
function moveDrag(ev) {
  if (!dragCtx) return;
  dragCtx.lastY = ev.clientY;
  dragCtx.lastX = ev.clientX;
  if (dragCtx.ghost) { dragCtx.ghost.style.left = ev.clientX + "px"; dragCtx.ghost.style.top = (ev.clientY - 46) + "px"; }   /* 前賢 2026-10-05：幽靈卡上移 46px，避免被手指遮住 */
  const under = document.elementFromPoint(ev.clientX, ev.clientY);
  const tier = under && under.closest ? under.closest(".tier") : null;
  /* 前賢：把食材庫的食材拖到「食材庫框的下方外面」＝刪除（要在 tier 之後才算，否則 TDZ 會讓整個拖曳掛掉） */
  if (dragCtx.kind === "outside") {
    const oz2 = document.getElementById("outsideZone");
    if (oz2) {
      const r2 = oz2.getBoundingClientRect();
      dragCtx.belowOut = (ev.clientY > r2.bottom + 6) && !tier;
    }
  }
  let overOut = false;
  if (dragCtx.kind === "item") {
    const d = ensureDropOut(), r = d.getBoundingClientRect();
    overOut = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    const oz = document.getElementById("outsideZone");
    const overPanel = !!(oz && under && oz.contains(under));
    if (!overOut && overPanel) overOut = true;   // 拖到下方「冰箱外」區塊也算
    /* 前賢 2026-10-08：拖近食材庫→框變橙色閃爍（代表可入庫） */
    if (oz) oz.classList.toggle("invHot", overPanel);
    /* 前賢：拖拉時不要有變色／放大的動態變化（功能照舊，放手時仍判斷是否拖到下方） */
  }
  dragCtx.targetTier = tier;      /* 前賢：拖拉時不要顯示拖到第幾層的「狀態文字」（純視覺高亮可以） */
  dragCtx.overOut = overOut;
  /* 前賢 2026-10-05：手指所在的層自動加高＋高亮；移到「移出」區時垃圾桶也變紅 */
  document.querySelectorAll(".tier.hover").forEach(t => { if (t !== tier) t.classList.remove("hover"); });
  if (tier) tier.classList.add("hover");
  const dz = dropOutEl;
  if (dz) {
    /* 垃圾桶只要手指壓上去就變紅（冰箱品項＝移出、食材庫品項＝刪除，兩種都是「回收」的意思） */
    const dr = dz.getBoundingClientRect();
    const overTrash = ev.clientX >= dr.left && ev.clientX <= dr.right && ev.clientY >= dr.top && ev.clientY <= dr.bottom;
    dz.classList.toggle("hot", overTrash);
  }
}
/* 前賢 2026-10-05：手勢被系統搶走（判定捲動、切窗、來電）＝取消拖曳，不做任何動作、不留殘影 */
function cancelDrag() {
  if (!dragCtx) return;
  const { el, ghost } = dragCtx;
  el.classList.remove("dragging");
  if (ghost) ghost.remove();
  const d = ensureDropOut(); d.classList.remove("on", "hot");
  document.querySelectorAll(".tier.hover").forEach(t => t.classList.remove("hover"));
  const oz = document.getElementById("outsideZone");
  if (oz) oz.classList.remove("over", "invHot");
  dragCtx = null;
  setTimeout(() => { suppressClick = false; }, 250);
}
function endDrag() {
  if (!dragCtx) return;
  const { el, it, kind, ghost, targetTier, overOut } = dragCtx;
  const dragBelowOut = !!dragCtx.belowOut;
  el.classList.remove("dragging");
  if (ghost) ghost.remove();
  const d = ensureDropOut(); d.classList.remove("on", "hot");
  document.querySelectorAll(".tier.hover").forEach(t => t.classList.remove("hover"));
  const oz = document.getElementById("outsideZone");
  if (oz) oz.classList.remove("over", "invHot");
  dragCtx = null;
  if (kind === "item") {
    if (overOut) takeOut(it);                        // 拖到「移出」區＝移出冰箱
    else if (targetTier) {
      const fid = Number(targetTier.dataset.floor);
      if (fid && fid !== Number(it.floor)) moveItemTo(it, fid);
    }
  } else if (targetTier) {
    putBack(it, Number(targetTier.dataset.floor));   // 從「冰箱外」拖回某層＝放回
  } else if (dragBelowOut) {
    deleteOutsideEntry(it);                          // 前賢：拖到食材庫框下方外面＝刪除
  }
  setTimeout(() => { suppressClick = false; }, 250);
}
function bindChipGestures(el, it, kind) {
  el.addEventListener("click", e => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.target.closest(".more")) {                     // ⋯：改名／移層／刪除
      const real = kind === "outside" ? items.find(i => i._id === it.id) : it;
      if (real) { e.stopPropagation(); openChipMenu(real, el); }
      return;
    }
    if (kind === "outside") {
      setPendingPlace((pendingPlace && pendingPlace.name === it.name) ? null : it);
      return;
    }
    /* 前賢 2026-10-08：置入模式中（已點選食材庫某項）點到冰箱裡既有品名時，
       直接放進「那一層」，不要跳出編輯視窗 —— 點到哪層就置入哪層 */
    if (pendingPlace) { putBack(pendingPlace, Number(it.floor)); return; }
    openEdit(it._id);
  });
  el.addEventListener("keydown", e => {
    if (kind === "outside") return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(it._id); }
  });
  el.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".more")) return;              // ⋯ 只開選單，不拖
    if (!ensureOperator()) return;                      // 還沒有經手人 → 先請他填一次
    /* 前賢 2026-10-05：長按拖曳前先把搜尋框的鍵盤收掉，避免畫面位移讓手勢被判成捲動 */
    try { const ae = document.activeElement; if (ae && ae.tagName === "INPUT" && ae.blur) ae.blur(); } catch (_) {}
    const mouse = e.pointerType === "mouse";
    const sx = e.clientX, sy = e.clientY;
    let mode = "pending";
    const begin = ev2 => {
      mode = "drag";
      try { if (!mouse && navigator.vibrate) navigator.vibrate(15); } catch (_) {}
      startDrag(el, it, ev2, kind);
    };
    /* 手機：長按 0.25 秒進入拖曳（之後往任何方向都能拖，含上下換門）；
       沒長按直接滑＝捲動頁面；滑鼠或快速橫向滑動＝直接拖 */
    let longTimer = null;
    if (!mouse) longTimer = setTimeout(() => { if (mode === "pending") begin({ clientX: sx, clientY: sy, pointerId: e.pointerId }); }, 250);
    const onMove = ev2 => {
      const dx = ev2.clientX - sx, dy = ev2.clientY - sy;
      if (mode === "pending") {
        /* 前賢 2026-10-05：手機長按時手指常有一點位移，門檻太小會被誤判成捲動而拖不動 → 放寬到 24px */
        const far = Math.hypot(dx, dy) > (mouse ? 6 : 24);
        if (far) {
          if (longTimer) { clearTimeout(longTimer); longTimer = null; }
          if (mouse || Math.abs(dx) >= Math.abs(dy)) begin(ev2);
          else { mode = "scroll"; cleanup(); }   // 手指直向滑＝捲動頁面
        }
      } else if (mode === "drag") moveDrag(ev2);
    };
    const onUp = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } if (mode === "drag") endDrag(); cleanup(); };
    /* 前賢 2026-10-05：被系統搶手勢 → 取消（不寫入、不留殘影）；先前會當成放手而誤移物品 */
    const onCancel = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } if (mode === "drag") cancelDrag(); cleanup(); };
    const cleanup = () => {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  });
  /* 拖曳中不要讓頁面跟著捲動（手機長按拖曳時必須擋掉預設捲動） */
  el.addEventListener("touchmove", e => { if (dragCtx && dragCtx.el === el) e.preventDefault(); }, { passive: false });
}
function bindOutsideGestures(el, entry) { bindChipGestures(el, entry, "outside"); }

/* ================= 樓層選擇器 ================= */
$("#fFloor").innerHTML = FLOORS.map(f => `<option value="${f.id}">${esc(floorFull(f.id))}</option>`).join("");

/* ================= 編輯視窗 ================= */
function openEdit(id, presetFloor) {
  if (!ensureOperator()) return;
  stopListen();                              // 開編輯視窗時先關掉主頁語音，避免搶麥克風
  if (fillRec) { try { fillRec.stop(); } catch (_) {} }
  $("#fVoiceHint").style.display = "none";
  $("#fVoiceHint").textContent = "";
  $("#btnVoiceFill").textContent = "🎤 用說的";
  editId = id || null;
  const it = id ? items.find(i => i._id === id) : null;
  $("#sheetTitle").textContent = it ? "修改物品" : "新增物品";
  $("#fName").value  = it ? it.name : "";
  $("#fQty").value   = it ? (Number(it.qty) || 0) : 1;
  $("#fUnit").value  = it && it.unit ? it.unit : "包";
  $("#fFloor").value = String(it ? Number(it.floor) : (presetFloor || FLOORS[0].id));
  $("#fNote").value  = it && it.note ? it.note : "";
  $("#fBy").value    = it && it.by ? it.by : operator;
  $("#btnDel").style.display = it ? "" : "none";
  refreshByList();
  $("#metaInfo").textContent = it
    ? `上次更新：${fmtTime(it.updatedAt)}${it.by ? "　登錄者：" + it.by : ""}`
    : "";
  $("#mask").classList.add("on");
  setTimeout(() => $("#fName").focus(), 120);
}
function closeEdit() { $("#mask").classList.remove("on"); editId = null; }
$("#btnCancel").addEventListener("click", closeEdit);
$("#mask").addEventListener("click", e => { if (e.target.id === "mask") closeEdit(); });
$("#minus").addEventListener("click", () => { const q = $("#fQty"); q.value = Math.max(0, (Number(q.value) || 0) - 1); });
$("#plus").addEventListener("click",  () => { const q = $("#fQty"); q.value = (Number(q.value) || 0) + 1; });
$("#btnAdd").addEventListener("click", () => openEdit(null));

/* 📋 冷凍庫使用規則（前賢 2026-10-06：規則也放在冷凍位置圖這邊） */
$("#btnRules").addEventListener("click", () => $("#rulesMask").classList.add("on"));
$("#btnRulesClose").addEventListener("click", () => $("#rulesMask").classList.remove("on"));
$("#btnRulesClose2").addEventListener("click", () => $("#rulesMask").classList.remove("on"));
$("#rulesMask").addEventListener("click", e => { if (e.target.id === "rulesMask") $("#rulesMask").classList.remove("on"); });

/* ================= 寫入資料 ================= */
function needReady() {
  if (!ready) { toast("尚未連上雲端，請稍後再試"); return false; }
  return true;
}

$("#btnSave").addEventListener("click", async () => {
  if (!needReady()) return;
  const name = ($("#fName").value || "").trim();
  const qty  = Math.max(0, Number($("#fQty").value) || 0);
  const unit = $("#fUnit").value;
  const floor = Number($("#fFloor").value);
  const note = ($("#fNote").value || "").trim();
  const by   = ($("#fBy").value || "").trim();
  if (!name) { toast("請輸入品名"); return; }
  if (!by)   { toast("請填經手人（放入／移出者）"); $("#fBy").focus(); return; }
  setOperator(by); rememberBy(by);

  /* 前賢：存檔前把關 —— 食材要對應正確分類層 */
  if (editId) {
    const oldF = Number((items.find(i => i._id === editId) || {}).floor);
    if (oldF !== floor && !(await floorGuard(name, floor, oldF, editId))) return;
  } else {
    if (!(await floorGuard(name, floor, null, null))) return;
  }

  $("#btnSave").disabled = true;
  try {
    if (editId) {
      const old = items.find(i => i._id === editId) || {};
      await updateDoc(doc(db, COLL_ITEMS, editId), {
        name, qty, unit, floor, note, by, updatedAt: Date.now()
      });
      const diff = qty - (Number(old.qty) || 0);
      if (diff !== 0) await addLog(floor, name, Math.abs(diff), unit, diff > 0 ? "in" : "out", by);
      else await addLog(floor, name, qty, unit, "edit", by);
      toast("已更新：" + name);
      pendingHighlight = editId;
    } else {
      /* 前賢 2026-10-08：同名食材只保留一筆 → 有同名的直接併入數量，不新增第二筆 */
      const dup = items.find(i => i && String(i.name).trim() === name);
      if (dup) {
        await updateDoc(doc(db, COLL_ITEMS, dup._id), {
          qty: increment(qty),
          floor, unit: unit || dup.unit || "", note: note || dup.note || "",
          by, updatedAt: Date.now()
        });
        await addLog(floor, name, qty, unit, "in", by);
        pendingHighlight = dup._id;
        toast("已有「" + name + "」→ 已合併數量");
      } else {
        await addDoc(collection(db, COLL_ITEMS), {
          name, qty, unit, floor, note, by, updatedAt: Date.now(), createdAt: Date.now()
        });
        await addLog(floor, name, qty, unit, "new", by);
        toast("已新增：" + name);
      }
    }
    closeEdit();
    /* 存完直接帶到該層：捲過去、框起來 */
    focusTier(floor);
  } catch (e) {
    console.error(e);
    toast("寫入失敗：" + (e.code || e.message));
  } finally { $("#btnSave").disabled = false; }
});

$("#btnDel").addEventListener("click", async () => {
  if (!editId || !needReady()) return;
  const it = items.find(i => i._id === editId) || {};
  if (!confirm(`確定刪除「${it.name}」？\n（紀錄會保留一筆刪除記錄）`)) return;
  const by = ($("#fBy").value || "").trim() || operator;
  if (!by) { toast("請填經手人（放入／移出者）"); $("#fBy").focus(); return; }
  setOperator(by); rememberBy(by);
  try {
    await deleteDoc(doc(db, COLL_ITEMS, editId));
    await addLog(Number(it.floor), it.name, Number(it.qty) || 0, it.unit || "", "del", by);
    toast("已刪除：" + it.name);
    closeEdit();
  } catch (e) { toast("刪除失敗：" + (e.code || e.message)); }
});

async function addLog(floor, name, qty, unit, action, by, from = null, oldName = null) {
  try {
    await addDoc(collection(db, COLL_LOG), {
      floor: Number(floor), name, qty, unit, action, by: by || "", at: Date.now(),
      ...(from != null ? { from: Number(from) } : {}),
      ...(oldName ? { old: oldName } : {})
    });
  } catch (e) { console.warn("紀錄寫入失敗", e); }
}

/* ================= 語音記帳（講一句 → 確認卡按一下 → 寫入） ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wakeLock = null, pendingVoice = null;

function vState(txt, live) {
  $("#vState").textContent = txt;
  $("#vDot").classList.toggle("live", !!live);
  const f = $("#voiceFloat"); if (f) f.classList.toggle("on", !!live);
  const b = $("#btnListen"); if (b) b.innerHTML = live ? "⏹ 停止聽取" : LISTEN_L + " 開始聽 " + LISTEN_R;
}
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* 不支援就算了 */ }
}
/* 前賢 2026-10-07：開始聽＝左右聲波紋＋正立麥克風（不用斜的 🎤 emoji） */
const LISTEN_L = '<svg class="wv" width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true"><rect x="0" y="5" width="2.4" height="6" rx="1.2" fill="currentColor"/><rect x="4.2" y="2" width="2.4" height="12" rx="1.2" fill="currentColor"/><rect x="8.4" y="6" width="2.4" height="4" rx="1.2" fill="currentColor"/></svg><svg class="mic" width="12" height="17" viewBox="0 0 12 17" fill="none" aria-hidden="true"><rect x="3.4" y="0" width="5.2" height="9" rx="2.6" fill="currentColor"/><path d="M1 7.4a5 5 0 0 0 10 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="5.2" y="12.2" width="1.6" height="3.2" rx="0.8" fill="currentColor"/><rect x="2.6" y="15" width="6.8" height="1.7" rx="0.85" fill="currentColor"/></svg>';
const LISTEN_R = '<svg class="wv" width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true"><rect x="3.6" y="6" width="2.4" height="4" rx="1.2" fill="currentColor"/><rect x="7.8" y="2" width="2.4" height="12" rx="1.2" fill="currentColor"/><rect x="12" y="5" width="2.4" height="6" rx="1.2" fill="currentColor"/></svg>';

function startListen() {
  if (!SR) { toast("此瀏覽器不支援語音辨識，請用 Android Chrome 開啟"); return; }
  if (listening) return;
  listening = true;
  rec = new SR();
  rec.lang = "zh-TW"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onstart = () => vState("聽取中…請講「品名＋數量」", true);
  rec.onresult = e => {
    if (!listening) return;   /* 前賢 2026-10-05：講完就停 → 遲到的辨識結果不要再用 */
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim || final.trim()) { $("#vHeard").hidden = false; centerVPop(); }
    if (interim) $("#vHeard").innerHTML = "…" + esc(interim);
    if (final.trim()) { $("#vHeard").innerHTML = "<b>" + esc(final.trim()) + "</b>"; handleVoice(final.trim()); stopListen(); }   /* 前賢 2026-10-05：講完一句就停，要再講再點「開始聽」 */
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      listening = false; keepAwake(false); vState("麥克風未授權", false);
      toast("請允許麥克風權限後再按「開始聽」");
    } else if (e.error !== "no-speech" && e.error !== "aborted") { console.warn("語音錯誤:", e.error); }
  };
  rec.onend = () => { if (listening) { try { rec.start(); } catch (_) {} } else vState("已停止", false); };
  try { rec.start(); keepAwake(true); } catch (e) { listening = false; toast("無法啟動語音：" + e.message); }
}
function stopListen() {
  listening = false;
  if (rec) { try { rec.stop(); } catch (_) {} }
  keepAwake(false); vState("未開始", false);
}

function handleVoice(text) {
  if (/^(停止|結束|不要聽|關掉)/.test(text)) { stopListen(); toast("已停止聽取"); return; }
  const r = parseUtterance(text, items);
  if (r.operatorName) { setOperator(r.operatorName); toast("經手人：" + r.operatorName); }
  pendingVoice = r;
  renderVoiceCard(r);
}

/* 前賢 2026-10-05：語音卡與「聽到的字」要置中；原本靠語音列右緣對齊，而語音列在手機上靠左 → 整張卡被推出畫面外 119px */
function centerVPop() {
  const vp = document.getElementById("vPop");
  if (!vp) return;
  const host = vp.parentElement;
  if (!host) return;
  const w = Math.max(220, Math.min(330, window.innerWidth - 20));
  const left = Math.round((window.innerWidth - w) / 2 - host.getBoundingClientRect().left);
  vp.style.width = w + "px";
  vp.style.left = left + "px";
  vp.style.right = "auto";
}
window.addEventListener("resize", () => centerVPop());

/* 前賢 2026-10-07：樓層標籤裡的「第X層」單獨上色（其餘照原文顏色） */
function flChip(id) {
  return esc(floorLabel(id)).replace(/第\d+層/, m => `<span class="flchip">${m}</span>`);
}

function renderVoiceCard(r) {
  const box = $("#vCard");
  /* 前賢 2026-10-05：卡片一出現就把「聽到的字」藍條收掉，不要留在底部 */
  $("#vHeard").hidden = true;
  centerVPop();
  const isIn = r.action === "in";
  if (!r.name) {
    pendingVoice = null;
    box.innerHTML = `<div class="vcard warn"><div class="big">🤔 沒聽清楚</div>
      <div class="sub">只聽到：「${esc(r.raw)}」<br>請再講一次，例如「香菇頭 一包」。</div></div>`;
    return;
  }
  if (!r.match || r.score < 45) {
    box.innerHTML = `<div class="vcard warn">
      <div class="big">❓ 找不到「<span class="nm">${esc(r.name)}</span>」</div>
      <div class="sub">這個品項還沒建過。要新增就按下面，或按取消再講一次。</div>
      <div class="acts">
        <button class="btn ghost" id="vCancel">取消</button>
        <button class="btn" id="vCreate">＋ 新增這個品項</button>
      </div></div>`;
    $("#vCancel").addEventListener("click", () => { pendingVoice = null; box.innerHTML = ""; $("#vHeard").hidden = true; });
    $("#vCreate").addEventListener("click", voiceCreate);
    return;
  }
  const it = r.match;
  const cur = Number(it.qty) || 0;
  const after = Math.max(0, cur + (isIn ? r.qty : -r.qty));
  /* 前賢 2026-10-10：你講了樓層就照你講的放（原本只警告、不生效） */
  const spokenFloor = (r.floor && Number(r.floor) !== Number(it.floor)) ? Number(r.floor) : Number(it.floor);
  const f = floorOf(spokenFloor);
  const floorWarn = "";
  box.innerHTML = `<div class="vcard">
    <div class="big">${isIn ? "⬇️ 置入" : "⬆️ 移出"}　<span class="nm">${esc(it.name)}</span>　${r.qty}${esc(r.unit || it.unit || "")}</div>
    <div class="sub">目前庫存：${cur}${esc(it.unit || "")} → <b>${after}${esc(it.unit || "")}</b>　·　${flChip(spokenFloor)} ${esc(f.name)}${floorWarn}</div>
    <label>經手人</label>
    <input type="text" id="vBy" list="byList" value="${esc(operator)}" placeholder="例：陳師姐">
    <div class="acts">
      <button class="btn ghost" id="vCancel">取消</button>
      <button class="btn ok" id="vOk">✅ 確認</button>
    </div>
    <div class="tiny">聽到：「${esc(r.raw)}」${r.phonetic ? `　🔉 同音對到「${esc(it.name)}」` : ""}</div></div>`;
  refreshByList();
  $("#vCancel").addEventListener("click", () => { pendingVoice = null; box.innerHTML = ""; });
  $("#vOk").addEventListener("click", confirmVoice);
}

function voiceCreate() {
  const r = pendingVoice;
  if (!r) return;
  openEdit(null, r.floor || 1);
  setTimeout(() => {
    $("#fName").value = r.name;
    $("#fQty").value = r.qty || 1;
    if (r.unit) $("#fUnit").value = r.unit;
  }, 80);
  $("#vCard").innerHTML = "";
}

async function confirmVoice() {
  const r = pendingVoice;
  if (!r || !r.match || !ensureOperator() || !needReady()) return;
  const by = ($("#vBy").value || "").trim();
  if (!by) { toast("請填經手人"); $("#vBy").focus(); return; }
  setOperator(by); rememberBy(by);
  const it = r.match;
  const isIn = r.action === "in";
  const targetFloor = (r.floor && Number(r.floor) !== Number(it.floor)) ? Number(r.floor) : Number(it.floor);
  const moved = targetFloor !== Number(it.floor);
  const newQty = Math.max(0, (Number(it.qty) || 0) + (isIn ? r.qty : -r.qty));
  $("#vOk").disabled = true;
  try {
    await updateDoc(doc(db, COLL_ITEMS, it._id),
      Object.assign({ qty: increment(isIn ? r.qty : -r.qty), by, updatedAt: Date.now() },
                    moved ? { floor: targetFloor } : {}));
    await addLog(targetFloor, it.name, r.qty, r.unit || it.unit || "", r.action, by, moved ? Number(it.floor) : null);
    /* 前賢：移出／移入不用跳狀態訊息 */
    pendingVoice = null;
    $("#vCard").innerHTML = "";
    $("#vHeard").hidden = true;
    /* 直接反映在冷凍格層：捲到該層、品項閃一下 */
    markJustIn(targetFloor, it.name);
    focusTier(targetFloor);
    setTimeout(() => { if (pendingHighlight) renderMap(); }, 900);
  } catch (e) {
    console.error(e);
    toast("寫入失敗：" + (e.code || e.message));
  } finally { if ($("#vOk")) $("#vOk").disabled = false; }
}

$("#btnListen").addEventListener("click", () => { listening ? stopListen() : startListen(); });

/* 前賢：點冰箱品項會跳出「複製／全選」小視窗 → 品項與食材庫上不顯示任何右鍵／長按選單 */
document.addEventListener("contextmenu", e => {
  if (e.target && e.target.closest && e.target.closest(".chip,.os-chip,.tier,.outside,#freezer,header,.tier-no,.door-head")) e.preventDefault();
}, true);
document.addEventListener("selectstart", e => {
  if (e.target && e.target.closest && e.target.closest(".chip,.os-chip,.tier,.outside,#freezer,header")) e.preventDefault();
}, true);

/* 前賢：點冰箱品項會跳出「複製／全選」小視窗 → 品項與食材庫上不顯示任何右鍵／長按選單 */
document.addEventListener("contextmenu", e => {
  if (e.target && e.target.closest && e.target.closest(".chip,.os-chip,.tier,.outside,#freezer,header,.tier-no,.door-head")) e.preventDefault();
}, true);
document.addEventListener("selectstart", e => {
  if (e.target && e.target.closest && e.target.closest(".chip,.os-chip,.tier,.outside,#freezer,header")) e.preventDefault();
}, true);
$("#btnStop").addEventListener("click", stopListen);
window.addEventListener("pagehide", stopListen);
/* 進頁面時是「未開始」狀態：一定要按「🎤 開始聽」才會啟動麥克風 */
vState(SR ? "未開始" : "此瀏覽器不支援語音（請用 Android Chrome）", false);

/* ================= 新增／修改視窗：用語音填欄位 ================= */
let fillRec = null, fillListening = false;

function applyVoiceToForm(text) {
  const r = parseUtterance(text, items);
  const sel = $("#fUnit");
  const hasUnit = u => [...sel.options].some(o => o.value === u);
  if (r.name) $("#fName").value = r.name;
  if (r.qty > 0) $("#fQty").value = r.qty;
  if (r.unit && hasUnit(r.unit)) sel.value = r.unit;
  if (r.floor) $("#fFloor").value = String(r.floor);
  if (r.operatorName) $("#fBy").value = r.operatorName;
  const parts = [];
  if (r.name) parts.push("品名「" + r.name + "」");
  if (r.qty) parts.push("數量 " + r.qty + (r.unit && hasUnit(r.unit) ? r.unit : ""));
  if (r.floor) parts.push("樓層 " + floorLabel(r.floor));
  if (r.match) parts.push("（已有品項：" + r.match.name + "）");
  $("#fVoiceHint").textContent = parts.length ? "✅ 已填入：" + parts.join("、") : "沒聽清楚，請再講一次";
}

function toggleVoiceFill() {
  if (!SR) { toast("此瀏覽器不支援語音辨識，請用 Android Chrome 開啟"); return; }
  if (fillListening) { try { fillRec.stop(); } catch (_) {} return; }
  stopListen();                              // 避免與主頁語音搶麥克風
  fillListening = true;
  $("#btnVoiceFill").textContent = "🎤 聽取中…";
  $("#fVoiceHint").style.display = "";
  $("#fVoiceHint").textContent = "請講「品名＋數量」，例如：香菇頭兩包";
  fillRec = new SR();
  fillRec.lang = "zh-TW"; fillRec.continuous = false; fillRec.interimResults = true; fillRec.maxAlternatives = 1;
  fillRec.onresult = e => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim && !final) $("#fVoiceHint").textContent = "…" + interim;
    if (final.trim()) { applyVoiceToForm(final.trim()); try { fillRec.stop(); } catch (_) {} }
  };
  fillRec.onerror = e => {
    fillListening = false; $("#btnVoiceFill").textContent = "🎤 用說的";
    if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("請允許麥克風權限");
  };
  fillRec.onend = () => { fillListening = false; $("#btnVoiceFill").textContent = "🎤 用說的"; };
  try { fillRec.start(); } catch (e) { fillListening = false; $("#btnVoiceFill").textContent = "🎤 用說的"; toast("無法啟動語音：" + e.message); }
}

$("#btnVoiceFill").addEventListener("click", toggleVoiceFill);

/* ================= 使用規則的「依層分類」＝由樓層設定自動產生 =================
   （前賢 2026-10-07：規則那邊的層別沒跟著改 → 改成資料驅動，以後不會再漏） */
function renderRulesFloors() {
  const box = document.getElementById("rulesFloors");
  if (!box) return;
  box.innerHTML = FLOORS.map(f =>
    `<li>${f.door} 第${floorNo(f.id)}層：${esc(f.name).split("/").join("／")}</li>`
  ).join("");
}
renderRulesFloors();

/* ================= 掃碼直達 ?f=N ================= */
function gotoFloor(fid) {
  const f = floorOf(fid);
  if (!FLOORS.some(x => x.id === Number(fid))) return;
  const bar = $("#focusBar");
  bar.style.display = "";
  const sd = document.querySelector(".side"); if (sd) sd.classList.add("show");
  bar.innerHTML = `📍 掃碼指定：<b>${esc(floorLabel(fid))} — ${esc(f.name)}</b>`;
  setTimeout(() => focusTier(fid), 400);
}
const m = new URLSearchParams(location.search).get("f");
if (m) gotoFloor(m);

/* 首次渲染後若有 ?f= 再次定位（等資料進來） */
setTimeout(() => { if (m) gotoFloor(m); }, 2500);
