#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成深开鸿 HAP 工程所需的图标（AppScope 与 entry 的 media）。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))


def make_icon(size, path, bg='#12151F', fg='#FF4D5E'):
    img = Image.new('RGBA', (size, size), bg)
    d = ImageDraw.Draw(img)
    # 圆角外环
    m = int(size * 0.10)
    d.rounded_rectangle([m, m, size - m, size - m], radius=int(size * 0.18),
                        outline=fg, width=max(2, int(size * 0.045)))
    # 播放三角
    cx, cy = size // 2, size // 2
    r = int(size * 0.20)
    d.polygon([(cx - r * 0.6, cy - r), (cx - r * 0.6, cy + r), (cx + r, cy)], fill=fg)
    img.save(path)
    print('生成图标：', path, img.size)


def main():
    app_icon = os.path.join(ROOT, 'AppScope', 'resources', 'base', 'media', 'app_icon.png')
    entry_icon = os.path.join(ROOT, 'entry', 'src', 'main', 'resources', 'base', 'media', 'icon.png')
    make_icon(1024, app_icon)
    make_icon(256, entry_icon)
    # 额外提供常用分辨率（部分 DevEco 版本会校验）
    for s in (48, 72, 96, 144, 192):
        make_icon(s, os.path.join(os.path.dirname(entry_icon), 'icon_%dx%d.png' % (s, s)))


if __name__ == '__main__':
    main()
