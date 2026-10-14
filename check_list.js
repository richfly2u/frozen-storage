


const STAPLES = ["當歸", "枸杞", "紅棗", "豆包", "麵腸", "火腿", "素丸子", "牛蒡排", "鱈魚排", "飯巾布", "麵線", "饅頭", "包子", "綠豆沙餡", "小魚干", "紅糟麵腸", "黑豆", "花生仁", "大薏仁", "豆干", "大胖干", "核桃", "腰果", "海帶芽", "味噌"];
const FLOORS  = [{"id": 1, "door": "上門", "name": "中藥 湯料 五穀堅果"}, {"id": 2, "door": "上門", "name": "素料/餡料"}, {"id": 5, "door": "上門", "name": "素料"}, {"id": 3, "door": "下門", "name": "其他/私人"}, {"id": 4, "door": "下門", "name": "其他/粉類"}];

const $ = id => document.getElementById(id);
const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function floorLabel(f){
  if (!f) return '（未指定層位）';
  const x = FLOORS.find(y=>y.id===f.id) || f;
  return (x.door||'') + '　第' + (FLOORS.filter(y=>y.door===x.door).sort((a,b)=>a.local-b.local).findIndex(y=>y.id===x.id)+1) + '層' + (x.slot?'・'+x.slot:'');
}

let ITEMS = [];

function render(){
  const box = $('floors');
  const byFloor = {};
  ITEMS.forEach(it => { const k = it.floor && it.floor.id ? it.floor.id : 0; (byFloor[k] = byFloor[k] || []).push(it); });
  const order = FLOORS.map(f=>f.id).concat([0]);
  let html = '';
  order.forEach(fid => {
    const list = byFloor[fid]; if (!list || !list.length) return;
    list.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'));
    const f = FLOORS.find(x=>x.id===fid);
    html += '<div class="floor"><div class="fh"><b>' + esc(floorLabel(f)) + '</b>' +
            (f && f.name ? '<span>' + esc(f.name) + '</span>' : '') +
            '<span>・' + list.length + ' 項</span></div><div class="items">' +
            list.map(it => '<div class="chip">' + esc(it.name) +
              ((it.qty||0) > 0 ? '<i>' + esc(it.qty) + esc(it.unit||'') + '</i>' : '') +
              '</div>').join('') +
            '</div></div>';
  });
  if (!html) html = '<div class="floor"><div class="empty">冰箱內目前沒有登記的品項</div></div>';
  box.innerHTML = html;

  const have = new Set(ITEMS.map(i=>i.name));
  const rest = STAPLES.filter(n=>!have.has(n));
  $('staples').innerHTML = rest.length
    ? rest.map(n=>'<span class="chip">'+esc(n)+'</span>').join('')
    : '<div class="empty">常備材料都已在冰箱內</div>';

  $('upd').textContent = new Date().toLocaleString('zh-TW',{hour12:false});
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
