# -*- coding: utf-8 -*-
"""冷凍庫使用規則 —— 單頁（A4）壓縮版
   產出：①冷凍庫使用規則_單頁.docx ②同版型 HTML（供 Chrome 出 A4 PNG 預覽）
   內容一律從 index.html 的規則面板抽取（單一來源），不手打。
"""
import io, re, os, html as _html
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SRC = r'C:\Users\alan\frozen-storage\index.html'
OUT_DOCX = r'C:\Users\alan\frozen-storage\冷凍庫使用規則_單頁.docx'
OUT_HTML = r'C:\Users\alan\frozen-storage\rules_onepage.html'
QR_URL = 'https://richfly2u.github.io/frozen-storage/'
QR_PNG = r'C:\Users\alan\frozen-storage\rules_qr.png'

# ---------- 抽內容（單一來源） ----------
s = io.open(SRC, encoding='utf-8', errors='replace').read()
i = s.find('<div class="rules">')
j = s.find('<div class="tiny"', i)          # 一定要往後找！檔案前面還有別的 .tiny
if i < 0 or j < 0 or j <= i:
    raise SystemExit('✗ 找不到規則區塊 i=%s j=%s' % (i, j))
block = s[i:j]
if len(block) < 500:
    raise SystemExit('✗ 規則區塊太短（%d 字）→ 抽取有問題，中止以免產出空文件' % len(block))

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
print('抽到元素:', [k for k, _ in items])

# ---------- QR ----------
import segno
segno.make(QR_URL, error='m').save(QR_PNG, scale=12, border=2)

# ---------- 建立 docx（單頁版） ----------
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
for a, v in (('top_margin', 1.4), ('bottom_margin', 1.2), ('left_margin', 1.5), ('right_margin', 1.5)):
    setattr(sec, a, Cm(v))

st = doc.styles['Normal']
st.font.name = 'Microsoft JhengHei'
st.font.size = Pt(16)
st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
st.paragraph_format.space_after = Pt(1)
st.paragraph_format.space_before = Pt(0)
st.paragraph_format.line_spacing = 1.32

def sf(run, size=16, bold=False, color=None):
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
    pPr = p._p.get_or_add_pPr()
    b = OxmlElement('w:pBdr')
    for side in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement('w:' + side)
        el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), sz); el.set(qn('w:space'), '3'); el.set(qn('w:color'), hexc)
        b.append(el)
    pPr.append(b)

# 標題 + QR 並排（1x2 無框表格，省垂直空間）
tbl = doc.add_table(rows=1, cols=2)
tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
tbl.autofit = False
c0, c1 = tbl.rows[0].cells
c0.width, c1.width = Cm(13.4), Cm(4.8)
p = c0.paragraphs[0]
sf(p.add_run('冷凍庫使用規則'), 28, True, (0x0F, 0x3B, 0x57))
p2 = c0.add_paragraph()
sf(p2.add_run('炊事組　2026/10/25 訂立'), 12, False, (0x77, 0x77, 0x77))
pq = c1.paragraphs[0]; pq.alignment = WD_ALIGN_PARAGRAPH.RIGHT
pq.add_run().add_picture(QR_PNG, width=Cm(4.2))
pq2 = c1.add_paragraph(); pq2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
sf(pq2.add_run('掃碼看位置圖'), 11, False, (0x77, 0x77, 0x77))

def h(t):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3.5); p.paragraph_format.space_after = Pt(0.5)
    sf(p.add_run(t), 18, True, (0x0F, 0x3B, 0x57))

for k, v in items:
    if k == 'h3':
        h(v)
    elif k == 'rn':
        for line in v.split('\n'):
            p = doc.add_paragraph(); sf(p.add_run(line), 16)
    elif k == 'ul':
        for li in v:
            p = doc.add_paragraph(); p.paragraph_format.left_indent = Cm(0.5); sf(p.add_run('· ' + li), 14)
    elif k == 'rtag':
        p = doc.add_paragraph(); border(p, '2F6FD0'); shade(p, 'F7FAFF')
        p.paragraph_format.space_before = Pt(3)
        for n, line in enumerate(v.split('\n')):
            if n: p.add_run().add_break()
            sf(p.add_run(line), 14, False, (0x0B, 0x4B, 0x6B))
    elif k == 'rwarn':
        p = doc.add_paragraph(); border(p, '8FBF87'); shade(p, 'F2FAF0')
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Pt(2.5)
        sf(p.add_run(v), 17, True, (0x24, 0x5C, 0x2E))
