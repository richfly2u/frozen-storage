


const STAPLES = ["當歸", "枸杞", "紅棗", "豆包", "麵腸", "火腿", "素丸子", "牛蒡排", "鱈魚排", "飯巾布", "麵線", "饅頭", "包子", "綠豆沙餡", "小魚干", "紅糟麵腸", "黑豆", "花生仁", "大薏仁", "豆干", "大胖干", "核桃", "腰果", "海帶芽", "味噌"];
const FLOORS  = [{"id": 1, "door": "上門", "name": "中藥 湯料 五穀堅果"}, {"id": 2, "door": "上門", "name": "素料/餡料"}, {"id": 5, "door": "上門", "name": "素料"}, {"id": 3, "door": "下門", "name": "其他/私人"}, {"id": 4, "door": "下門", "name": "其他/粉類"}];

const $ = id => document.getElementById(id);
const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function floorLabel(fid){
  const x = FLOORS.find(y => y.id === Number(fid));
  if (!x) return '（未指定層位）';
  const peers = FLOORS.filter(y => y.door === x.door);
  const n = peers.findIndex(y => y.id === x.id) + 1;
  return x.door + '　第' + n + '層';
}

let ITEMS = [];

function render(){
  const inF = [], out = [];
  ITEMS.forEach(it => {
    const fid = Number(it.floor);
    const qty = Number(it.qty) || 0;
    if (qty > 0 && FLOORS.some(f => f.id === fid)) inF.push(it);
    else out.push(it);
  });

  const byFloor = {};
  inF.forEach(it => { const k = Number(it.floor); (byFloor[k] = byFloor[k] || []).push(it); });

  let html = '';
  FLOORS.forEach(f => {
    const list = byFloor[f.id] || [];
    html += '<div class="floor"><div class="fh"><b>' + esc(floorLabel(f.id)) + '</b>' +
            (f.name ? '<span>' + esc(f.name) + '</span>' : '') +
            '<span>・' + (list.length ? list.length + ' 項' : '目前空的') + '</span></div>';
    html += list.length
      ? '<div class="items">' + list.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'))
          .map(it => '<div class="chip">' + esc(it.name) +
            '<i>' + esc(it.qty) + esc(it.unit || '') + '</i></div>').join('') + '</div>'
      : '<div class="empty">（這一層目前沒有登記品項）</div>';
    html += '</div>';
  });
  document.getElementById('floors').innerHTML = html;

  // 食材庫＝冰箱外：常見備品（沒冰的）＋ 其他未指定層位者
  const names = new Set(ITEMS.map(i => i.name));
  const rest = STAPLES.filter(n => !names.has(n));
  const other = out.map(i => i.name).filter(n => !STAPLES.includes(n));
  const all = rest.concat(other);
  const el = document.getElementById('staples');
  el.innerHTML = all.length
    ? all.map(n => '<span class="chip">' + esc(n) + '</span>').join('')
    : '<div class="empty">常備材料都已在冰箱內</div>';

  document.getElementById('upd').textContent = new Date().toLocaleString('zh-TW', { hour12: false });
}

signInAnonymously(auth).then(()=>{
  $('status').textContent = '';
  onSnapshot(query(collection(db,'frozen_items'), orderBy('name')), snap=>{
    ITEMS = snap.docs.map(d=>({_id:d.id, ...d.data()}));
    render();
  }, err=>{
    $('status').innerHTML = '<div class="warn">讀取失敗：' + esc(err.message) + '</div>';
  });
}).catch(e=>{
  $('status').innerHTML = '<div class="warn">無法連線：' + esc(e.message) + '</div>';
});
