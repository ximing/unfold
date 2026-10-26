import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const logo = path.join(repoRoot, 'logo.png');
const trayOnly = process.argv.includes('--tray');

function magick(args) {
  const result = spawnSync('magick', args, { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const iconsDir = path.join(desktopRoot, 'src-tauri', 'icons');
const assetsDir = path.join(desktopRoot, 'assets');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

const mark = path.join(tmpdir(), 'unfold-icon-mark.png');
magick([
  logo,
  '-alpha', 'set',
  '-fuzz', '4%',
  '-transparent', 'rgb(253,254,254)',
  '-trim',
  '+repage',
  mark,
]);

if (!trayOnly) {
  const source = path.join(assetsDir, 'icon-source.png');
  // 1024 画布。外圈 112px 透明，白底和标记相对原先 64px 边距同比缩小。
  const canvas = 1024;
  const margin = 112;
  const plate = canvas - margin * 2;
  const end = canvas - margin - 1;
  const markSize = Math.round((plate * 760) / 896);
  const radius = Math.round((plate * 200) / 896);
  magick([
    '-size', `${canvas}x${canvas}`, 'xc:none',
    '-fill', 'white',
    '-draw', `roundrectangle ${margin},${margin} ${end},${end} ${radius},${radius}`,
    '(', mark, '-resize', `${markSize}x${markSize}`, ')',
    '-gravity', 'center',
    '-compose', 'over',
    '-composite',
    '-depth', '8',
    `PNG32:${source}`,
  ]);
  const icon = spawnSync('pnpm', ['exec', 'tauri', 'icon', 'assets/icon-source.png'], {
    cwd: desktopRoot,
    stdio: 'inherit',
  });
  if (icon.status !== 0) process.exit(icon.status ?? 1);
  magick([source, '-resize', '16x16', '-depth', '8', `PNG32:${path.join(iconsDir, '16x16.png')}`]);
  magick([source, '-resize', '256x256', '-depth', '8', `PNG32:${path.join(iconsDir, '256x256.png')}`]);
}

magick([
  mark,
  '-resize', '26x26',
  '-background', 'none',
  '-gravity', 'center',
  '-extent', '32x32',
  '-fill', 'black',
  '-colorize', '100',
  '-depth', '8',
  `PNG32:${path.join(iconsDir, 'tray.png')}`,
]);

const keepIcons = new Set([
  '16x16.png',
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  '256x256.png',
  'icon.png',
  'icon.icns',
  'icon.ico',
  'tray.png',
]);

function pruneIcons() {
  rmSync(path.join(iconsDir, 'ios'), { recursive: true, force: true });
  rmSync(path.join(iconsDir, 'android'), { recursive: true, force: true });
  for (const name of readdirSync(iconsDir)) {
    if (!keepIcons.has(name)) rmSync(path.join(iconsDir, name), { recursive: true, force: true });
  }
}

if (!trayOnly) pruneIcons();
