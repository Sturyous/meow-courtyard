from PIL import Image, ImageDraw

src = r'D:\个人材料\灵感创作\喵庭\meow-courtyard-main\public\assets\Asset_type__finished_3_2_top_d_2026-09-29T12-44-17.png'
dst = r'D:\个人材料\灵感创作\喵庭\meow-courtyard-main\public\assets\cabin-bg.png'

img = Image.open(src).convert('RGB')
w, h = img.size
sample = img.getpixel((int(w * 0.84), int(h * 0.97)))
x0, y0 = int(w * 0.90), int(h * 0.945)
draw = ImageDraw.Draw(img)
draw.rectangle([x0, y0, w, h], fill=sample)
img.save(dst)
print(f'{w}x{h} sample={sample} -> cabin-bg.png')
