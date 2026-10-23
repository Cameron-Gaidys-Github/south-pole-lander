// Bundles the app into one self-contained dist/index.html (three.js included),
// so it can be opened from disk, hosted on GitHub Pages, or shared as one file.
// Usage: npm run build        (add --watch to rebuild on changes)
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/app/main.js'],
  bundle: true, format: 'iife', minify: !watch, target: 'es2020', write: false, legalComments: 'none',
};

function emit(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = readFileSync('src/index.html', 'utf8');
  const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
  mkdirSync('dist', { recursive: true });
  // dist/index.html: standalone page. dist/artifact.html: body-only form for hosts that add their own skeleton.
  const [top, rest] = html.split('<div id="view">');
  const headPart = top; const bodyPart = '<div id="view">' + rest;
  writeFileSync('dist/index.html', head + headPart + '</head>\n<body>\n' + bodyPart.replace('<script>/*BUNDLE*/</script>', () => `<script>${js}</script>`) + '\n</body>\n</html>\n');
  writeFileSync('dist/artifact.html', html.replace('<script>/*BUNDLE*/</script>', () => `<script>${js}</script>`));
  console.log(`built dist/index.html (${(js.length / 1024).toFixed(0)} KB js)`);
}

if (watch) {
  const ctx = await context({ ...opts, plugins: [{ name: 'emit', setup(b) { b.onEnd(r => r.errors.length || emit(r)); } }] });
  await ctx.watch();
} else {
  emit(await build(opts));
}
