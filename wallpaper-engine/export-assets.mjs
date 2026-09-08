// Run after image generation; pass a local sharp module path if it is not installed.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const { default: sharp } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : 'sharp');
const entries = JSON.parse(await readFile(new URL('./asset-generation.json', import.meta.url), 'utf8'));
for (const entry of entries) {
  const source = await sharp(entry.path).metadata();
  const output = new URL(`./bz-hub-landscape/assets/${entry.name}.png`, import.meta.url);
  await sharp(entry.path).resize(3440, 1440, { fit: 'cover', kernel: 'lanczos3' }).png().toFile(fileURLToPath(output));
  entry.generatedSize = [source.width, source.height];
  entry.deliveredSize = [3440, 1440];
  console.log(`${entry.name}: ${source.width}x${source.height} -> 3440x1440`);
}
await writeFile(new URL('./asset-generation.json', import.meta.url), JSON.stringify(entries, null, 2) + '\n');
