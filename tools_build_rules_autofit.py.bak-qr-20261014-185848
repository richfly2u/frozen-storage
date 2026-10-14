# -*- coding: utf-8 -*-
"""單頁規則單張 —— 自動調到「填滿一頁」
   做法：雙欄用 table（Chrome 一定吃得下）；字級從 13pt 往上試，量測實際填充率，
   取「最大且不溢出」的字級。docx 與 HTML 用同一個字級、同一個切欄點。
"""
import io, re, os, subprocess, html as _html
import numpy as np
from PIL import Image
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import segno

ROOT = r'C:\Users\alan\frozen-storage'
SRC = os.path.join(ROOT, 'index.html')
QR_PNG = os.path.join(ROOT, 'rules_qr.png')
QR_URL = 'https://richfly2u.github.io/frozen-storage/'
CHROME = r'C:\Users\alan\Chromium\chrome-win\chrome.exe'
HTML = os.path.join(ROOT, '_twocol_try.html')
PNG = os.path.join(ROOT, '_twocol_try.png')

# ---------- 內容 ----------
s = io.open(SRC, encoding='utf-8', errors='replace').read()
i = s.find('<div class="rules">'); j = s.find('<div class="tiny"', i)
if i < 0 or j <= i:
    raise SystemExit('✗ 抽不到規則區塊')
block = s[i:j]

def clean(t):
    t = re.sub(r'<br\s*/?>', '\n', t); t = re.sub(r'<[^>]+>', '', t)
    return t.replace('&nbsp;', ' ').replace('&amp;', '&').strip()

pat = re.compile(r'<h3>(?P<h3>.*?)</h3>|<div class="rn">(?P<rn>.*?)</div>|<ul class="rul"[^>]*>(?P<ul>.*?)</ul>|<div class="rtag">(?P<rtag>.*?)</div>|<div class="rwarn">(?P<rwarn>.*?)</div>', re.S)
items = []
for m in pat.finditer(block):
    d = {k: v for k, v in m.groupdict().items() if v is not None}
    k = list(d)[0]
    items.append(('ul', [clean(x) for x in re.findall(r'<li>(.*?)</li>', d['ul'], re.S)]) if k == 'ul' else (k, clean(d[k])))
h3 = [n for n, (k, _) in enumerate(items) if k == 'h3']
split = h3[2] if len(h3) >= 3 else len(items) // 2
L, R = items[:split], items[split:]
segno.make(QR_URL, error='m').save(QR_PNG, scale=12, border=2)

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

TPL = """<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
body{margin:0;width:210mm;height:297mm;padding:11mm 11mm 10mm;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;
     color:#12323f;font-size:__PT__pt;line-height:1.58;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.head{width:100%;table-layout:fixed;border-collapse:collapse}
table.head td{vertical-align:top;padding:0}
h1{margin:0;font-size:__TITLE__pt;color:#0f3b57;line-height:1.08}
.sub{margin:1.4mm 0 0;font-size:__SUB__pt;color:#777}
.qr{text-align:right}
.qr img{width:__QR__mm;height:__QR__mm}
.qrc{margin:0.7mm 0 0;font-size:__QRC__pt;color:#777;text-align:right}
table.cols{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:5mm 0;margin-top:4mm}
table.cols td{width:50%}
table.cols td{vertical-align:top;padding:0}
h3{margin:__H3TOP__mm 0 1.6mm;font-size:__HEAD__pt;color:#0f3b57;border-left:3.5px solid #1e88c7;padding-left:5px}
h3:first-child{margin-top:0}
p{margin:0 0 __PGAP__mm}
ul{margin:1mm 0 1.8mm;padding-left:6mm}
li{margin:0}
.tag{border:2px dashed #2f6fd0;border-radius:5px;background:#f7faff;color:#0b4b6b;padding:2.2mm 3mm;font-size:__TAG__pt;margin-top:3mm}
.warn{border:2.5px solid #8fbf87;border-radius:5px;background:#f2faf0;color:#245c2e;padding:2.6mm;text-align:center;font-size:__WARN__pt;font-weight:700;margin-top:2.6mm}
</style></head><body>
<table class="head"><tr>
<td><h1>冷凍庫使用規則</h1><p class="sub">炊事組　2026/10/25 訂立</p></td>
<td class="qr"><img src="rules_qr.png"><p class="qrc">掃碼看位置圖</p></td>
</tr></table>
<table class="cols"><tr>
<td>__LEFT__</td>
<td>__RIGHT__</td>
</tr></table>
</body></html>"""

def build_html(pt):
    h = (TPL.replace('__PT__', str(pt))
            .replace('__TITLE__', str(pt + 12))
            .replace('__SUB__', str(max(8, pt - 6)))
            .replace('__QR__', str(pt + 9))
            .replace('__QRC__', str(max(7, pt - 6)))
            .replace('__HEAD__', str(pt + 4))
            .replace('__H3TOP__', str(round(pt * 0.30, 1)))
            .replace('__PGAP__', str(round(pt * 0.13, 1)))
            .replace('__TAG__', str(pt - 1))
            .replace('__WARN__', str(pt + 3)))
    return h.replace('__LEFT__', to_html(L)).replace('__RIGHT__', to_html(R))

def measure(pt):
    io.open(HTML, 'w', encoding='utf-8').write(build_html(pt))
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=3.125', '--window-size=794,1123',
                    '--default-background-color=ffffffff', '--screenshot=' + PNG,
                    'file:///' + HTML.replace('\\', '/')],
                   capture_output=True, timeout=180)
    a = np.array(Image.open(PNG).convert('L')); H, W = a.shape
    ink = (a < 200)
    rows = np.where(ink.sum(axis=1) > 3)[0]
    cols = np.where(ink.sum(axis=0) > 3)[0]
    top, bot = rows[0], rows[-1]
    return (bot - top) / H, 29.7 * (H - bot) / H, 21 * cols[0] / W, 21 * (W - cols[-1]) / W, bot >= H - 2

