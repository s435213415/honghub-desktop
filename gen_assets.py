#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成桌面端所需图标：assets/tray.png(32) + assets/icon.png(256) + assets/icon.ico(256)。
仅用 Python 标准库，输出合法 PNG / ICO。图标为蓝色圆角方块 + 白色播放三角。"""
import struct, zlib, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

BG = (0x25, 0x63, 0xEB, 0xFF)   # 主题蓝
TRI = (0xFF, 0xFF, 0xFF, 0xFF)  # 白色三角


def make_png(size):
    # 画布：透明背景，中心画一个圆角近似方块（简化：整块蓝）+ 白色三角
    raw = bytearray()
    cx = cy = size / 2.0
    r = size * 0.42
    tri = [(0.30, 0.30), (0.30, 0.70), (0.72, 0.50)]  # 归一化三角形

    def in_tri(px, py):
        x = px / size; y = py / size
        def sign(a, b, c):
            return (a[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(a[1]-c[1])
        d1 = sign((x, y), tri[0], tri[1])
        d2 = sign((x, y), tri[1], tri[2])
        d3 = sign((x, y), tri[2], tri[0])
        has = (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0)
        return has

    for y in range(size):
        raw.append(0)
        for x in range(size):
            dx, dy = x - cx + 0.5, y - cy + 0.5
            if (dx*dx + dy*dy) <= r*r:
                col = BG
            elif in_tri(x, y):
                col = TRI
            else:
                col = (0, 0, 0, 0)
            raw += bytes(col)
    return encode_png(size, size, bytes(raw))


def encode_png(w, h, rgba):
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
        return c
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(rgba, 9)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')


def write_png(path, size):
    with open(path, 'wb') as f:
        f.write(make_png(size))
    print('wrote', path, size)


def write_ico(path, png_bytes):
    # ICO 含一个图像：ICONDIR + ICONDIRENTRY + PNG 数据
    png = png_bytes
    icondir = struct.pack('<HHH', 0, 1, 1)
    entry = struct.pack('<BBBBHHII',
                        # width/height 0 表示 256
                        0, 0, 0, 0, 1, 32, len(png), 6 + 16)
    with open(path, 'wb') as f:
        f.write(icondir + entry + png)
    print('wrote', path, len(png))


png32 = make_png(32)
png256 = make_png(256)
write_png(os.path.join(OUT, 'tray.png'), 32)
write_png(os.path.join(OUT, 'icon.png'), 256)
write_ico(os.path.join(OUT, 'icon.ico'), png256)
