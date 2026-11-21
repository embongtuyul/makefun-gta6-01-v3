// main.ts — grader entrypoint: copies game/ and screenshots/ into
// $MAKEFUN_OUTPUT_DIR and writes dossier.json. Standard library only,
// no network, deterministic output. NEVER removes the output directory
// (round-1 lesson: rmSync(outDir) fails with EACCES as uid 65534).
import { cpSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || join(repoRoot, 'output');

function copyTree(src: string, dest: string): { files: number; bytes: number } {
  mkdirSync(dest, { recursive: true });
  let files = 0;
  let bytes = 0;
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const e of entries) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (e.isDirectory()) {
      const sub = copyTree(from, to);
      files += sub.files;
      bytes += sub.bytes;
    } else if (e.isFile()) {
      cpSync(from, to);
      files++;
      bytes += statSync(from).size;
    }
  }
  return { files, bytes };
}

async function writeDossier(): Promise<void> {
  // The kit's dossier library, byte-identical in vendor/. The gate rebuilds
  // the dossier with the same library and compares byte for byte, so the call
  // must match the scorer's exactly: dir is the OUTPUT directory (game/ and
  // screenshots/ are already copied there by main() before this runs), caps
  // are the gate.json values. buildDossier returns canonical JSON bytes —
  // write them verbatim, no stringify, no added newline. If it throws, fail
  // loudly (no placeholder): a fake dossier fails dossier_matches anyway.
  const mod = await import('./vendor/makefun-game.ts');
  const buildDossier = mod.buildDossier;
  if (typeof buildDossier !== 'function') throw new Error('buildDossier not exported');
  const bytes: Uint8Array = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), bytes);
  console.log(`dossier.json written via buildDossier (${bytes.length} bytes)`);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const game = copyTree(join(repoRoot, 'game'), join(outDir, 'game'));
  let shots = { files: 0, bytes: 0 };
  try {
    statSync(join(repoRoot, 'screenshots'));
    shots = copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  } catch {
    mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  }
  await writeDossier();
  const totalKb = Math.round((game.bytes + shots.bytes) / 1024);
  console.log(
    `SOLMARA build done: ${game.files} game files, ${shots.files} screenshots, ${totalKb} KiB -> ${outDir}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