doc.save(OUT_DOCX)
print('✓ docx:', OUT_DOCX, os.path.getsize(OUT_DOCX), 'bytes')

# ---------- 垂直空間預算（驗證單頁） ----------
lines = 0
for k, v in items:
    if k == 'h3':
        lines += 1.6
    elif k == 'rn':
        lines += len(str(v).split('\n'))
    elif k == 'ul':
        lines += len(v) * 0.95
    elif k == 'rtag':
        lines += 2.6
    elif k == 'rwarn':
        lines += 1.6
usable_cm = (29.7 - 1.1 - 1.0)
per_line_cm = 16 * 1.32 * 1.2 / 72 * 2.54
need_cm = lines * per_line_cm + 2.2   # +標題區與段距
print('  預估內容行數當量: %.1f' % lines)
print('  需要高度: %.1f cm / 可用: %.1f cm → %s' % (need_cm, usable_cm, '✅ 單頁可容納' if need_cm < usable_cm else '❌ 可能超出一頁'))

# ---------- 同版型 HTML（給 Chrome 出 A4 PNG 預覽） ----------
def esc(t): return _html.escape(t)
rows = []
for k, v in items:
    if k == 'h3':
        rows.append('<h3>%s</h3>' % esc(v))
    elif k == 'rn':
        for line in v.split('\n'):
            rows.append('<p>%s</p>' % esc(line))
    elif k == 'ul':
        rows.append('<ul>' + ''.join('<li>%s</li>' % esc(x) for x in v) + '</ul>')
    elif k == 'rtag':
        rows.append('<div class="tag">%s</div>' % '<br>'.join(esc(x) for x in v.split('\n')))
    elif k == 'rwarn':
        rows.append('<div class="warn">%s</div>' % esc(v))

htm = """<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
body{margin:0;width:210mm;height:297mm;padding:13mm 15mm 11mm;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;
     color:#12323f;font-size:16pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.head{width:100%;border-collapse:collapse;margin-bottom:2mm}
table.head td{vertical-align:top;padding:0}
h1{margin:0;font-size:28pt;color:#0f3b57}
.sub{margin:1.5mm 0 0;font-size:12pt;color:#777}
.qr{text-align:right}
.qr img{width:42mm;height:42mm}
.qrc{margin:1mm 0 0;font-size:11pt;color:#777;text-align:right}
h3{margin:4.8mm 0 1.5mm;font-size:18pt;color:#0f3b57;border-left:3.2px solid #1e88c7;padding-left:4px}
p{margin:0 0 1.6mm}
ul{margin:1mm 0 1.6mm;padding-left:7mm}
li{margin:0}
.tag{border:2px dashed #2f6fd0;border-radius:4px;background:#f7faff;color:#0b4b6b;padding:1.6mm 2.4mm;font-size:14pt;margin-top:3.8mm}
.warn{border:2.5px solid #8fbf87;border-radius:5px;background:#f2faf0;color:#245c2e;padding:2.4mm;text-align:center;font-size:17pt;font-weight:700;margin-top:1.5mm}
</style></head><body>
<table class="head"><tr>
<td><h1>冷凍庫使用規則</h1><p class="sub">炊事組　2026/10/25 訂立</p></td>
<td class="qr"><img src="rules_qr.png"><p class="qrc">掃碼看位置圖</p></td>
</tr></table>
@@ROWS@@
</body></html>"""
htm = htm.replace('@@ROWS@@', '\n'.join(rows))
io.open(OUT_HTML, 'w', encoding='utf-8').write(htm)
print('✓ html:', OUT_HTML, os.path.getsize(OUT_HTML), 'bytes')