best = None
for pt in range(13, 21):
    fv, bot_gap, lm, rm, clipped = measure(pt)
    print('  %2dpt → 垂直 %.1f%% | 下留白 %.1fcm | 左 %.1f 右 %.1f | %s' % (pt, fv*100, bot_gap, lm, rm, '溢出' if clipped else 'ok'), flush=True)
    if clipped:
        break
    best = (pt, fv, lm, rm)
print('採用字級:', best[0], 'pt（垂直 %.1f%%）' % (best[1]*100))

# 用最佳字級產出正式檔
io.open(os.path.join(ROOT, 'rules_twocol.html'), 'w', encoding='utf-8').write(build_html(best[0]))
subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--force-device-scale-factor=3.125', '--window-size=794,1123',
                '--default-background-color=ffffffff',
                '--screenshot=' + os.path.join(ROOT, 'rules_twocol_preview.png'),
                'file:///' + os.path.join(ROOT, 'rules_twocol.html').replace('\\', '/')],
               capture_output=True, timeout=180)

# ---------- docx（同字級、同切欄） ----------
PT = best[0]
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.top_margin, sec.bottom_margin = Cm(1.1), Cm(1.0)
sec.left_margin, sec.right_margin = Cm(1.1), Cm(1.1)
st = doc.styles['Normal']
st.font.name = 'Microsoft JhengHei'
st.font.size = Pt(PT)
st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
st.paragraph_format.space_after = Pt(PT * 0.12)
st.paragraph_format.space_before = Pt(0)
st.paragraph_format.line_spacing = 1.34

def sf(run, size=None, bold=False, color=None):
    size = size or PT
    run.font.name = 'Microsoft JhengHei'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
    run.font.size = Pt(size); run.font.bold = bold
    if color: run.font.color.rgb = RGBColor(*color)

def shade(p, c):
    e = OxmlElement('w:shd'); e.set(qn('w:val'), 'clear'); e.set(qn('w:fill'), c); p._p.get_or_add_pPr().append(e)

def border(p, c):
    pPr = p._p.get_or_add_pPr(); b = OxmlElement('w:pBdr')
    for side in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement('w:' + side)
        el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '8'); el.set(qn('w:space'), '3'); el.set(qn('w:color'), c)
        b.append(el)
    pPr.append(b)

ht = doc.add_table(rows=1, cols=2); ht.autofit = False; ht.alignment = WD_TABLE_ALIGNMENT.CENTER
hc0, hc1 = ht.rows[0].cells; hc0.width, hc1.width = Cm(14.8), Cm(4.0)
p = hc0.paragraphs[0]; sf(p.add_run('冷凍庫使用規則'), PT + 12, True, (0x0F, 0x3B, 0x57))
p2 = hc0.add_paragraph(); sf(p2.add_run('炊事組　2026/10/25 訂立'), max(8, PT - 6), False, (0x77, 0x77, 0x77))
pq = hc1.paragraphs[0]; pq.alignment = WD_ALIGN_PARAGRAPH.RIGHT
pq.add_run().add_picture(QR_PNG, width=Cm((PT + 9) / 10 * 1.0 * 1.0))
pq2 = hc1.add_paragraph(); pq2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
sf(pq2.add_run('掃碼看位置圖'), max(7, PT - 6), False, (0x77, 0x77, 0x77))

bt = doc.add_table(rows=1, cols=2); bt.autofit = False; bt.alignment = WD_TABLE_ALIGNMENT.CENTER
cc0, cc1 = bt.rows[0].cells
half = (21 - 2.2 - 0.5) / 2
cc0.width, cc1.width = Cm(half), Cm(half)

def render(cell, elems):
    first = True
    cell.paragraphs[0].text = ''
    for k, v in elems:
        if k == 'h3':
            p = cell.paragraphs[0] if first else cell.add_paragraph(); first = False
            p.paragraph_format.space_before = Pt(PT * 0.30); p.paragraph_format.space_after = Pt(1.6)
            sf(p.add_run(v), PT + 4, True, (0x0F, 0x3B, 0x57))
        elif k == 'rn':
            for line in v.split('\n'):
                p = cell.paragraphs[0] if first else cell.add_paragraph(); first = False
                sf(p.add_run(line))
        elif k == 'ul':
            for li in v:
                p = cell.paragraphs[0] if first else cell.add_paragraph(); first = False
                p.paragraph_format.left_indent = Cm(0.3); sf(p.add_run('· ' + li), PT - 1)
        elif k == 'rtag':
            p = cell.paragraphs[0] if first else cell.add_paragraph(); first = False
            border(p, '2F6FD0'); shade(p, 'F7FAFF'); p.paragraph_format.space_before = Pt(PT * 0.30)
            for n, line in enumerate(v.split('\n')):
                if n: p.add_run().add_break()
                sf(p.add_run(line), PT - 1, False, (0x0B, 0x4B, 0x6B))
        elif k == 'rwarn':
            p = cell.paragraphs[0] if first else cell.add_paragraph(); first = False
            border(p, '8FBF87'); shade(p, 'F2FAF0')
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Pt(PT * 0.26)
            sf(p.add_run(v), PT + 3, True, (0x24, 0x5C, 0x2E))
render(cc0, L); render(cc1, R)
out = os.path.join(ROOT, '冷凍庫使用規則_單頁.docx')
doc.save(out)
print('✓ docx:', out, os.path.getsize(out), 'bytes | 字級', PT, 'pt')
