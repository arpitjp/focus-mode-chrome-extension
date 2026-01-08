# Extension Icons

The extension manifest references icon files that need to be created:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

## Quick Solution

You can create simple placeholder icons using any image editor, or use online tools like:
- https://www.favicon-generator.org/
- https://realfavicongenerator.net/

## Simple Icon Creation

If you want to create simple icons quickly:

1. **Using ImageMagick** (if installed):
```bash
# Create a simple blue square icon
convert -size 16x16 xc:#667eea icon16.png
convert -size 48x48 xc:#667eea icon48.png
convert -size 128x128 xc:#667eea icon128.png
```

2. **Using Python with PIL/Pillow**:
```python
from PIL import Image, ImageDraw

sizes = [16, 48, 128]
for size in sizes:
    img = Image.new('RGB', (size, size), color='#667eea')
    img.save(f'icon{size}.png')
```

3. **Online**: Use any favicon generator and download the PNG files

## Note

The extension will work without icons, but Chrome will show a default puzzle piece icon. Creating custom icons improves the user experience.

