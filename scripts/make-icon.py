from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
destination = root / "assets" / "icon.ico"
destination.parent.mkdir(exist_ok=True)

size = 1024
icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((48, 48, 976, 976), radius=235, fill=(147, 101, 207, 255))
font_path = Path("C:/Windows/Fonts/segoeuib.ttf")
if not font_path.exists():
    font_path = Path("C:/Windows/Fonts/arialbd.ttf")
font = ImageFont.truetype(str(font_path), 700)
draw.text((500, 490), "C", font=font, fill=(255, 255, 255, 255), anchor="mm", stroke_width=0)
draw.ellipse((740, 765, 829, 854), fill=(255, 255, 255, 255))
icon.save(destination, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(destination)
