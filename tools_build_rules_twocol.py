# -*- coding: utf-8 -*-
"""冷凍庫使用規則 —— 單頁「雙欄滿版」版
   左右留白收小、雙欄排滿；docx 與 HTML 用同一套內容與同一個左右切分點（保證兩邊一致）
   產出：冷凍庫使用規則_單頁(雙欄).docx ／ rules_twocol.html（供出 A4 PNG 預覽）
"""
import io, re, os, html as _html
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC = r'C:\Users\alan\frozen-storage\index.html'
OUT_DOCX = r'C:\Users\alan\frozen-storage\冷凍庫使用規則_單頁_雙欄.docx'
OUT_HTML = r'C:\Users\alan\frozen-storage\rules_twocol.html'
QR_URL = 'https://richfly2u.github.io/frozen-storage/'
QR_PNG = r'C:\Users\alan\frozen-storage\rules_qr.png'

# 版面參數（雙欄、滿版）
BODY_PT   = 14
HEAD_PT   = 16
TITLE_PT  = 26
LINE_SP   = 1.30
MARGIN_LR = 1.2      # cm 左右邊界
COL_GAP   = 0.6      # cm 欄距

# ---------- 抽內容（單一來源；注意 .tiny 要往後找） ----------
s = io.open(SRC, encoding='utf-8', errors='replace').read()
i = s.find('<div class="rules">')
j = s.find('<div class="tiny"', i)
if i < 0 or j <= i:
    raise SystemExit('✗ 找不到規則區塊 i=%s j=%s' % (i, j))
block = s[i:j]
if len(block) < 500:
    raise SystemExit('✗ 規則區塊太短（%d 字），中止' % len(block))

def clean(t):
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    return t.replace('&nbsp;', ' ').replace('&amp;', '&').strip()

pat = re.compile(r'<h3>(?P<h3>.*?)</h3>|<div class="rn">(?P<rn>.*?)</div>|<ul class="rul"[^>]*>(?P<ul>.*?)</ul>|<div class="rtag">(?P<rtag>.*?)</div>|<div class="rwarn">(?P<rwarn>.*?)</div>', re.S)
items = []
for m in pat.finditer(block):
    d = {k: v for k, v in m.groupdict().items() if v is not None}
    k = list(d)[0]
    if k == 'ul':
        items.append(('ul', [clean(x) for x in re.findall(r'<li>(.*?)</li>', d['ul'], re.S)]))
    else:
        items.append((k, clean(d[k])))
print('元素:', [k for k, _ in items], '共', len(items))

# 依章節切成左右兩欄（一+二 ／ 三+四+重點框）
h3_idx = [n for n, (k, _) in enumerate(items) if k == 'h3']
split = h3_idx[2] if len(h3_idx) >= 3 else len(items) // 2
left_items, right_items = items[:split], items[split:]
print('左欄元素 %d、右欄元素 %d（切點 %d）' % (len(left_items), len(right_items), split))

import segno
segno.make(QR_URL, error='m').save(QR_PNG, scale=12, border=2)

# ---------- docx ----------
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.top_margin, sec.bottom_margin = Cm(1.2), Cm(1.1)
sec.left_margin, sec.right_margin = Cm(MARGIN_LR), Cm(MARGIN_LR)

st = doc.styles['Normal']
st.font.name = 'Microsoft JhengHei'
st.font.size = Pt(BODY_PT)
st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
st.paragraph_format.space_after = Pt(1.2)
st.paragraph_format.space_before = Pt(0)
st.paragraph_format.line_spacing = LINE_SP

def sf(run, size=BODY_PT, bold=False, color=None):
    run.font.name = 'Microsoft JhengHei'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
    run.font.size = Pt(size)
    run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)

def shade(p, hexc):
    e = OxmlElement('w:shd'); e.set(qn('w:val'), 'clear'); e.set(qn('w:fill'), hexc)
    p._p.get_or_add_pPr().append(e)

def border(p, hexc, sz='8'):
    pPr = p._p.get_or_add_pPr(); b = OxmlElement('w:pBdr')
    for side in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement('w:' + side)
        el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), sz); el.set(qn('w:space'), '3'); el.set(qn('w:color'), hexc)
        b.append(el)
    pPr.append(b)

# 頁首（標題 + QR，滿版；用無框表格佔滿整頁寬）
ht = doc.add_table(rows=1, cols=2); ht.autofit = False; ht.alignment = WD_TABLE_ALIGNMENT.CENTER
hc0, hc1 = ht.rows[0].cells
hc0.width, hc1.width = Cm(14.8), Cm(3.8)
p = hc0.paragraphs[0]; sf(p.add_run('冷凍庫使用規則'), TITLE_PT, True, (0x0F, 0x3B, 0x57))
p2 = hc0.add_paragraph(); sf(p2.add_run('炊事組　2026/10/25 訂立'), 10, False, (0x77, 0x77, 0x77))
pq = hc1.paragraphs[0]; pq.alignment = WD_ALIGN_PARAGRAPH.RIGHT
pq.add_run().add_picture(QR_PNG, width=Cm(2.4))
pq2 = hc1.add_paragraph(); pq2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
sf(pq2.add_run('掃碼看位置圖'), 9, False, (0x77, 0x77, 0x77))

