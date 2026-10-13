# -*- coding: utf-8 -*-
"""生成 PWA 图标集：从吉祥物头像生成 普通/遮罩/苹果 三套尺寸。"""
from PIL import Image
import os

SRC = "src/assets/design/mascot/miao-avatar-fluffy-v1.png"
OUT = "public/icons"
BRAND = (168, 85, 247, 255)      # 主题紫 #a855f7（maskable 背景）
CREAM = (255, 245, 233, 255)     # 奶油底 #fff5e9（apple-touch 背景）

def load_mascot():
    im = Image.open(SRC).convert("RGBA")
    return im.crop(im.getbbox())  # 裁掉透明边

def make_icon(size, ratio, bg=None, path=None):
    canvas = Image.new("RGBA", (size, size), bg if bg else (0, 0, 0, 0))
    side = max(1, int(size * ratio))
    m = mascot.copy()
    m.thumbnail((side, side), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    out = os.path.join(OUT, path or f"icon-{size}.png")
    canvas.save(out, "PNG")
    print("wrote", out, canvas.size)

mascot = load_mascot()
os.makedirs(OUT, exist_ok=True)

make_icon(192, 0.86)                                   # 普通：透明底
make_icon(512, 0.86)
make_icon(192, 0.70, bg=BRAND, path="maskable-192.png")  # maskable：紫铺满
make_icon(512, 0.70, bg=BRAND, path="maskable-512.png")
make_icon(180, 0.80, bg=CREAM, path="apple-touch-icon.png")  # apple：奶油底
print("DONE")
