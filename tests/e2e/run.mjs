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
  // Groupe de processus à part : on arrête npx et le serveur vite qu'il lance (sinon il resterait ouvert).
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  proc.stop = () => {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      proc.kill();
    }
  };
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return proc;
    } catch {
      // serveur pas encore prêt
    }
    await sleep(200);
  }
  proc.stop();
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
  check('Les commandes tactiles s’affichent (sauter, courir, accroupir, prendre, lancer)', (await Promise.all(['jump', 'sprint', 'crouch', 'interact', 'throw'].map((b) => page.isVisible(`[data-touch="${b}"]`)))).every(Boolean));
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

async function phase2Scenario(browser) {
  console.log('\n— Phase 2 : monde du Zimbabwe, nage, escalade, objets');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('baz.settings.v1')) localStorage.setItem('baz.settings.v1', JSON.stringify({ worldSeed: 20261112, spawnSeed: 1, quality: 'low', adaptiveResolution: false }));
  });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 2');
  await page.goto(BASE);
  await startGame(page);
  let st = await sess(page);
  check('Apparition au hasard dans le monde de 16 km', Math.abs(st.state.x) < 7100 && Math.abs(st.state.z) < 7100 && Math.hypot(st.state.x, st.state.z) > 50, `point (${Math.round(st.state.x)}, ${Math.round(st.state.z)}), biome ${st.biome}`);
  check('Le terrain est calculé dans un fil séparé', st.jobsWorkers === true);

  const settle = async () => {
    await waitFor(page, () => window.__game.session().world.pending === 0, null, 60000).catch(() => undefined);
    await sleep(400);
  };

  // Téléportation dans chaque région.
  const tours = [
    ['plateau', 'plateau'],
    ['miombo', 'miombo'],
    ['vallee', 'vallee'],
    ['hautes_terres', 'hautes_terres'],
    ['lowveld', 'lowveld'],
    ['kalahari', 'kalahari'],
    ['matobo', 'matobo'],
  ];
  for (const [id, biome] of tours) {
    await page.evaluate((d) => window.__game.teleport(d), id);
    await settle();
    await waitFor(page, () => window.__game.session().state.grounded, null, 20000).catch(() => undefined);
    st = await sess(page);
    check(`Téléportation : ${id}`, st.biome === biome, `biome ${st.biome}, sol ${st.state.surface}, ${st.world.chunks} chunks, ${st.world.trees} arbres`);
    await page.screenshot({ path: `${OUT}biome-${id}.png` });
  }

  // Nage et plongée.
  await page.evaluate(() => window.__game.teleport('lac'));
  await settle();
  await sleep(1500);
  st = await sess(page);
  check('Dans le lac, on nage', st.state.mode === 1, `mode ${st.state.mode}, y ${st.state.y.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}lac-surface.png` });
  const y0 = st.state.y;
  await page.keyboard.down('KeyC');
  await sleep(2500);
  st = await sess(page);
  await page.screenshot({ path: `${OUT}lac-plongee.png` });
  await page.keyboard.up('KeyC');
  check('Plonger fait descendre et consomme le souffle', st.state.y < y0 - 1 && st.state.breath < 100, `y ${st.state.y.toFixed(1)}, souffle ${Math.round(st.state.breath)}`);
  check('La barre de souffle s’affiche sous l’eau', await page.isVisible('#status .bar.breath'));
  await page.keyboard.down('Space');
  await sleep(3000);
  await page.keyboard.up('Space');

  // Escalade d'une paroi de granit.
  await page.evaluate(() => window.__game.teleport('kopje'));
  await settle();
  await waitFor(page, () => window.__game.session().state.grounded, null, 20000).catch(() => undefined);
  await page.keyboard.down('KeyW');
  let climbing = false;
  let startY = 0;
  for (let i = 0; i < 30 && !climbing; i++) {
    await sleep(150);
    await page.keyboard.press('Space');
    st = await sess(page);
    if (st.state.mode === 2) {
      climbing = true;
      startY = st.state.y;
    }
  }
  check('Face à une paroi de granit, Espace fait grimper', climbing, climbing ? `y ${startY.toFixed(1)}` : 'paroi non atteinte');
  if (climbing) {
    await sleep(2500);
    st = await sess(page);
    await page.screenshot({ path: `${OUT}escalade.png` });
    check('En grimpant, on monte et l’endurance baisse', st.state.y > startY + 0.8 && st.state.stamina < 100, `+${(st.state.y - startY).toFixed(1)} m, endurance ${Math.round(st.state.stamina)}`);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyC');
  await sleep(1500);

  // Accroupissement.
  await page.evaluate(() => window.__game.teleport('plateau'));
  await settle();
  await waitFor(page, () => window.__game.session().state.grounded, null, 20000).catch(() => undefined);
  await page.keyboard.down('KeyC');
  await sleep(500);
  const crouched = (await sess(page)).state.crouched;
  await page.keyboard.up('KeyC');
  await sleep(500);
  check('C : s’accroupir, puis se relever', crouched && !(await sess(page)).state.crouched);

  // Endurance visible en courant.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(1500);
  const barVisible = await page.isVisible('#status .bar.stamina');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  check('La barre d’endurance s’affiche en courant', barVisible);

  // Objets : trouver une pierre, la prendre, la poser, la lancer.
  await page.evaluate(() => window.__game.teleport('matobo'));
  await settle();
  await waitFor(page, () => window.__game.session().state.grounded, null, 20000).catch(() => undefined);
  st = await sess(page);
  const stones = st.props.filter((p) => p.kind === 'pierre').sort((a, b) => Math.hypot(a.x - st.state.x, a.z - st.state.z) - Math.hypot(b.x - st.state.x, b.z - st.state.z));
  check('Des objets déplaçables existent autour du joueur', st.props.length > 0, `${st.props.length} objets, ${stones.length} pierres`);
  // On essaie les pierres les plus proches jusqu'à en viser une (relief, rochers…).
  let stone = null;
  for (const candidate of stones.slice(0, 8)) {
    await page.evaluate((p) => window.__game.place(p.x - 1.1, p.z), candidate);
    await sleep(700);
    const now = (await sess(page)).props.find((p) => p.id === candidate.id);
    if (!now) continue;
    await page.evaluate((p) => window.__game.lookAt(p.x, p.y, p.z), now);
    await sleep(300);
    if ((await sess(page)).target?.id === candidate.id) {
      stone = candidate;
      break;
    }
  }
  const promptText = (await page.textContent('#prompt')) ?? '';
  check('Viser une pierre affiche « prendre »', stone !== null && /prendre/.test(promptText), promptText);
  if (stone) {
    await page.keyboard.press('KeyE');
    await sleep(500);
    st = await sess(page);
    check('E : prendre la pierre', st.held?.id === stone.id);
    await page.keyboard.press('KeyE');
    await sleep(800);
    check('E : la poser', (await sess(page)).held === null);
    // Attendre que la pierre s'immobilise, puis la viser à nouveau (plusieurs essais).
    let last = null;
    for (let i = 0; i < 20; i++) {
      const p = (await sess(page)).props.find((q) => q.id === stone.id);
      if (last && p && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) < 0.01) break;
      last = p;
      await sleep(250);
    }
    let regrabbed = false;
    for (let attempt = 0; attempt < 4 && !regrabbed; attempt++) {
      const p = (await sess(page)).props.find((q) => q.id === stone.id);
      if (!p) break;
      if (attempt > 0) {
        await page.evaluate((q) => window.__game.place(q.x - 1.1, q.z), p);
        await sleep(600);
      }
      await page.evaluate((q) => window.__game.lookAt(q.x, q.y, q.z), p);
      await sleep(300);
      if ((await sess(page)).target?.id !== stone.id) continue;
      await page.keyboard.press('KeyE');
      await sleep(400);
      regrabbed = (await sess(page)).held?.id === stone.id;
    }
    check('E : la reprendre', regrabbed);
    await page.evaluate(() => {
      const s = window.__game.session();
      window.__game.lookAt(s.state.x + Math.sin(s.yaw) * 10, s.state.y + 3, s.state.z + Math.cos(s.yaw) * 10);
    });
    await sleep(300);
    const before = (await sess(page)).props.find((p) => p.id === stone.id);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.up();
    await sleep(1500);
    const after = (await sess(page)).props.find((p) => p.id === stone.id);
    const thrown = after && before ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
    check('Clic gauche : lancer la pierre', thrown > 3, `${thrown.toFixed(1)} m`);
  }
  check('Aucune erreur dans la console (phase 2)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

const QA_SETTINGS = { worldSeed: 20261112, spawnSeed: 1, quality: 'low', adaptiveResolution: false };
const DEST_BIOMES = {
  plateau: 'plateau',
  miombo: 'miombo',
  vlei: 'vlei',
  vallee: 'vallee',
  fleuve: 'fleuve',
  lac: null,
  escarpement: 'escarpement',
  kopje: null,
  matobo: 'matobo',
  hautes_terres: 'hautes_terres',
  lowveld: 'lowveld',
  kalahari: 'kalahari',
};

async function settle(page) {
  await waitFor(page, () => window.__game.session().world.pending === 0, null, 60000).catch(() => undefined);
  await sleep(300);
}

/** Place le joueur devant une pierre proche et la vise ; retourne son identifiant ou null. */
async function aimAtNearestStone(page) {
  const st = await sess(page);
  const stones = st.props.filter((p) => p.kind === 'pierre').sort((a, b) => Math.hypot(a.x - st.state.x, a.z - st.state.z) - Math.hypot(b.x - st.state.x, b.z - st.state.z));
  for (const candidate of stones.slice(0, 10)) {
    await page.evaluate((p) => window.__game.place(p.x - 1.1, p.z), candidate);
    await sleep(700);
    const now = (await sess(page)).props.find((p) => p.id === candidate.id);
    if (!now) continue;
    await page.evaluate((p) => window.__game.lookAt(p.x, p.y, p.z), now);
    await sleep(300);
    if ((await sess(page)).target?.id === candidate.id) return candidate.id;
  }
  return null;
}

async function qaScenario(browser) {
  console.log('\n— Vérification complète de la phase 2');
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('qa-init')) return;
    sessionStorage.setItem('qa-init', '1');
    // Réglages enregistrés par la version de la phase 1 (sans « Lancer » ni graine d'apparition).
    localStorage.setItem(
      'baz.settings.v1',
      JSON.stringify({
        version: 1,
        quality: 'low',
        backend: 'auto',
        renderScale: 1,
        adaptiveResolution: false,
        viewChunks: null,
        fov: 70,
        mouseSensitivity: 1,
        touchSensitivity: 1,
        gamepadSensitivity: 1,
        invertY: false,
        showPerf: false,
        bindings: { forward: ['KeyW', 'ArrowUp'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], sprint: ['ShiftLeft'], crouch: ['KeyC'], interact: ['KeyE'], pause: ['Escape'], perf: ['F3'] },
        worldSeed: 20261112,
      }),
    );
  });
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'vérification');
  await page.goto(BASE);
  await waitFor(page, () => window.__game && window.__game.screen() === 'home', null, 60000);
  const old = await page.evaluate(() => window.__game.settings());
  check('Réglages de la phase 1 repris (nouvelle action « Lancer » ajoutée)', old.bindings.throw?.includes('Mouse0') && old.quality === 'low' && old.worldSeed === 20261112);
  await startGame(page);
  check('La partie démarre avec ces anciens réglages', (await page.evaluate(() => window.__game.settings().spawnSeed)) !== null);

  // Toutes les destinations de test, deux tours (le second sert à vérifier la mémoire).
  let meshesAfterFirst = 0;
  let heapAfterFirst = 0;
  for (let round = 0; round < 2; round++) {
    for (const [id, biome] of Object.entries(DEST_BIOMES)) {
      await page.evaluate((d) => window.__game.teleport(d), id);
      await settle(page);
      await sleep(400);
      const r = await page.evaluate(() => {
        const sim = window.__game.sim();
        const s = sim.state;
        return { y: s.y, ground: sim.terrain.heightAt(s.x, s.z), mode: s.mode, finite: Number.isFinite(s.x + s.y + s.z), biome: window.__game.session().biome };
      });
      if (round === 0) {
        const okBiome = biome ? r.biome === biome : true;
        const okPlace = r.finite && r.y >= r.ground - 0.05;
        const okMode = id === 'lac' ? r.mode === 1 : true;
        check(`Destination « ${id} » : bon biome, au-dessus du sol${id === 'lac' ? ', en train de nager' : ''}`, okBiome && okPlace && okMode, `biome ${r.biome}, pieds ${(r.y - r.ground).toFixed(2)} m au-dessus du sol, mode ${r.mode}`);
      }
    }
    const res = await page.evaluate(() => ({ meshes: window.__game.session().meshes, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, chunks: window.__game.session().world.chunks }));
    if (round === 0) {
      meshesAfterFirst = res.meshes;
      heapAfterFirst = res.heap;
    } else {
      check(
        'Pas de fuite après 24 téléportations (objets 3D et mémoire stables)',
        res.meshes <= meshesAfterFirst + 10 && (heapAfterFirst === 0 || res.heap < heapAfterFirst * 1.5) && res.chunks <= 30,
        `${meshesAfterFirst} → ${res.meshes} objets 3D, mémoire ${Math.round(heapAfterFirst / 1e6)} → ${Math.round(res.heap / 1e6)} Mo, ${res.chunks} chunks`,
      );
    }
  }

  // Entrer dans le fleuve à pied, nager, puis ressortir.
  await page.evaluate(() => window.__game.teleport('fleuve'));
  await settle(page);
  const toWater = await page.evaluate(() => {
    const sim = window.__game.sim();
    const s = sim.state;
    let best = null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      for (let r = 4; r < 200; r += 4) {
        const x = s.x + Math.sin(a) * r;
        const z = s.z + Math.cos(a) * r;
        if (sim.terrain.heightAt(x, z) < -2) {
          if (!best || r < best.r) best = { r, a };
          break;
        }
      }
    }
    if (best) {
      const g = window.__game.session();
      window.__game.lookAt(s.x + Math.sin(best.a) * 10, s.y + 1.62, s.z + Math.cos(best.a) * 10);
    }
    return best;
  });
  let swam = false;
  let back = false;
  if (toWater) {
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 120 && !swam; i++) {
      await sleep(500);
      swam = (await sess(page)).state.mode === 1;
    }
    await page.keyboard.up('KeyW');
    if (swam) {
      await page.evaluate(() => {
        const g = window.__game.session();
        const s = g.state;
        window.__game.lookAt(s.x - Math.sin(g.yaw) * 10, s.y + 1.62, s.z - Math.cos(g.yaw) * 10);
      });
      await page.keyboard.down('KeyW');
      for (let i = 0; i < 180 && !back; i++) {
        await sleep(500);
        const st = (await sess(page)).state;
        back = st.mode === 0 && st.y > 0;
      }
      await page.keyboard.up('KeyW');
    }
  }
  check('Entrer à pied dans le fleuve fait nager', swam, toWater ? `eau à ${toWater.r} m` : 'pas d’eau trouvée');
  check('Revenir vers la rive fait reprendre pied', back);

  // Chute réelle de 15 m sur le plateau.
  await page.evaluate(() => window.__game.teleport('plateau'));
  await settle(page);
  await page.evaluate(() => {
    const sim = window.__game.sim();
    const s = sim.state;
    sim.teleport(s.x, s.y + 15, s.z);
  });
  await sleep(3500);
  const fallMsg = (await page.textContent('#message')) ?? '';
  check('Une chute de 15 m est signalée comme grave', /Chute violente/.test(fallMsg), fallMsg);

  // Frontière : impossible de sortir du monde.
  const border = await page.evaluate(async () => {
    const sim = window.__game.sim();
    const x = 7985;
    const z = 1500;
    sim.teleport(x, sim.terrain.heightAt(x, z) + 1, z);
    window.__game.session();
    return { biome: sim.terrain.sampleInto(x, z).biome };
  });
  await page.evaluate(() => {
    const s = window.__game.session().state;
    window.__game.lookAt(s.x + 50, s.y + 1.62, s.z);
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(4000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const edge = (await sess(page)).state;
  check('La frontière arrête le joueur (montagnes + mur invisible)', edge.x < 8000 && border.biome === 'frontiere', `x = ${edge.x.toFixed(2)}, biome ${border.biome}`);

  // Noyade : rester sous l'eau plus de 30 s.
  await page.evaluate(() => window.__game.teleport('lac'));
  await settle(page);
  await page.keyboard.down('KeyC');
  let drown = '';
  for (let i = 0; i < 90 && !/air/.test(drown); i++) {
    await sleep(500);
    drown = (await page.textContent('#message')) ?? '';
  }
  await page.keyboard.up('KeyC');
  const breath = (await sess(page)).state.breath;
  check('Sous l’eau trop longtemps : « Vous manquez d’air »', /manquez d’air/.test(drown) && breath === 0, `souffle ${Math.round(breath)}`);
  // Remonter depuis le fond du lac (une douzaine de mètres) prend du temps.
  const depth = -(await sess(page)).state.y;
  await page.keyboard.down('Space');
  let recovered = false;
  const t0 = Date.now();
  for (let i = 0; i < 90 && !recovered; i++) {
    await sleep(500);
    recovered = (await sess(page)).state.breath > 50;
  }
  await page.keyboard.up('Space');
  check('En remontant à la surface, le souffle revient', recovered, `remontée depuis ${depth.toFixed(1)} m en ${Math.round((Date.now() - t0) / 1000)} s`);

  // Reprise de la position après avoir quitté et rechargé.
  await page.evaluate(() => window.__game.teleport('miombo'));
  await settle(page);
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(500);
  const before = (await sess(page)).state;
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  await page.click('#btn-quit');
  await waitFor(page, () => window.__game.screen() === 'home', null, 10000);
  await page.reload();
  await startGame(page);
  const after = (await sess(page)).state;
  const drift = Math.hypot(after.x - before.x, after.z - before.z);
  check('Après avoir quitté puis rechargé, « Jouer » reprend au même endroit', drift < 1.5, `écart ${drift.toFixed(2)} m`);
  check('Aucune erreur dans la console (vérification)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Manette : X prend, RT lance, B accroupit.
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript((settings) => {
    localStorage.setItem('baz.settings.v1', JSON.stringify(settings));
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    window.__pad = { id: 'Manette de test (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  }, QA_SETTINGS);
  const padPage = await padCtx.newPage();
  const padErrors = watchErrors(padPage, 'manette (objets)');
  await padPage.goto(BASE);
  await startGame(padPage);
  await padPage.evaluate(() => window.__game.teleport('matobo'));
  await settle(padPage);
  const press = async (i, ms = 150) => {
    await padPage.evaluate((b) => (window.__pad.buttons[b] = { pressed: true, touched: true, value: 1 }), i);
    await sleep(ms);
    await padPage.evaluate((b) => (window.__pad.buttons[b] = { pressed: false, touched: false, value: 0 }), i);
    await sleep(200);
  };
  const padStone = await aimAtNearestStone(padPage);
  if (padStone) {
    await press(2);
    const held = (await sess(padPage)).held?.id === padStone;
    await padPage.evaluate(() => {
      const s = window.__game.session();
      window.__game.lookAt(s.state.x + Math.sin(s.yaw) * 10, s.state.y + 3, s.state.z + Math.cos(s.yaw) * 10);
    });
    const p0 = (await sess(padPage)).props.find((p) => p.id === padStone);
    await press(7);
    await sleep(1500);
    const p1 = (await sess(padPage)).props.find((p) => p.id === padStone);
    check('Manette : X prend la pierre, RT la lance', held && p0 && p1 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, `${p0 && p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) : '?'} m`);
  } else {
    check('Manette : X prend la pierre, RT la lance', false, 'aucune pierre visable');
  }
  await padPage.evaluate(() => (window.__pad.buttons[1] = { pressed: true, touched: true, value: 1 }));
  await sleep(500);
  const padCrouch = (await sess(padPage)).state.crouched;
  await padPage.evaluate(() => (window.__pad.buttons[1] = { pressed: false, touched: false, value: 0 }));
  check('Manette : B fait s’accroupir', padCrouch);
  check('Aucune erreur dans la console (manette, objets)', padErrors.length === 0, padErrors.slice(0, 3).join(' | '));
  await padCtx.close();

  // Tactile : Prendre, Lancer, Accroupir ; conseil de rotation en portrait.
  const touchCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await touchCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const tPage = await touchCtx.newPage();
  const tErrors = watchErrors(tPage, 'tactile (objets)');
  await tPage.goto(BASE);
  await startGame(tPage);
  const cdp = await touchCtx.newCDPSession(tPage);
  const tap = async (sel, ms = 150) => {
    const b = await tPage.locator(sel).boundingBox();
    const x = Math.round(b.x + b.width / 2);
    const y = Math.round(b.y + b.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 9 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  await tPage.evaluate(() => window.__game.teleport('matobo'));
  await settle(tPage);
  const tStone = await aimAtNearestStone(tPage);
  if (tStone) {
    await tap('[data-touch="interact"]');
    const held = (await sess(tPage)).held?.id === tStone;
    await tPage.evaluate(() => {
      const s = window.__game.session();
      window.__game.lookAt(s.state.x + Math.sin(s.yaw) * 10, s.state.y + 3, s.state.z + Math.cos(s.yaw) * 10);
    });
    const p0 = (await sess(tPage)).props.find((p) => p.id === tStone);
    await tap('[data-touch="throw"]');
    await sleep(1500);
    const p1 = (await sess(tPage)).props.find((p) => p.id === tStone);
    check('Tactile : « Prendre » puis « Lancer »', held && p0 && p1 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3);
  } else {
    check('Tactile : « Prendre » puis « Lancer »', false, 'aucune pierre visable');
  }
  await tap('[data-touch="crouch"]');
  await sleep(300);
  const tCrouch = (await sess(tPage)).state.crouched;
  await tap('[data-touch="crouch"]');
  await sleep(500);
  check('Tactile : « Accroupir » s’active puis se désactive', tCrouch && !(await sess(tPage)).state.crouched);
  check('Aucune erreur dans la console (tactile, objets)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  const portraitCtx = await browser.newContext({ ...devices['Pixel 7'] });
  await portraitCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const pPage = await portraitCtx.newPage();
  await pPage.goto(BASE);
  await startGame(pPage);
  check('Téléphone en portrait : conseil de le tourner à l’horizontale', await pPage.isVisible('#rotate-hint'));
  await portraitCtx.close();
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


// ——— Phase 3 : survie et inventaire ———

const SHAPES = { figue: [0.022, 0], baton: [0.022, 0.75], fruit_baobab: [0.07, 0.2], aloes: [0.12, 0.3], chiffon: [0.1, 0] };

/** Pose un objet devant le joueur, attend qu'il se stabilise et oriente le regard dessus. */
async function placeAndAim(page, kind, dist = 1.3) {
  const id = await page.evaluate(
    ([kind, dist, shape]) => {
      const sim = window.__game.sim();
      const s = sim.state;
      const yaw = window.__game.session().yaw;
      const x = s.x + Math.sin(yaw) * dist;
      const z = s.z + Math.cos(yaw) * dist;
      return sim.props.spawnDynamic({ kind, x, y: Math.max(sim.terrain.heightAt(x, z), s.y) + 0.3, z, rot: 0, radius: shape[0], length: shape[1] });
    },
    [kind, dist, SHAPES[kind]],
  );
  await sleep(1200);
  await page.evaluate((id) => {
    const p = window.__game.sim().props.position(id);
    if (p) window.__game.lookAt(p.x, p.y, p.z);
  }, id);
  await sleep(300);
  return id;
}

const injure = (page, zone, kind, grave = false) =>
  page.evaluate(
    ([zone, kind, grave]) => {
      const v = window.__game.sim().vitals;
      const inj = { id: v.nextId++, zone, kind, grave, age: 0, heal: 0, bandaged: false, splinted: false, disinfected: false, clotted: false, infection: 0, infectAt: -1 };
      v.injuries.push(inj);
      return inj.id;
    },
    [zone, kind, grave],
  );

const countItem = (b, item) => [...b.inventory.pockets, ...(b.inventory.bag ?? [])].filter((s) => s && s.item === item).reduce((n, s) => n + s.count, 0);

async function phase3Scenario(browser) {
  console.log('\n— Phase 3 : survie et inventaire (ordinateur)');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 3');
  await page.goto(BASE);
  await startGame(page);
  await settle(page);
  const body = () => page.evaluate(() => window.__game.body());
  let b = await body();
  check('Départ : sac vide, 4 poches vides, vêtements intacts, pleine santé', b.inventory.bag?.length === 0 && b.inventory.pockets.length === 4 && b.inventory.pockets.every((p) => p === null) && b.inventory.clothes.haut && b.vitals.health === 100);

  // Ramasser : petits objets rangés directement.
  await placeAndAim(page, 'figue');
  const promptFig = await page.textContent('#prompt');
  await page.keyboard.press('KeyE');
  await sleep(400);
  await placeAndAim(page, 'baton');
  await page.keyboard.press('KeyE');
  await sleep(400);
  await placeAndAim(page, 'fruit_baobab');
  await page.keyboard.press('KeyE');
  await sleep(400);
  b = await body();
  check('E ramasse une figue (poche), un bâton (sac), un fruit du baobab (poche)', countItem(b, 'figue') === 1 && b.inventory.bag?.some((s) => s.item === 'baton') && countItem(b, 'fruit_baobab') === 1, `indication : « ${promptFig} »`);

  // Sac : ouverture, choix d'un objet, manger.
  await page.keyboard.press('Tab');
  await waitFor(page, () => !document.querySelector('#bag-view').hidden, null, 5000);
  await sleep(500);
  let bag = await page.evaluate(() => window.__game.bag());
  check('Tab ouvre le sac : objets visibles en 3D dans les poches et le sac', bag.open && bag.cells.filter((c) => c.kind).length === 3, `${bag.cells.length} cases, ${bag.cells.filter((c) => c.kind).map((c) => c.kind).join(', ')}`);
  check('Sac ouvert : le curseur est libre (pas de pointeur verrouillé)', !(await page.evaluate(() => window.__game.input().locked)));
  writeFileSync(`${OUT}phase3-sac.png`, await page.screenshot());
  const fruitCell = bag.cells.find((c) => c.kind === 'fruit_baobab');
  await page.mouse.click(fruitCell.x, fruitCell.y);
  await sleep(300);
  bag = await page.evaluate(() => window.__game.bag());
  check('Un clic choisit un objet et propose ses actions', bag.actions.includes('Manger') && bag.actions.includes('Prendre en main'), bag.actions.join(', '));
  await page.evaluate(() => (window.__game.sim().vitals.health = 60));
  await page.click('.item-actions button:has-text("Manger")');
  await sleep(3800);
  b = await body();
  const fruitLeft = countItem(b, 'fruit_baobab');
  await sleep(8000);
  b = await body();
  check('Manger le fruit du baobab (geste de 3 s) fait remonter la santé', fruitLeft === 0 && b.vitals.health > 63, `santé ${b.vitals.health.toFixed(1)} (partie de 60)`);

  // Déchirer sa chemise, puis bander une coupure depuis l'examen du corps.
  await page.click('.body-actions button:has-text("Déchirer la chemise")');
  await sleep(300);
  b = await body();
  check('Déchirer la chemise donne 4 chiffons', countItem(b, 'chiffon') === 4 && !b.inventory.clothes.haut);
  const cutId = await injure(page, 'bras_g', 'coupure', true);
  await sleep(600);
  const zoneClass = await page.getAttribute('.silhouette [data-zone="bras_g"]', 'class');
  check('Examen du corps : le bras qui saigne est signalé', (zoneClass ?? '').includes('saigne'), zoneClass ?? '');
  await page.click('.silhouette [data-zone="bras_g"]');
  await sleep(300);
  const aloeDisabled = await page.evaluate(() => [...document.querySelectorAll('.zone-detail button')].find((x) => x.textContent.startsWith("Appliquer de l'aloès"))?.disabled);
  await page.click('.zone-detail button:has-text("Bander")');
  await sleep(6800);
  b = await body();
  const cut = b.vitals.injuries.find((i) => i.id === cutId);
  check('Bander depuis l’examen du corps arrête le saignement (geste de 6 s, 1 chiffon)', cut?.bandaged && countItem(b, 'chiffon') === 3, `aloès grisé faute de feuille : ${aloeDisabled}`);
  await page.keyboard.press('Tab');
  await sleep(500);
  check('Tab referme le sac', await page.evaluate(() => document.querySelector('#bag-view').hidden));
  await page.mouse.click(480, 270);
  await sleep(300);

  // Jambe cassée : on boite ; attelle avec « Utiliser » (F) en tenant un bâton.
  await injure(page, 'jambe_d', 'fracture');
  await sleep(300);
  let a = await sess(page);
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  await sleep(300);
  let s2 = await sess(page);
  const limp = Math.hypot(s2.state.x - a.state.x, s2.state.z - a.state.z);
  check('Jambe cassée : on avance très lentement', limp < 1.6, `${limp.toFixed(2)} m en 1,5 s`);
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.push({ item: 'baton', count: 1 });
    sim.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
  });
  await sleep(400);
  const beforeUse = await body();
  await page.keyboard.press('KeyF');
  await sleep(500);
  const afterUse = await body();
  const useMsg = await page.textContent('#message');
  await sleep(8500);
  b = await body();
  check(
    '« Utiliser » (F) avec un bâton en main pose l’attelle (2 bâtons + 2 chiffons, 8 s)',
    b.vitals.injuries.some((i) => i.kind === 'fracture' && i.splinted) && countItem(b, 'chiffon') === 1 && countItem(b, 'baton') === 0,
    `endurance max ${Math.round(b.state.staminaMax)}, vitesse max ${b.state.speedCap} m/s · en main avant : ${JSON.stringify(beforeUse.held)} · geste : ${afterUse.gesture?.label ?? 'aucun'} · message : « ${useMsg} » · pause : ${await page.evaluate(() => window.__game.screen())} · état : ${afterUse.vitals.state}`,
  );

  // Repos et sommeil.
  await page.keyboard.press('KeyR');
  await sleep(600);
  const sitting = (await body()).vitals.posture;
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  await sleep(300);
  check('R : s’asseoir ; bouger : se relever', sitting === 'assis' && (await body()).vitals.posture === 'debout', sitting);
  await page.evaluate(() => (window.__game.sim().vitals.fatigue = 70));
  await page.keyboard.down('KeyR');
  await sleep(1300);
  await page.keyboard.up('KeyR');
  await sleep(500);
  const sleeping = (await body()).vitals.posture === 'endormi';
  const sleepText = await page.textContent('#down-screen .title');
  await page.evaluate(() => (window.__game.sim().vitals.sleepTime = 59));
  await sleep(2000);
  b = await body();
  check('Maintenir R : dormir ; après une minute, l’endroit devient le point de réapparition', sleeping && sleepText === 'Vous dormez' && b.respawnPoint !== null, `écran : « ${sleepText} »`);
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  await sleep(300);
  check('Bouger réveille', (await body()).vitals.posture === 'debout');

  // Chute grave : blessures localisées.
  const injBefore = (await body()).vitals.injuries.length;
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.vitals.injuries = [];
    sim.vitals.health = 100;
    const s = sim.state;
    sim.teleport(s.x, s.y + 16, s.z);
  });
  await sleep(3500);
  b = await body();
  check('Chute de 16 m : blessures localisées et santé en baisse', b.vitals.injuries.length > 0 && b.vitals.health < 80, `${b.vitals.injuries.map((i) => `${i.kind} (${i.zone})`).join(', ')} · santé ${Math.round(b.vitals.health)} · avant : ${injBefore} blessure(s)`);

  // Mort, corps, réapparition, retour au corps.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.vitals.state = 'eveille';
    sim.vitals.injuries = [];
    sim.vitals.health = 100;
    sim.inventory.pockets[3] = { item: 'aloes', count: 2 };
  });
  await sleep(500);
  const carried = (await body()).inventory;
  await injure(page, 'torse', 'coupure', true);
  await page.evaluate(() => (window.__game.sim().vitals.health = 0.4));
  await waitFor(page, () => window.__game.body().vitals.state === 'critique', null, 5000);
  await sleep(400);
  const giveUpVisible = await page.isVisible('#btn-give-up');
  const lockedDown = await page.evaluate(() => window.__game.input().locked);
  writeFileSync(`${OUT}phase3-critique.png`, await page.screenshot());
  check('État critique : écran, compte à rebours, bouton « Abandonner », curseur libre', giveUpVisible && !lockedDown, await page.textContent('#down-screen .detail'));
  await page.click('#btn-give-up');
  await sleep(600);
  const deadTitle = await page.textContent('#down-screen .title');
  writeFileSync(`${OUT}phase3-mort.png`, await page.screenshot());
  await waitFor(page, () => window.__game.body().vitals.state === 'eveille' && !window.__game.body().dead, null, 12000);
  await sleep(300);
  b = await body();
  const respawnMsg = await page.textContent('#message');
  check('Mort puis réapparition au point du dernier sommeil, sans sac, santé 70', deadTitle === 'Vous êtes mort' && b.inventory.bag === null && b.vitals.health === 70 && Math.hypot(b.respawnPoint.x - (await sess(page)).state.x, b.respawnPoint.z - (await sess(page)).state.z) < 1.5, respawnMsg);
  check('On se souvient de la direction et de la distance du corps', /Votre corps/.test(respawnMsg ?? ''), respawnMsg);
  const bodyInfo = b.lastBody;
  const bodyContent = await page.evaluate((id) => window.__game.sim().props.container(id), bodyInfo.id);
  check('Le corps reste dans le monde avec tout l’équipement', JSON.stringify(bodyContent.pockets) === JSON.stringify(carried.pockets) && JSON.stringify(bodyContent.bag) === JSON.stringify(carried.bag));
  await page.evaluate((lb) => {
    const sim = window.__game.sim();
    const p = sim.props.position(lb.id);
    sim.teleport(p.x - 1.4, sim.terrain.heightAt(p.x - 1.4, p.z) + 0.3, p.z);
  }, bodyInfo);
  await sleep(1500);
  await page.evaluate((id) => {
    const p = window.__game.sim().props.position(id);
    window.__game.lookAt(p.x, p.y, p.z);
  }, bodyInfo.id);
  await sleep(400);
  const promptBody = await page.textContent('#prompt');
  await page.keyboard.press('KeyE');
  await sleep(800);
  bag = await page.evaluate(() => window.__game.bag());
  writeFileSync(`${OUT}phase3-fouille.png`, await page.screenshot());
  check('E sur son corps : on le fouille (son sac et ses poches s’affichent)', bag.open && bag.other === bodyInfo.id && bag.cells.some((c) => c.slot.zone.startsWith('autre') && c.kind), `indication : « ${promptBody} »`);
  await page.click('.item-actions button:has-text("Tout prendre")');
  await sleep(400);
  b = await body();
  check('« Tout prendre » : on récupère son sac et ses affaires', b.inventory.bag !== null && countItem(b, 'aloes') === 2 && countItem(b, 'figue') === 1);
  await page.keyboard.press('Tab');
  await sleep(300);

  // Sauvegarde : quitter, recharger, reprendre.
  const invBefore = JSON.stringify((await body()).inventory);
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  await page.click('#btn-quit');
  await waitFor(page, () => window.__game.screen() === 'home', null, 10000);
  await page.reload();
  await startGame(page);
  await settle(page);
  const invAfter = JSON.stringify((await body()).inventory);
  check('Quitter, recharger, « Jouer » : sac, poches et vêtements sont repris', invAfter === invBefore, invAfter.slice(0, 160));
  check('Aucune erreur dans la console (phase 3)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Téléphone : bouton « Sac », onglets Sac / Corps, « Utiliser ».
  console.log('\n— Phase 3 : téléphone');
  const touchCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await touchCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const tPage = await touchCtx.newPage();
  const tErrors = watchErrors(tPage, 'phase 3 (téléphone)');
  await tPage.goto(BASE);
  await startGame(tPage);
  await settle(tPage);
  const cdp = await touchCtx.newCDPSession(tPage);
  const tapAt = async (x, y, ms = 120) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 7 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  const tap = async (sel) => {
    const r = await tPage.locator(sel).boundingBox();
    await tapAt(r.x + r.width / 2, r.y + r.height / 2);
  };
  await tPage.evaluate(() => (window.__game.sim().inventory.pockets[1] = { item: 'figue', count: 3 }));
  await tap('[data-touch="bag"]');
  await sleep(600);
  let tb = await tPage.evaluate(() => window.__game.bag());
  const tabsVisible = await tPage.isVisible('.bag-tabs');
  check('Téléphone : le bouton « Sac » ouvre le sac (onglets Sac et Corps sur petit écran)', tb.open && tabsVisible);
  const figCell = tb.cells.find((c) => c.kind === 'figue');
  await tapAt(figCell.x, figCell.y);
  tb = await tPage.evaluate(() => window.__game.bag());
  writeFileSync(`${OUT}phase3-telephone-sac.png`, await tPage.screenshot());
  check('Téléphone : toucher un objet le choisit et propose ses actions', tb.selected?.zone === 'poche' && tb.selected.index === 1 && tb.actions.includes('Manger'), tb.actions.join(', '));
  await tap('[data-tab="corps"]');
  await sleep(300);
  const bodyVisible = await tPage.isVisible('.bag-body');
  writeFileSync(`${OUT}phase3-telephone-corps.png`, await tPage.screenshot());
  await tap('.bag-close');
  await sleep(300);
  check('Téléphone : onglet « Corps » puis « Fermer »', bodyVisible && !(await tPage.evaluate(() => window.__game.bag().open)));
  await tPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.vitals.health = 50;
    sim.act({ type: 'sortir', from: { zone: 'poche', index: 1 } });
  });
  await sleep(400);
  await tap('[data-touch="use"]');
  await sleep(2400);
  const tBody = await tPage.evaluate(() => window.__game.body());
  check('Téléphone : « Utiliser » mange la figue tenue en main', tBody.held === null && countItem(tBody, 'figue') === 2 && tBody.vitals.digest.length === 1);
  await tPage.evaluate(() => {
    window.__game.sim().vitals.fatigue = 70;
    window.__game.act({ type: 'dormir' });
  });
  await sleep(600);
  const wakeVisible = await tPage.isVisible('#btn-wake');
  await tap('#btn-wake');
  await sleep(300);
  check('Téléphone : endormi, le bouton « Se réveiller » réveille (l’écran couvre le joystick)', wakeVisible && (await tPage.evaluate(() => window.__game.body().vitals.posture)) === 'debout');
  check('Aucune erreur dans la console (phase 3, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  // Manette : Y ouvre le sac, le stick choisit, A agit, B ferme.
  console.log('\n— Phase 3 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript((settings) => {
    localStorage.setItem('baz.settings.v1', JSON.stringify(settings));
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    window.__pad = { id: 'Manette de test (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  }, QA_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 3 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const press = async (i, ms = 150) => {
    await pPage.evaluate((btn) => (window.__pad.buttons[btn] = { pressed: true, touched: true, value: 1 }), i);
    await sleep(ms);
    await pPage.evaluate((btn) => (window.__pad.buttons[btn] = { pressed: false, touched: false, value: 0 }), i);
    await sleep(250);
  };
  await pPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[0] = { item: 'chiffon', count: 2 };
    sim.inventory.pockets[1] = { item: 'muhacha', count: 2 };
    sim.vitals.health = 50;
  });
  await press(3);
  await sleep(300);
  let pb = await pPage.evaluate(() => window.__game.bag());
  const opened = pb.open && pb.selected?.zone === 'poche' && pb.selected.index === 0;
  await pPage.evaluate(() => (window.__pad.axes = [1, 0, 0, 0]));
  await sleep(230);
  await pPage.evaluate(() => (window.__pad.axes = [0, 0, 0, 0]));
  await sleep(300);
  pb = await pPage.evaluate(() => window.__game.bag());
  check('Manette : Y ouvre le sac, le stick passe à la poche voisine', opened && pb.selected?.zone === 'poche' && pb.selected.index === 1, JSON.stringify(pb.selected));
  await press(0);
  await sleep(2200);
  const pBody = await pPage.evaluate(() => window.__game.body());
  check('Manette : A lance la première action (manger le muhacha)', countItem(pBody, 'muhacha') === 1 && pBody.vitals.digest.length === 1, pb.actions.join(', '));
  await press(1);
  await sleep(300);
  check('Manette : B referme le sac', !(await pPage.evaluate(() => window.__game.bag().open)));
  await injure(pPage, 'torse', 'coupure', true);
  await pPage.evaluate(() => (window.__game.sim().vitals.health = 0.3));
  await waitFor(pPage, () => window.__game.body().vitals.state === 'critique', null, 5000);
  await press(2, 2600);
  await sleep(300);
  check('Manette : à terre, maintenir X 2 s permet d’abandonner', await pPage.evaluate(() => window.__game.body().dead));
  check('Aucune erreur dans la console (phase 3, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

// --only=ordinateur,telephone,manette,phase2,verification,phase3,performance,captures,webgpu pour ne lancer que certains scénarios.
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
  if (want('phase2')) await phase2Scenario(browser);
  if (want('verification')) await qaScenario(browser);
  if (want('phase3')) await phase3Scenario(browser);
  if (want('captures')) await userScreenshots(browser);
  await browser.close();
  if (want('webgpu')) await webgpuScenario();
} catch (err) {
  check('Exécution des scénarios', false, err instanceof Error ? err.stack : String(err));
} finally {
  server.stop();
}
writeFileSync(`${OUT}resultats.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failures}/${results.length} vérifications réussies.`);
process.exit(failures === 0 ? 0 : 1);