# 兩欄主體（無框表格，欄寬各半）
bt = doc.add_table(rows=1, cols=2); bt.autofit = False; bt.alignment = WD_TABLE_ALIGNMENT.CENTER
c0, c1 = bt.rows[0].cells
half = (21 - MARGIN_LR * 2 - COL_GAP) / 2
c0.width, c1.width = Cm(half), Cm(half)

def render_into(cell, elems):
    cell.paragraphs[0].text = ''
    first = True
    for k, v in elems:
        if k == 'h3':
            p = cell.add_paragraph() if not first else cell.paragraphs[0]
            first = False
            p.paragraph_format.space_before = Pt(4); p.paragraph_format.space_after = Pt(1)
            sf(p.add_run(v), HEAD_PT, True, (0x0F, 0x3B, 0x57))
        elif k == 'rn':
            for line in v.split('\n'):
                p = cell.add_paragraph() if not first else cell.paragraphs[0]
                first = False
                sf(p.add_run(line), BODY_PT)
        elif k == 'ul':
            for li in v:
                p = cell.add_paragraph() if not first else cell.paragraphs[0]
                first = False
                p.paragraph_format.left_indent = Cm(0.35)
                sf(p.add_run('· ' + li), BODY_PT - 1)
        elif k == 'rtag':
            p = cell.add_paragraph() if not first else cell.paragraphs[0]
            first = False
            border(p, '2F6FD0'); shade(p, 'F7FAFF'); p.paragraph_format.space_before = Pt(4)
            for n, line in enumerate(v.split('\n')):
                if n: p.add_run().add_break()
                sf(p.add_run(line), BODY_PT - 1, False, (0x0B, 0x4B, 0x6B))
        elif k == 'rwarn':
            p = cell.add_paragraph() if not first else cell.paragraphs[0]
            first = False
            border(p, '8FBF87'); shade(p, 'F2FAF0')
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Pt(3)
            sf(p.add_run(v), BODY_PT + 2, True, (0x24, 0x5C, 0x2E))

render_into(c0, left_items)
render_into(c1, right_items)
doc.save(OUT_DOCX)
print('✓ docx:', OUT_DOCX, os.path.getsize(OUT_DOCX), 'bytes')

# ---------- 同版型 HTML ----------
def esc(t): return _html.escape(t)
def to_html(elems):
    out = []
    for k, v in elems:
        if k == 'h3':   out.append('<h3>%s</h3>' % esc(v))
        elif k == 'rn': out += ['<p>%s</p>' % esc(x) for x in v.split('\n')]
        elif k == 'ul': out.append('<ul>' + ''.join('<li>%s</li>' % esc(x) for x in v) + '</ul>')
        elif k == 'rtag': out.append('<div class="tag">%s</div>' % '<br>'.join(esc(x) for x in v.split('\n')))
        elif k == 'rwarn': out.append('<div class="warn">%s</div>' % esc(v))
    return '\n'.join(out)

htm = """<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
body{margin:0;width:210mm;height:297mm;padding:12mm 12mm 11mm;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;
     color:#12323f;font-size:14pt;line-height:1.34;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;flex-direction:column}
.head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:3mm}
h1{margin:0;font-size:26pt;color:#0f3b57;line-height:1.1}
.sub{margin:1.5mm 0 0;font-size:10pt;color:#777}
.qr{text-align:center}
.qr img{width:24mm;height:24mm;display:block}
.qrc{margin:0.6mm 0 0;font-size:9pt;color:#777}
.cols{display:flex;gap:6mm;flex:1}
.col{flex:1 1 0;min-width:0}
h3{margin:4mm 0 1.4mm;font-size:16pt;color:#0f3b57;border-left:3.5px solid #1e88c7;padding-left:5px}
h3:first-child{margin-top:0}
p{margin:0 0 1.3mm}
ul{margin:1mm 0 1.6mm;padding-left:6mm}
li{margin:0}
.tag{border:2px dashed #2f6fd0;border-radius:5px;background:#f7faff;color:#0b4b6b;padding:2.2mm 3mm;font-size:13pt;margin-top:3mm}
.warn{border:2.5px solid #8fbf87;border-radius:5px;background:#f2faf0;color:#245c2e;padding:2.4mm;text-align:center;font-size:16pt;font-weight:700;margin-top:2.4mm}
</style></head><body>
<div class="head">
  <div><h1>冷凍庫使用規則</h1><p class="sub">炊事組　2026/10/25 訂立</p></div>
  <div class="qr"><img src="rules_qr.png"><p class="qrc">掃碼看位置圖</p></div>
</div>
<div class="cols">
  <div class="col">
__LEFT__
  </div>
  <div class="col">
__RIGHT__
  </div>
</div>
</body></html>"""
htm = htm.replace('__LEFT__', to_html(left_items)).replace('__RIGHT__', to_html(right_items))
io.open(OUT_HTML, 'w', encoding='utf-8').write(htm)
print('✓ html:', OUT_HTML, os.path.getsize(OUT_HTML), 'bytes')
