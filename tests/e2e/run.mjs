// Tests de bout en bout dans un vrai navigateur (Chromium sans interface, rendu logiciel).
// Lance `vite preview` sur le build (dist/), puis joue des scénarios et vérifie le résultat.
// Usage : npm run build && npm run test:e2e   (ou : node tests/e2e/run.mjs --webgpu)

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return proc;
    } catch {
      // serveur pas encore prêt
    }
    await sleep(200);
  }
  proc.kill();
  throw new Error('Le serveur de prévisualisation ne démarre pas (avez-vous lancé npm run build ?)');
}

function watchErrors(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`);
  });
  return errors;
}

async function waitFor(page, fn, arg, timeout = 30000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

const sess = (page) => page.evaluate(() => window.__game.session());

async function startGame(page) {
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  await page.click('#btn-play');
  await waitFor(page, () => window.__game.screen() === 'game' && window.__game.session(), null, 60000);
  // Le joueur se pose au sol.
  await waitFor(page, () => window.__game.session().state.grounded, null, 30000);
}

/** Analyse une capture d'écran dans le navigateur : variété des couleurs, part de ciel. */
async function analyseScreenshot(browser, png) {
  const p = await browser.newPage();
  const stats = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const buckets = new Set();
    let greenish = 0;
    let n = 0;
    for (let y = Math.floor(c.height / 2); y < c.height; y += 4) {
      for (let x = 0; x < c.width; x += 4) {
        const i = (y * c.width + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const bl = d[i + 2];
        buckets.add(`${r >> 4},${g >> 4},${bl >> 4}`);
        if (g > r && g > bl * 0.9) greenish++;
        n++;
      }
    }
    return { colours: buckets.size, greenishShare: greenish / n };
  }, png.toString('base64'));
  await p.close();
  return stats;
}

async function desktopScenario(browser) {
  console.log('\n— Ordinateur (clavier, souris, réglages)');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'ordinateur');
  await page.goto(BASE);
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const info = await page.evaluate(() => ({ backend: window.__game.backend, preset: window.__game.autoPreset, gpu: window.__game.device.gpu }));
  check('Le jeu démarre et affiche l’accueil', true, `${info.backend}, qualité auto ${info.preset}, GPU ${info.gpu}`);
  check('Moteur graphique WebGL 2 actif', info.backend === 'webgl2', info.backend);

  await startGame(page);
  const s0 = await sess(page);
  check('Une partie démarre et le joueur est au sol', s0.state.grounded, `position ${s0.state.x.toFixed(1)}, ${s0.state.y.toFixed(1)}, ${s0.state.z.toFixed(1)}`);
  check('Le regard reste horizontal au démarrage (pas de mouvement parasite)', Math.abs(s0.pitch) < 0.01 && Math.abs(s0.yaw) < 0.01, `inclinaison ${s0.pitch.toFixed(3)} rad, cap ${s0.yaw.toFixed(3)} rad, pointeur verrouillé : ${(await page.evaluate(() => window.__game.input().locked))}`);
  check('Le terrain autour du joueur est chargé', s0.world.chunks >= 9, `${s0.world.chunks} chunks, ${s0.world.trees} arbres`);

  // Regard à la souris (pointeur verrouillé) : 100 px vers la droite.
  if (await page.evaluate(() => window.__game.input().locked)) {
    await sleep(300);
    const before = await sess(page);
    // Chromium sans interface simule mal les mouvements relatifs sous pointeur verrouillé :
    // on envoie directement des événements avec leur déplacement relatif (10 × 10 px).
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: 0, bubbles: true })));
      await sleep(30);
    }
    await sleep(300);
    const after = await sess(page);
    const dyaw = after.yaw - before.yaw;
    check('La souris tourne le regard', dyaw > 0.1, `${((dyaw * 180) / Math.PI).toFixed(0)}° vers la droite`);
  } else {
    check('La souris tourne le regard', false, 'pointeur non verrouillé dans ce navigateur');
  }

  await sleep(500);
  const shot = await page.screenshot();
  writeFileSync(`${OUT}ordinateur-jeu.png`, shot);
  const img = await analyseScreenshot(browser, shot);
  check('La scène 3D est dessinée (terrain visible)', img.colours > 25 && img.greenishShare > 0.05, `${img.colours} teintes, ${(img.greenishShare * 100).toFixed(0)} % de vert en bas d'écran`);

  // Marche
  let a = await sess(page);
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(400);
  let b = await sess(page);
  const walk = Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z);
  const walkTicks = b.tick - a.tick;
  check('Avancer (touche W / Z en AZERTY) déplace le joueur', walk > 1, `${walk.toFixed(2)} m en ${walkTicks} pas de simulation`);

  // Course
  a = await sess(page);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await sleep(400);
  b = await sess(page);
  const run = Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z);
  check('Courir (Maj) va plus vite que marcher', run > walk * 1.5, `${run.toFixed(2)} m contre ${walk.toFixed(2)} m`);

  // Saut
  a = await sess(page);
  await page.keyboard.down('Space');
  let maxY = a.state.y;
  for (let i = 0; i < 10; i++) {
    await sleep(60);
    maxY = Math.max(maxY, (await sess(page)).state.y);
  }
  await page.keyboard.up('Space');
  await waitFor(page, () => window.__game.session().state.grounded, null, 10000);
  check('Sauter (Espace) fait décoller le joueur', maxY - a.state.y > 0.25, `+${(maxY - a.state.y).toFixed(2)} m`);

  // Infos de performance
  await page.keyboard.press('F3');
  await sleep(600);
  const perfText = await page.textContent('#perf');
  const perfVisible = await page.isVisible('#perf');
  check('F3 affiche les infos de performance', perfVisible && /IPS/.test(perfText ?? ''), (perfText ?? '').split('\n')[0]);

  // Pause, réglages, remappage
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  check('Échap ouvre le menu pause', true);
  await page.click('#btn-pause-settings');
  await page.selectOption('#set-quality', 'low');
  await sleep(200);
  check('Changer la qualité s’applique en jeu', (await sess(page)).preset === 'low');
  await page.click('[data-add="jump"]');
  await page.keyboard.press('KeyJ');
  await sleep(100);
  const jumpBinds = await page.evaluate(() => window.__game.settings().bindings.jump);
  check('Remappage : la touche J est ajoutée à « Sauter »', jumpBinds.includes('KeyJ'), jumpBinds.join(', '));
  await page.click('#btn-settings-close');
  await page.click('#btn-resume');
  await waitFor(page, () => window.__game.screen() === 'game', null, 5000);
  await waitFor(page, () => window.__game.session().state.grounded, null, 10000);
  a = await sess(page);
  await page.keyboard.down('KeyJ');
  maxY = a.state.y;
  for (let i = 0; i < 10; i++) {
    await sleep(60);
    maxY = Math.max(maxY, (await sess(page)).state.y);
  }
  await page.keyboard.up('KeyJ');
  check('La nouvelle touche J fait sauter', maxY - a.state.y > 0.25, `+${(maxY - a.state.y).toFixed(2)} m`);

  // Réglages conservés après rechargement
  await page.reload();
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const kept = await page.evaluate(() => ({ q: window.__game.settings().quality, j: window.__game.settings().bindings.jump, seed: window.__game.settings().worldSeed }));
  check('Les réglages sont conservés après rechargement', kept.q === 'low' && kept.j.includes('KeyJ') && kept.seed !== null, `qualité ${kept.q}, monde n° ${kept.seed}`);

  check('Aucune erreur dans la console (ordinateur)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function userScreenshots(browser) {
  // Captures pour l'utilisateur (haute densité de pixels).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem('baz.settings.v1', JSON.stringify({ quality: 'high', showPerf: true, worldSeed: 20261112, adaptiveResolution: false })));
  await page.reload();
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  await page.screenshot({ path: `${OUT}capture-accueil.png` });
  await startGame(page);
  await page.keyboard.down('KeyW');
  await sleep(1200);
  await page.keyboard.up('KeyW');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}capture-jeu.png` });
  await ctx.close();
}

async function touchScenario(browser) {
  console.log('\n— Téléphone (tactile)');
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'téléphone');
  await page.goto(BASE);
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const dev = await page.evaluate(() => window.__game.device);
  check('Téléphone détecté comme appareil tactile', dev.touch && dev.mobile, `qualité auto ${await page.evaluate(() => window.__game.autoPreset)}`);
  await startGame(page);
  check('Les commandes tactiles s’affichent', await page.isVisible('[data-touch="jump"]'));
  const vp = page.viewportSize();
  const cdp = await ctx.newCDPSession(page);

  // Joystick : glisser vers le haut à gauche de l'écran.
  let a = await sess(page);
  const jx = Math.round(vp.width * 0.2);
  const jy = Math.round(vp.height * 0.6);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jx, y: jy, id: 1 }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jx, y: jy - i * 14, id: 1 }] });
    await sleep(16);
  }
  await sleep(1500);
  const mid = await page.evaluate(() => window.__game.input());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  let b = await sess(page);
  const moved = Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z);
  check('Le joystick tactile fait avancer le joueur', moved > 0.8, `${moved.toFixed(2)} m (commande avant ${mid.move.y.toFixed(2)})`);

  // Regard : glisser horizontalement à droite.
  a = await sess(page);
  const lx = Math.round(vp.width * 0.7);
  const ly = Math.round(vp.height * 0.4);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lx, y: ly, id: 2 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lx + i * 20, y: ly, id: 2 }] });
    await sleep(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  b = await sess(page);
  check('Glisser à droite tourne le regard', Math.abs(b.yaw - a.yaw) > 0.2, `${(((b.yaw - a.yaw) * 180) / Math.PI).toFixed(0)}°`);

  // Bouton Sauter
  await waitFor(page, () => window.__game.session().state.grounded, null, 10000);
  a = await sess(page);
  const box = await page.locator('[data-touch="jump"]').boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 3 }] });
  let maxY = a.state.y;
  for (let i = 0; i < 8; i++) {
    await sleep(60);
    maxY = Math.max(maxY, (await sess(page)).state.y);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('Le bouton tactile « Sauter » fait sauter', maxY - a.state.y > 0.25, `+${(maxY - a.state.y).toFixed(2)} m`);

  await page.screenshot({ path: `${OUT}telephone-jeu.png` });
  await page.tap('[data-touch="menu"]');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  check('Le bouton menu tactile met en pause', true);
  check('Aucune erreur dans la console (téléphone)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function gamepadScenario(browser) {
  console.log('\n— Manette (simulée)');
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    window.__pad = { id: 'Manette de test (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'manette');
  await page.goto(BASE);
  await startGame(page);
  let a = await sess(page);
  await page.evaluate(() => {
    window.__pad.axes = [0, -1, 0.8, 0];
  });
  await sleep(1500);
  await page.evaluate(() => {
    window.__pad.axes = [0, 0, 0, 0];
  });
  await sleep(400);
  let b = await sess(page);
  const moved = Math.hypot(b.state.x - a.state.x, b.state.z - a.state.z);
  check('Le stick gauche fait avancer', moved > 0.8, `${moved.toFixed(2)} m`);
  check('Le stick droit tourne le regard', Math.abs(b.yaw - a.yaw) > 0.3, `${(((b.yaw - a.yaw) * 180) / Math.PI).toFixed(0)}°`);
  const dev = await page.evaluate(() => window.__game.input().lastDevice);
  check('La manette est reconnue comme périphérique actif', dev === 'gamepad', dev);

  await waitFor(page, () => window.__game.session().state.grounded, null, 10000);
  a = await sess(page);
  await page.evaluate(() => {
    window.__pad.buttons[0] = { pressed: true, touched: true, value: 1 };
  });
  let maxY = a.state.y;
  for (let i = 0; i < 8; i++) {
    await sleep(60);
    maxY = Math.max(maxY, (await sess(page)).state.y);
  }
  await page.evaluate(() => {
    window.__pad.buttons[0] = { pressed: false, touched: false, value: 0 };
  });
  check('Le bouton A fait sauter', maxY - a.state.y > 0.25, `+${(maxY - a.state.y).toFixed(2)} m`);
  await page.evaluate(() => {
    window.__pad.buttons[9] = { pressed: true, touched: true, value: 1 };
  });
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  check('Le bouton Start met en pause', true);
  check('Aucune erreur dans la console (manette)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function benchScenario(browser) {
  console.log('\n— Test de performance');
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'test de performance');
  await page.goto(BASE);
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const t0 = Date.now();
  await page.click('#btn-bench');
  await page.waitForSelector('#bench-result:not([hidden])', { timeout: 240000 });
  const report = await page.textContent('#bench-report');
  writeFileSync(`${OUT}rapport-performance.txt`, report ?? '');
  const rows = (report ?? '').split('\n').filter((l) => /^(Basse|Moyenne|Haute|Ultra)\s/.test(l));
  check('Le test de performance va au bout des 4 niveaux', rows.length === 4, `${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(report);
  check('Aucune erreur dans la console (test de performance)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function webgpuScenario() {
  console.log('\n— WebGPU (expérimental)');
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('baz.settings.v1')) localStorage.setItem('baz.settings.v1', JSON.stringify({ backend: 'webgpu' }));
  });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'webgpu');
  await page.goto(BASE);
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const r = await page.evaluate(() => ({ backend: window.__game.backend, reason: window.__game.fallbackReason }));
  if (r.backend === 'webgpu') {
    await startGame(page);
    await sleep(800);
    const shot = await page.screenshot();
    writeFileSync(`${OUT}webgpu-jeu.png`, shot);
    const img = await analyseScreenshot(browser, shot);
    check('WebGPU : la scène est dessinée', img.colours > 25 && img.greenishShare > 0.05, `${img.colours} teintes`);
    check('Aucune erreur dans la console (WebGPU)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } else {
    check('WebGPU indisponible ici : repli automatique sur WebGL', r.backend === 'webgl2', r.reason ?? '');
  }
  await browser.close();
}

// --only=ordinateur,telephone,manette,performance,captures,webgpu pour ne lancer que certains scénarios.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const want = (name) => (only ? only.has(name) : name !== 'webgpu' || process.argv.includes('--webgpu'));

const server = await startServer();
try {
  const browser = await chromium.launch();
  if (want('ordinateur')) await desktopScenario(browser);
  if (want('telephone')) await touchScenario(browser);
  if (want('manette')) await gamepadScenario(browser);
  if (want('performance')) await benchScenario(browser);
  if (want('captures')) await userScreenshots(browser);
  await browser.close();
  if (want('webgpu')) await webgpuScenario();
} catch (err) {
  check('Exécution des scénarios', false, err instanceof Error ? err.stack : String(err));
} finally {
  server.kill();
}
writeFileSync(`${OUT}resultats.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failures}/${results.length} vérifications réussies.`);
process.exit(failures === 0 ? 0 : 1);
