from PIL import Image
import json

# === CONFIG ===
image_path = "map.png"   # path to your exported Figma image
pixel_size = 10           # each "pixel" = 10×10 square

# color map: RGB → code
color_map = {
    (0, 0, 0): "w",        # water
    (100, 100, 100): "m",     # manhattan
    (150, 150, 150): "x",  # bronx
    (200, 200, 200): "b"   # brooklyn + queens
}

tolerance = 5  # how much variation allowed in RGB per channel

# === HELPER FUNCTION ===
def closest_region(color):
    r, g, b = color
    for ref, code in color_map.items():
        rr, gg, bb = ref
        if abs(r - rr) <= tolerance and abs(g - gg) <= tolerance and abs(b - bb) <= tolerance:
            return code
    return "?"  # unknown / unexpected color

# === LOAD IMAGE ===
im = Image.open(image_path).convert("RGB")
width, height = im.size

cols = width // pixel_size
rows = height // pixel_size

grid = []

# === READ PIXELS IN BLOCKS ===
for y in range(rows):
    row = []
    for x in range(cols):
        px = im.getpixel((x * pixel_size, y * pixel_size))
        region_code = closest_region(px)
        row.append(region_code)
    grid.append(row)

# === SAVE AS JSON ===
with open("map_data.json", "w") as f:
    json.dump(grid, f, indent=2)

print(f"✅ Exported {rows}x{cols} grid to map_data.json")
