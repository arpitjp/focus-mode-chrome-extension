#!/usr/bin/env python3
"""
Simple script to create placeholder icons for the Chrome extension.
Requires Pillow: pip install Pillow
"""

try:
    from PIL import Image, ImageDraw
    
    sizes = [16, 48, 128]
    color = (102, 126, 234)  # #667eea in RGB
    
    for size in sizes:
        # Create a new image with the color
        img = Image.new('RGB', (size, size), color)
        
        # Draw a simple "B" for Blocker
        draw = ImageDraw.Draw(img)
        # Draw a border
        border_width = max(1, size // 16)
        draw.rectangle([border_width, border_width, size - border_width - 1, size - border_width - 1], 
                      outline=(255, 255, 255), width=border_width)
        
        # Save the icon
        img.save(f'icon{size}.png')
        print(f'Created icon{size}.png')
    
    print('\nIcons created successfully!')
    
except ImportError:
    print("Pillow is not installed. Installing...")
    import subprocess
    import sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    print("Please run this script again.")
except Exception as e:
    print(f"Error creating icons: {e}")
    print("\nYou can also create simple colored square images manually:")
    print("- icon16.png: 16x16 pixels, color #667eea")
    print("- icon48.png: 48x48 pixels, color #667eea")
    print("- icon128.png: 128x128 pixels, color #667eea")

