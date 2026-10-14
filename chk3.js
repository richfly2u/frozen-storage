


const STAPLES = ["當歸", "枸杞", "紅棗", "豆包", "麵腸", "火腿", "素丸子", "牛蒡排", "鱈魚排", "飯巾布", "麵線", "饅頭", "包子", "綠豆沙餡", "小魚干", "紅糟麵腸", "黑豆", "花生仁", "大薏仁", "豆干", "大胖干", "核桃", "腰果", "海帶芽", "味噌"];
const FLOORS  = [{"id": 1, "door": "上門", "name": "中藥 湯料 五穀堅果"}, {"id": 2, "door": "上門", "name": "素料/餡料"}, {"id": 5, "door": "上門", "name": "素料"}, {"id": 3, "door": "下門", "name": "其他/私人"}, {"id": 4, "door": "下門", "name": "其他/粉類"}];
const DOORS   = [{ key:'U', label:'上門' }, { key:'D', label:'下門' }];

const $ = id => document.getElementById(id);
const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function floorNo(fid){
  const f = FLOORS.find(x => x.id === Number(fid));
  if (!f) return '';
  return FLOORS.filter(x => x.door === f.door).findIndex(x => x.id === f.id) + 1;
}

let ITEMS = [];

function render(){
  const inF = ITEMS.filter(i => (Number(i.qty)||0) > 0 && FLOORS.some(f => f.id === Number(i.floor)));
  let html = '<div class="doors">';
  DOORS.forEach(d => {
    html += '<section class="door" data-door="' + d.key + '"><div class="door-head">' + d.label + '</div><div class="shelves">';
    FLOORS.filter(f => f.door === d.label).forEach(f => {
      const list = inF.filter(i => Number(i.floor) === f.id)
                      .sort((a,b) => String(a.name||'').localeCompare(String(b.name||''), 'zh-Hant'));
      html += '<div class="tier"><div class="tier-no">第' + floorNo(f.id) + '層　' + esc(f.name) + '</div><div class="items">';
      html += list.length
        ? list.map(it => '<span class="chip">' + esc(it.name) +
            ((Number(it.qty)||0) > 0 ? '<b>' + esc(it.qty) + esc(it.unit||'') + '</b>' : '') + '</span>').join('')
        : '<span class="empty">目前空的</span>';
      html += '</div></div>';
    });
    html += '</div></section>';
  });
  html += '</div>';
  $('map').innerHTML = html;

  const names = new Set(ITEMS.map(i => i.name));
  const rest = STAPLES.filter(n => !names.has(n));
  if (rest.length){
    $('libBox').style.display = '';
    $('lib').innerHTML = rest.map(n => '<span class="chip">' + esc(n) + '</span>').join('');
  } else {
    $('libBox').style.display = 'none';
  }
  $('upd').textContent = new Date().toLocaleString('zh-TW', { hour12:false });
}

signInAnonymously(auth).then(() => {
  $('status').textContent = '';
  onSnapshot(query(collection(db, 'frozen_items'), orderBy('name')), snap => {
    ITEMS = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    render();
  }, err => {
    $('status').innerHTML = '<div class="warn">讀取失敗：' + esc(err.message) + '</div>';
  });
}).catch(e => {
  $('status').innerHTML = '<div class="warn">無法連線：' + esc(e.message) + '</div>';
});
