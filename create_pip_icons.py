#!/usr/bin/env python3
"""
Script to create Pip icon files from a source image.

Usage:
1. Save the Pip bird image as 'pip_bird.png' in the project root
2. Run: python create_pip_icons.py

This will create icon16.png, icon48.png, and icon128.png in docs/assets/
"""

from PIL import Image
import os

def create_icons(source_path='pip_bird.png'):
    """Create extension icons from source image."""
    
    if not os.path.exists(source_path):
        print(f"Error: Source image '{source_path}' not found.")
        print("Please save the Pip bird image as 'pip_bird.png' in the project root.")
        return False
    
    # Open source image
    img = Image.open(source_path)
    
    # Convert to RGBA if necessary (for transparency support)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Target sizes for Chrome extension icons
    sizes = [16, 48, 128]
    output_dir = 'docs/assets'
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    for size in sizes:
        # Resize using high-quality resampling
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save
        output_path = os.path.join(output_dir, f'icon{size}.png')
        resized.save(output_path, 'PNG', optimize=True)
        print(f"Created: {output_path}")
    
    print("\n✅ All icons created successfully!")
    print("Reload the extension in chrome://extensions to see the new icon.")
    return True

if __name__ == '__main__':
    create_icons()
