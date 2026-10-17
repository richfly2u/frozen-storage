# -*- coding: utf-8 -*-
"""產生 list.html（唯讀材料清單）：Firebase 設定直接原封不動沿用 index.html，不解析、不重寫"""
import io, re, json, os

ROOT = r'C:\Users\alan\frozen-storage'
src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
tpl = io.open(os.path.join(ROOT, 'list_template_v3.html'), encoding='utf-8').read()

# ① Firebase 設定：raw 取出（JS 物件字面值，直接沿用）
i = src.find('window.FIREBASE_CONFIG')
i = src.find('{', i)
# 找對應的結尾：從 { 開始做括號計數
depth, j = 0, i
while j < len(src):
    if src[j] == '{': depth += 1
    elif src[j] == '}':
        depth -= 1
        if depth == 0: break
    j += 1
raw_cfg = src[i:j + 1]
assert raw_cfg.startswith('{') and len(raw_cfg) > 50, '設定抓取失敗'
print('✓ Firebase 設定 raw 長度', len(raw_cfg))

# ② STAPLES
ms = re.search(r'const STAPLES\s*=\s*\[(.*?)\];', src, re.S)
staples = re.findall(r'"([^"]+)"', ms.group(1))

# ③ FLOORS
mf = re.search(r'const FLOORS\s*=\s*\[(.*?)\];', src, re.S)
floors = []
for line in mf.group(1).splitlines():
    g = re.search(r'id:\s*(\d+).*?door:\s*"([^"]+)".*?name:\s*"([^"]+)"', line)
    if g:
        floors.append({'id': int(g.group(1)), 'door': g.group(2), 'name': g.group(3)})
assert staples and len(floors) == 5, (len(staples), len(floors))

out = (tpl.replace('__STAPLES__', json.dumps(staples, ensure_ascii=False))
          .replace('__FLOORS__',  json.dumps(floors, ensure_ascii=False))
          .replace('__FBCONFIG__', raw_cfg))
p = os.path.join(ROOT, 'list.html')
io.open(p, 'w', encoding='utf-8').write(out)
print('✓ list.html (%d bytes)｜常備 %d 項・層位 %d 層' % (os.path.getsize(p), len(staples), len(floors)))
print('  佔位符殘留:', any(x in out for x in ('__STAPLES__', '__FLOORS__', '__FBCONFIG__')))
print('  projectId 片段:', re.search(r'projectId\s*:\s*"([^"]+)"', out).group(1))
