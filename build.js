#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { minify } = require('terser');

const DIST_DIR = 'dist';
const FILES_TO_MINIFY = [
  'background.js',
  'popup.js',
  'blocked.js',
  'content-blocker.js',
  'offscreen.js',
  'stats.js'
];
const FILES_TO_COPY = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'blocked.html',
  'offscreen.html',
  'stats.html',
  'icon16.png',
  'icon48.png',
  'icon128.png',
  'assets/ding.mp3'
];

async function build() {
  const mode = process.argv[2]; // 'preview' or 'deploy'
  const isDeploy = mode === 'deploy';

  console.log(`\n🚀 ${isDeploy ? 'DEPLOY' : 'PREVIEW'} build...\n`);

  // Read manifest
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  let version = manifest.version;

  // Bump version only for deploy
  if (isDeploy) {
    console.log('📦 Bumping version...');
    const [major, minor, patch] = version.split('.').map(Number);
    version = `${major}.${minor}.${patch + 1}`;
    
    // Update manifest.json
    manifest.version = version;
    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    
    // Update package.json
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = version;
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    
    console.log(`   ${version}`);
  } else {
    console.log(`📦 Version: ${version} (preview - no bump)`);
  }

  // Clean and create dist directory
  console.log('\n🧹 Cleaning dist...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  // Minify JS files
  console.log('\n🔧 Minifying JavaScript...');
  for (const file of FILES_TO_MINIFY) {
    if (!fs.existsSync(file)) {
      console.log(`   ⚠️  Skipping ${file} (not found)`);
      continue;
    }
    const code = fs.readFileSync(file, 'utf8');
    try {
      const result = await minify(code, {
        compress: {
          drop_console: true,
          drop_debugger: true
        },
        mangle: true
      });
      fs.writeFileSync(path.join(DIST_DIR, file), result.code);
      const savings = ((1 - result.code.length / code.length) * 100).toFixed(1);
      console.log(`   ✓ ${file} (-${savings}%)`);
    } catch (e) {
      console.error(`   ✗ ${file}: ${e.message}`);
      fs.copyFileSync(file, path.join(DIST_DIR, file));
    }
  }

  // Copy other files (use updated manifest for deploy)
  console.log('\n📄 Copying files...');
  for (const file of FILES_TO_COPY) {
    if (!fs.existsSync(file)) {
      console.log(`   ⚠️  Skipping ${file} (not found)`);
      continue;
    }
    const destPath = path.join(DIST_DIR, file);
    const destDir = path.dirname(destPath);
    
    // Create subdirectory if needed
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    if (file === 'manifest.json' && isDeploy) {
      // Write the updated manifest to dist
      fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2) + '\n');
    } else {
      fs.copyFileSync(file, destPath);
    }
    console.log(`   ✓ ${file}`);
  }

  // Create zip archive
  console.log('\n📦 Creating archive...');
  const zipName = `focus-blocker-v${version}.zip`;
  
  execSync(`cd ${DIST_DIR} && zip -rq ../${zipName} .`, { stdio: 'pipe' });
  console.log(`   ✓ ${zipName} (${(fs.statSync(zipName).size / 1024).toFixed(1)} KB)`);

  // Git commit and push only for deploy
  if (isDeploy) {
    console.log('\n🚀 Committing and pushing...');
    try {
      execSync('git add -A', { stdio: 'pipe' });
      execSync(`git commit -m "release: v${version}"`, { stdio: 'pipe' });
      execSync('git push', { stdio: 'pipe' });
      console.log('   ✓ Pushed to GitHub');
    } catch (e) {
      console.log('   ⚠️  Git push failed or nothing to commit');
    }
  }

  console.log(`\n✅ ${isDeploy ? 'Deploy' : 'Preview'} complete! v${version}`);
  console.log(`   📦 ${zipName} (for Chrome Web Store)\n`);
}

build().catch(console.error);
