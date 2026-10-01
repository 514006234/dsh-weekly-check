# tools/make-og.py — 生成分享卡片 og.png（1200×630，微信/Twitter/Telegram 等链接预览用）
#
# 用法：python make-og.py <输出路径>
# 数据：读 report/latest.json（构建产物），改了数据重跑即可；图片是静态资源，不进 CI。
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
latest = json.load(open(os.path.join(ROOT, 'report', 'latest.json'), encoding='utf-8'))

W, H = 1200, 630
img = Image.new('RGB', (W, H), (11, 15, 23))
d = ImageDraw.Draw(img)

# 背景渐变（竖向，从 #141a26 到 #0b0f17，再压一块青色光晕）
top, bottom = (20, 26, 38), (11, 15, 23)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
glow = Image.new('RGB', (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([820, -260, 1520, 440], fill=(13, 60, 56))
img = Image.blend(img, Image.composite(glow, Image.new('RGB', (W, H), (0, 0, 0)), glow.convert('L')), 0.55)
d = ImageDraw.Draw(img)

def font(size, bold=True):
    candidates = [
        r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\Dengb.ttf',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ]
    for p in candidates:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

F_TITLE, F_SUB, F_STAT, F_NUM, F_URL = font(76), font(30, False), font(26, False), font(44), font(26, False)

plugins = latest.get('plugins') or []
stat = latest.get('stat') or {}
date = latest.get('date', '')
ok = stat.get('ok', '—'); total = stat.get('total', '—')

# 顶部标签
tag = f'每周一自动更新 · {date}'
d.rounded_rectangle([64, 56, 64 + d.textlength(tag, font=F_SUB) + 44, 106], radius=25, fill=(94, 234, 212))
d.text((64 + 22, 56 + 7), tag, font=F_SUB, fill=(4, 18, 26))

# 主标题
d.text((64, 150), 'DSH 插件周榜', font=F_TITLE, fill=(232, 238, 252))

# 副标题
d.text((64, 262), '中文策展 · GitHub 实时星数 · 免费模型真实调用实测', font=F_SUB, fill=(147, 161, 189))

# 三个数据块
def statbox(x, num, label, color):
    d.rounded_rectangle([x, 330, x + 300, 470], radius=18, fill=(24, 32, 49), outline=(36, 48, 68), width=2)
    d.text((x + 26, 356), num, font=F_NUM, fill=color)
    d.text((x + 26, 416), label, font=F_STAT, fill=(147, 161, 189))

statbox(64, f'{len(plugins)}', '收录插件 · 全部中文说明', (94, 234, 212))
statbox(388, f'{ok}/{total}', '免费模型本轮实测可用', (139, 157, 255))
statbox(712, f"{(sum(p.get('stars') or 0 for p in plugins) // 1000)}k★", f'{len(plugins)} 个项目合计星数', (255, 200, 87))

# 底部 URL
d.line([(64, 530), (1136, 530)], fill=(36, 48, 68), width=2)
d.text((64, 556), '514006234.github.io/dsh-weekly-check', font=F_URL, fill=(139, 157, 255))

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'report', 'og.png')
img.save(out, 'PNG')
print('saved', out, img.size)
