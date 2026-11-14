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

/**
 * Script d'initialisation : une manette standard simulée et un compteur d'images (il avance à chaque
 * image, dans la même boucle requestAnimationFrame que le jeu). À passer à addInitScript.
 */
function installTestPad(settings) {
  if (settings) localStorage.setItem('baz.settings.v1', JSON.stringify(settings));
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  window.__pad = { id: 'Manette de test (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad, null, null, null];
  window.__frames = 0;
  const tick = () => {
    window.__frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Appuis de manette fiables même quand une image dure longtemps (rendu logiciel, shaders compilés à la
 * première ouverture du sac). Pendant une longue image, les ordres du test s'accumulent puis
 * s'exécutent d'affilée : un appui et son relâchement tomberaient alors entre deux images, et le jeu ne
 * verrait rien. On attend donc que le jeu ait affiché deux images bouton enfoncé, puis deux images
 * bouton relâché.
 */
function padControls(page) {
  const afterFrames = async (n = 2) => {
    const f0 = await page.evaluate(() => window.__frames);
    await waitFor(page, ([f, k]) => window.__frames >= f + k, [f0, n], 20000).catch(() => undefined);
  };
  const button = (i, down) => page.evaluate(([b, d]) => (window.__pad.buttons[b] = { pressed: d, touched: d, value: d ? 1 : 0 }), [i, down]);
  const press = async (i, ms = 150) => {
    await button(i, true);
    await sleep(ms);
    await afterFrames();
    await button(i, false);
    await afterFrames();
  };
  const axes = (v) => page.evaluate((a) => (window.__pad.axes = a), v);
  return { press, button, axes, afterFrames };
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
  await ctx.addInitScript(installTestPad);
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
  // Toujours maintenu une seconde plus tard : la pause reste (pas de bascule à chaque image).
  await sleep(1000);
  const stillPaused = await page.evaluate(() => window.__game.screen() === 'pause');
  check('Le bouton Start met en pause (maintenu, la pause reste)', stillPaused);
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
/** Phase 6 : mêmes réglages, créatures actives. */
const QA6_SETTINGS = { ...QA_SETTINGS, fauna: true };
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
  await padCtx.addInitScript(installTestPad, QA_SETTINGS);
  const padPage = await padCtx.newPage();
  const padErrors = watchErrors(padPage, 'manette (objets)');
  await padPage.goto(BASE);
  await startGame(padPage);
  await padPage.evaluate(() => window.__game.teleport('matobo'));
  await settle(padPage);
  const { press, button, afterFrames } = padControls(padPage);
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
  await button(1, true);
  await sleep(500);
  await afterFrames();
  const padCrouch = (await sess(padPage)).state.crouched;
  await button(1, false);
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
  // On attend les résultats plutôt qu'un temps fixe : sur une machine lente, la simulation tourne moins vite que le temps réel.
  await sleep(500);
  await waitFor(page, () => !window.__game.body().gesture, null, 15000).catch(() => undefined);
  b = await body();
  const fruitLeft = countItem(b, 'fruit_baobab');
  await waitFor(page, () => window.__game.body().vitals.health > 63, null, 30000).catch(() => undefined);
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
  await waitFor(page, (id) => window.__game.body().vitals.injuries.find((i) => i.id === id)?.bandaged, cutId, 20000).catch(() => undefined);
  await sleep(300);
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
  await waitFor(page, () => window.__game.body().vitals.injuries.some((i) => i.kind === 'fracture' && i.splinted), null, 25000).catch(() => undefined);
  await sleep(300);
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
  await waitFor(page, () => window.__game.body().vitals.state === 'critique', null, 15000);
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
  await waitFor(tPage, () => window.__game.body().vitals.digest.length === 1, null, 10000).catch(() => undefined);
  await sleep(200);
  const tBody = await tPage.evaluate(() => window.__game.body());
  check('Téléphone : « Utiliser » mange la figue tenue en main', tBody.held === null && countItem(tBody, 'figue') === 2 && tBody.vitals.digest.length === 1);
  const sleepAct = await tPage.evaluate(() => {
    window.__game.sim().vitals.fatigue = 70;
    return window.__game.act({ type: 'dormir' });
  });
  await sleep(600);
  const wakeVisible = await tPage.isVisible('#btn-wake');
  const asleep = await tPage.evaluate(() => window.__game.body().vitals.posture);
  await tap('#btn-wake');
  await sleep(300);
  const awake = await tPage.evaluate(() => window.__game.body().vitals.posture);
  check('Téléphone : endormi, le bouton « Se réveiller » réveille (l’écran couvre le joystick)', wakeVisible && asleep === 'endormi' && awake === 'debout', `dormir : ${JSON.stringify(sleepAct)} · bouton visible : ${wakeVisible} · ${asleep} → ${awake}`);
  check('Aucune erreur dans la console (phase 3, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  // Manette : Y ouvre le sac, le stick choisit, A agit, B ferme.
  console.log('\n— Phase 3 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript(installTestPad, QA_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 3 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const { press, button, axes, afterFrames } = padControls(pPage);
  await pPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[0] = { item: 'chiffon', count: 2 };
    sim.inventory.pockets[1] = { item: 'muhacha', count: 2 };
    sim.vitals.health = 50;
  });
  await press(3);
  let pb = await pPage.evaluate(() => window.__game.bag());
  const opened = pb.open && pb.selected?.zone === 'poche' && pb.selected.index === 0;
  // Stick maintenu jusqu'au premier déplacement (au plus 3 s), puis relâché : une seule case.
  await axes([1, 0, 0, 0]);
  await waitFor(pPage, () => window.__game.bag().selected?.index !== 0, null, 3000).catch(() => undefined);
  await axes([0, 0, 0, 0]);
  await afterFrames();
  pb = await pPage.evaluate(() => window.__game.bag());
  check('Manette : Y ouvre le sac, le stick passe à la poche voisine', opened && pb.selected?.zone === 'poche' && pb.selected.index === 1, `${JSON.stringify(pb.selected)} · onglet ${pb.tab} · ouvert ${opened}`);
  await press(0);
  await waitFor(pPage, () => window.__game.body().vitals.digest.length === 1, null, 10000).catch(() => undefined);
  await sleep(200);
  const pBody = await pPage.evaluate(() => window.__game.body());
  check('Manette : A lance la première action (manger le muhacha)', countItem(pBody, 'muhacha') === 1 && pBody.vitals.digest.length === 1, pb.actions.join(', '));
  await press(1);
  await sleep(300);
  check('Manette : B referme le sac', !(await pPage.evaluate(() => window.__game.bag().open)));
  // Y maintenu une seconde : le sac s'ouvre et reste ouvert (il ne doit pas s'ouvrir et se fermer à chaque image).
  await button(3, true);
  await sleep(1000);
  await afterFrames(4);
  const heldOpen = await pPage.evaluate(() => window.__game.bag().open);
  await button(3, false);
  await afterFrames();
  const stillOpen = await pPage.evaluate(() => window.__game.bag().open);
  await press(1);
  check('Manette : Y maintenu 1 s ouvre le sac et le laisse ouvert', heldOpen && stillOpen, `pendant : ${heldOpen} · après : ${stillOpen}`);
  await injure(pPage, 'torse', 'coupure', true);
  // Sans digestion en cours (la nourriture compenserait le saignement).
  await pPage.evaluate(() => {
    const v = window.__game.sim().vitals;
    v.digest = [];
    v.health = 0.3;
  });
  await waitFor(pPage, () => window.__game.body().vitals.state === 'critique', null, 15000);
  await press(2, 2600);
  await sleep(300);
  check('Manette : à terre, maintenir X 2 s permet d’abandonner', await pPage.evaluate(() => window.__game.body().dead));
  check('Aucune erreur dans la console (phase 3, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

const nearestOf = (page, kind, r = 400) =>
  page.evaluate(
    ([kind, r]) => {
      const st = window.__game.session();
      const list = st.props.filter((p) => p.kind === kind && Math.hypot(p.x - st.state.x, p.z - st.state.z) < r);
      list.sort((a, b) => Math.hypot(a.x - st.state.x, a.z - st.state.z) - Math.hypot(b.x - st.state.x, b.z - st.state.z));
      return list[0] ?? null;
    },
    [kind, r],
  );

/** Ramasse (E) tous les objets d'un type tombés près d'un point. */
async function pickUpAround(page, kind, x, z, r = 3.5, max = 6) {
  let n = 0;
  for (let i = 0; i < max * 2 && n < max; i++) {
    const p = await page.evaluate(
      ([kind, x, z, r]) => window.__game.session().props.find((q) => q.kind === kind && !q.held && Math.hypot(q.x - x, q.z - z) < r) ?? null,
      [kind, x, z, r],
    );
    if (!p) break;
    await page.evaluate((p) => window.__game.place(p.x - 0.9, p.z), p);
    await sleep(450);
    await page.evaluate((id) => {
      const q = window.__game.sim().props.position(id);
      if (q) window.__game.lookAt(q.x, q.y, q.z);
    }, p.id);
    await sleep(250);
    await page.keyboard.press('KeyE');
    await sleep(400);
    if (!(await page.evaluate((id) => window.__game.sim().props.position(id), p.id))) n++;
  }
  return n;
}

/** Arbre le plus proche d'une espèce qui donne écorce et branches (pas un baobab : tronc trop large pour se placer simplement). */
const nearestTree = (page) =>
  page.evaluate(() => {
    const sim = window.__game.sim();
    const s = sim.state;
    const okSpecies = new Set(['mopane', 'miombo', 'teck', 'montagne', 'figuier']);
    const list = [...sim.phys.trees.values()].filter((t) => okSpecies.has(t.species) && !sim.world.isFelled(t.key, sim.time));
    list.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    return list[0] ?? null;
  });

async function phase4Scenario(browser) {
  console.log('\n— Phase 4 : ressources et fabrication (ordinateur)');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 4');
  await page.goto(BASE);
  await startGame(page);
  await settle(page);
  const body = () => page.evaluate(() => window.__game.body());
  const craft = () => page.evaluate(() => window.__game.craft());
  const bagInfo = () => page.evaluate(() => window.__game.bag());
  const message = () => page.textContent('#message');
  const openBag = async () => {
    await page.keyboard.press('Tab');
    await waitFor(page, () => window.__game.bag().open, null, 5000);
    await sleep(400);
  };
  const closeBag = async () => {
    await page.keyboard.press('Tab');
    await waitFor(page, () => !window.__game.bag().open, null, 5000);
    await sleep(200);
    await page.mouse.click(480, 270);
    await sleep(200);
  };
  const clickCell = async (pred) => {
    const cell = (await bagInfo()).cells.find(pred);
    if (!cell) return false;
    await page.mouse.click(cell.x, cell.y);
    await sleep(300);
    return true;
  };
  const clickButton = async (host, text) => {
    const loc = page.locator(`${host} button:has-text("${text}")`).first();
    if ((await loc.count()) === 0 || (await loc.isDisabled())) return false;
    await loc.click();
    await sleep(300);
    return true;
  };
  const restStamina = () => page.evaluate(() => (window.__game.sim().state.stamina = window.__game.sim().state.staminaMax));

  let c = await craft();
  // Phase 7 : la petite roue et le gouvernail (en bois) sont connus d'emblée, comme le chariot à bras et le radeau.
  check('Départ : 8 recettes connues (fibres, corde, couteau, bâton à fouir, foyer, torche ; petite roue, gouvernail), plan de travail vide', c.knowledge.known.length === 8 && c.knowledge.known.includes('torche') && c.knowledge.known.includes('petite_roue') && c.bench.length === 0, c.knowledge.known.join(', '));

  // 1. Tailler le quartz : un galet en main, F maintenu sur le bloc.
  const stoneId = await aimAtNearestStone(page);
  await page.keyboard.press('KeyE');
  await sleep(400);
  let b = await body();
  const heldStone = b.held?.id === stoneId;
  const block = await nearestOf(page, 'bloc_quartz');
  check('Un bloc de quartz (gisement) se trouve à moins de 150 m de l’arrivée', block !== null, block ? `${Math.round(Math.hypot(block.x - (await sess(page)).spawn.x, block.z - (await sess(page)).spawn.z))} m` : 'aucun');
  if (!block) {
    await ctx.close();
    return;
  }
  await page.evaluate((n) => window.__game.place(n.x - 1.9, n.z), block);
  await settle(page);
  await page.evaluate((n) => window.__game.lookAt(n.x, n.y + 0.2, n.z), block);
  await sleep(400);
  const promptQuartz = await page.textContent('#prompt');
  await page.keyboard.down('KeyF');
  const flakes = await waitFor(page, ([x, z]) => window.__game.session().props.filter((p) => p.kind === 'quartz' && Math.hypot(p.x - x, p.z - z) < 3.5).length >= 2, [block.x, block.z], 15000)
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyF');
  writeFileSync(`${OUT}phase4-quartz.png`, await page.screenshot());
  check('Galet en main, F maintenu sur le bloc de quartz : des éclats tranchants tombent', heldStone && flakes && /frapper le bloc de quartz/.test(promptQuartz ?? ''), `indication : « ${promptQuartz} » · ${await message()}`);

  // 2. Ranger le galet dans le sac (interface), ramasser les éclats (E).
  await openBag();
  await clickCell((cl) => cl.slot.zone === 'main');
  const ranged = await clickButton('.item-actions', 'Ranger');
  await closeBag();
  const gotFlakes = await pickUpAround(page, 'quartz', block.x, block.z);
  b = await body();
  check('Sac : « Ranger » le galet ; E ramasse les éclats de quartz (poche)', ranged && countItem(b, 'pierre') === 1 && countItem(b, 'quartz') >= 2, `${gotFlakes} ramassé(s) · ${countItem(b, 'quartz')} éclat(s)`);

  // 3. Écorcer un arbre et couper une branche avec un éclat (touche 1 : l'éclat en main).
  const tree = await nearestTree(page);
  await page.evaluate((t) => window.__game.place(t.x - 1.2, t.z), tree);
  await settle(page);
  const quartzPocket = b.inventory.pockets.findIndex((p) => p?.item === 'quartz');
  await page.keyboard.press(`Digit${quartzPocket + 1}`);
  await sleep(400);
  await page.evaluate((t) => window.__game.lookAt(t.x, t.y + 1.1, t.z), tree);
  await sleep(400);
  const promptTree = await page.textContent('#prompt');
  await restStamina();
  await page.keyboard.down('KeyF');
  const harvested = await waitFor(
    page,
    ([x, z]) => {
      const ps = window.__game.session().props.filter((p) => Math.hypot(p.x - x, p.z - z) < 3.5);
      return ps.filter((p) => p.kind === 'ecorce').length >= 2 && ps.some((p) => p.kind === 'manche');
    },
    [tree.x, tree.z],
    25000,
  )
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyF');
  writeFileSync(`${OUT}phase4-ecorce.png`, await page.screenshot());
  await page.keyboard.press(`Digit${quartzPocket + 1}`);
  await sleep(300);
  await pickUpAround(page, 'ecorce', tree.x, tree.z);
  await pickUpAround(page, 'manche', tree.x, tree.z);
  b = await body();
  check('Éclat en main, F maintenu sur un arbre : deux bandes d’écorce puis une branche', harvested && countItem(b, 'ecorce') === 2 && countItem(b, 'manche') === 1, `${tree.species} · indication : « ${promptTree} » · ${await message()}`);

  // 4. Plan de travail (interface) : écorce → fibres (×2) → corde → couteau.
  await openBag();
  await page.click('[data-tab="fabriquer"]');
  await sleep(300);
  await clickCell((cl) => cl.kind === 'ecorce');
  const posed = await clickButton('.item-actions', 'Poser sur le plan de travail');
  c = await craft();
  const recipeText = await page.textContent('.recipe');
  check('« Poser sur le plan de travail » : la recette « Fibres d’écorce » est reconnue, avec ses étapes et l’outil', posed && c.bench[0]?.item === 'ecorce' && c.recipe?.id === 'fibres' && /Battre l’écorce/.test(recipeText ?? '') && /✓/.test(recipeText ?? ''), recipeText ?? '');
  for (let k = 1; k <= 2; k++) {
    await clickButton('.craft-actions', 'Faire');
    await waitFor(page, (k) => [...window.__game.body().inventory.pockets, ...(window.__game.body().inventory.bag ?? [])].filter((s) => s && s.item === 'fibres').reduce((n, s) => n + s.count, 0) >= 2 * k, k, 10000).catch(() => undefined);
  }
  b = await body();
  check('« Faire : battre l’écorce » (3 s, galet du sac comme percuteur), deux fois : 4 poignées de fibres', countItem(b, 'fibres') === 4 && (await craft()).bench.length === 0, `${countItem(b, 'fibres')} fibres`);
  await clickCell((cl) => cl.kind === 'fibres');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  await clickButton('.craft-actions', 'Faire');
  await waitFor(page, () => window.__game.body().inventory.bag?.some((s) => s.item === 'corde') || window.__game.body().inventory.pockets.some((s) => s?.item === 'corde'), null, 10000).catch(() => undefined);
  await clickButton('.bench-list', 'Reprendre');
  b = await body();
  check('Corde : 3 fibres torsadées ; « Reprendre » rend la fibre en trop', countItem(b, 'corde') === 1 && countItem(b, 'fibres') === 1 && (await craft()).bench.length === 0);
  await clickCell((cl) => cl.kind === 'quartz');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  await clickCell((cl) => cl.kind === 'manche');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  await clickCell((cl) => cl.kind === 'corde');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  c = await craft();
  const benchCells = (await bagInfo()).cells.filter((cl) => cl.slot.zone === 'etabli' && cl.kind).length;
  check('Couteau : un seul éclat posé (l’autre reste pour travailler), la branche et la corde ; 3 cases du plan de travail en 3D', c.recipe?.id === 'couteau' && c.bench.find((s) => s.item === 'quartz')?.count === 1 && countItem(await body(), 'quartz') >= 1 && benchCells === 3, JSON.stringify(c.bench.map((s) => `${s.item}×${s.count}`)));
  writeFileSync(`${OUT}phase4-fabriquer.png`, await page.screenshot());
  for (let step = 0; step < 3; step++) {
    await clickButton('.craft-actions', 'Faire');
    await waitFor(page, () => !window.__game.craft().gesture, null, 10000).catch(() => undefined);
    await sleep(200);
  }
  b = await body();
  const knife = [...b.inventory.pockets, ...(b.inventory.bag ?? [])].find((s) => s?.item === 'couteau');
  const doneMsg = await message();
  check('Trois étapes (fendre, emmancher, ligaturer) : un couteau de pierre, avec qualité et durabilité', knife && knife.q > 0 && knife.d === knife.dm, `${doneMsg} · ${JSON.stringify(knife)}`);
  await page.click('[data-tab="carnet"]');
  await sleep(400);
  const carnet = await page.textContent('.carnet');
  c = await craft();
  writeFileSync(`${OUT}phase4-carnet.png`, await page.screenshot());
  check('Carnet : niveau de fabrication, recettes connues, idée de hache après le couteau', c.knowledge.xp > 0 && c.knowledge.hinted.includes('hache') && /Recettes connues/.test(carnet ?? '') && /hache/.test(carnet ?? ''), `${Math.round(c.knowledge.xp)} points · idées : ${c.knowledge.hinted.join(', ')}`);

  // 5. Expérimenter : bâtons + corde + bûche → archet (inconnu), puis foyer.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.push({ item: 'baton', count: 6 }, { item: 'corde', count: 1 }, { item: 'buche', count: 1, mass: 2.4, radius: 0.07, length: 0.6 }, { item: 'herbe', count: 3 });
  });
  await page.click('[data-tab="fabriquer"]');
  await sleep(300);
  for (const kind of ['baton', 'corde', 'buche']) {
    await clickCell((cl) => cl.kind === kind && cl.slot.zone !== 'etabli');
    await clickButton('.item-actions', 'Poser sur le plan de travail');
  }
  const unknownText = await page.textContent('.recipe');
  await clickButton('.craft-actions', 'Essayer');
  await sleep(300);
  const discovered = await message();
  c = await craft();
  check('« Essayer d’assembler » des pièces inconnues : nouvelle recette découverte (archet à feu)', c.knowledge.known.includes('archet') && /Nouvelle recette/.test(discovered ?? ''), `${unknownText} → « ${discovered} »`);
  for (let step = 0; step < 3; step++) {
    if (step > 0) await clickButton('.craft-actions', 'Faire');
    await waitFor(page, () => !window.__game.craft().gesture, null, 12000).catch(() => undefined);
    await sleep(200);
  }
  b = await body();
  check('L’archet à feu est fabriqué (le couteau sert d’outil tranchant)', countItem(b, 'archet') === 1, await message());
  await clickCell((cl) => cl.kind === 'herbe' && cl.slot.zone !== 'etabli');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  c = await craft();
  const foyerRecipe = c.recipe?.id;
  await clickButton('.craft-actions', 'Faire');
  await waitFor(page, () => window.__game.craft().fires.length > 0, null, 10000).catch(() => undefined);
  await clickButton('.bench-list', 'Reprendre');
  c = await craft();
  check('Foyer : 4 bâtons et 2 brassées d’herbes ; il est monté devant soi', foyerRecipe === 'foyer' && c.fires.length === 1 && !c.fires[0].lit, JSON.stringify(c.fires[0] ?? null));
  await closeBag();

  // 6. Feu : E sur le foyer ouvre son panneau ; allumer à l'archet, ajouter du bois.
  const fire = c.fires[0];
  await page.evaluate((f) => window.__game.place(f.x - 1.6, f.z), fire);
  await sleep(500);
  await page.evaluate((f) => window.__game.lookAt(f.x, f.y, f.z), fire);
  await sleep(400);
  const promptFire = await page.textContent('#prompt');
  await page.keyboard.press('KeyE');
  await sleep(600);
  let bag = await bagInfo();
  const fireOpen = bag.open && bag.other === fire.id;
  await restStamina();
  const lightClicked = await clickButton('.item-actions', 'Allumer le feu');
  await waitFor(page, () => window.__game.craft().fires[0]?.lit, null, 12000).catch(() => undefined);
  c = await craft();
  const title = await page.textContent('.bag-title');
  check('E sur le foyer : son panneau s’ouvre ; « Allumer le feu » (archet + herbes, 6 s) l’allume', fireOpen && lightClicked && c.fires[0].lit && /Foyer allumé/.test(title ?? ''), `indication : « ${promptFire} » · « ${title} »`);
  await page.evaluate(() => window.__game.sim().inventory.bag.push({ item: 'baton', count: 2 }));
  const fuel0 = c.fires[0].fuel;
  await clickButton('.item-actions', 'Ajouter du bois');
  c = await craft();
  check('« Ajouter du bois » : un bâton nourrit le feu d’une minute', c.fires[0].fuel > fuel0 + 50, `${Math.round(fuel0)} → ${Math.round(c.fires[0].fuel)} s`);

  // 7. Eau bouillie et pansements propres.
  await page.evaluate(() => window.__game.sim().inventory.bag.push({ item: 'pot', count: 1, q: 70, d: 200, dm: 200, w: 1 }));
  await sleep(300);
  await clickCell((cl) => cl.kind === 'pot');
  const potOnFire = await clickButton('.item-actions', 'Poser sur le feu');
  await sleep(400);
  const heating = await page.textContent('.bag-title');
  // On abrège l'attente (30 s d'ébullition) : la cuisson elle-même est vérifiée par les tests unitaires.
  await page.evaluate(() => {
    const f = window.__game.sim().props.fires()[0].fire;
    f.cook = Math.max(f.cook, 28.5);
  });
  await waitFor(page, () => window.__game.craft().fires[0]?.pot?.w === 2, null, 8000).catch(() => undefined);
  const boiling = await page.textContent('.bag-title');
  await clickButton('.item-actions', 'Reprendre le pot');
  b = await body();
  const pot = [...b.inventory.pockets, ...(b.inventory.bag ?? [])].find((s) => s?.item === 'pot');
  check('Pot d’eau posé sur le feu : l’eau chauffe puis bout ; « Reprendre le pot »', potOnFire && /l’eau chauffe/.test(heating ?? '') && /l’eau bout/.test(boiling ?? '') && pot?.w === 2, `« ${heating} » → « ${boiling} »`);
  await page.click('[data-tab="corps"]');
  await sleep(300);
  await clickButton('.body-actions', 'Déchirer la chemise');
  await page.click('[data-tab="fabriquer"]');
  await sleep(300);
  await clickCell((cl) => cl.kind === 'chiffon' && cl.slot.zone !== 'etabli');
  await clickButton('.item-actions', 'Poser sur le plan de travail');
  await clickButton('.craft-actions', 'Essayer');
  await waitFor(page, () => !window.__game.craft().gesture, null, 10000).catch(() => undefined);
  await sleep(300);
  b = await body();
  c = await craft();
  const potAfter = [...b.inventory.pockets, ...(b.inventory.bag ?? [])].find((s) => s?.item === 'pot');
  check('Chiffons + eau bouillante : recette des pansements propres découverte ; 2 pansements, le pot se vide', c.knowledge.known.includes('pansement') && countItem(b, 'pansement') === 2 && potAfter?.w === 0, await message());
  await clickButton('.bench-list', 'Reprendre');
  await closeBag();

  // 8. Abattre un arbre à la hache (F maintenu) : souche, bûches, sauvegarde.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[3] = { item: 'hache', count: 1, q: 75, d: 150, dm: 150 };
  });
  const tree2 = await nearestTree(page);
  await page.evaluate((t) => window.__game.place(t.x - 1.2, t.z), tree2);
  await settle(page);
  await page.keyboard.press('Digit4');
  await sleep(400);
  await page.evaluate((t) => window.__game.lookAt(t.x, t.y + 1.0, t.z), tree2);
  await sleep(400);
  const promptAxe = await page.textContent('#prompt');
  let felled = false;
  for (let k = 0; k < 6 && !felled; k++) {
    await restStamina();
    await page.keyboard.down('KeyF');
    felled = await waitFor(page, (key) => window.__game.sim().world.isFelled(key, window.__game.sim().time), tree2.key, 9000)
      .then(() => true)
      .catch(() => false);
    await page.keyboard.up('KeyF');
  }
  await sleep(1500);
  const logs = await page.evaluate((t) => window.__game.session().props.filter((p) => p.kind === 'buche' && Math.hypot(p.x - t.x, p.z - t.z) < 9).length, tree2);
  const trunkGone = await page.evaluate((key) => ![...window.__game.sim().phys.trees.values()].some((t) => t.key === key), tree2.key);
  writeFileSync(`${OUT}phase4-abattage.png`, await page.screenshot());
  check('Hache en main, F maintenu sur un arbre debout : il s’abat (souche), des bûches tombent', felled && trunkGone && logs >= 2, `${tree2.species} · indication : « ${promptAxe} » · ${logs} bûches · ${await message()}`);

  // 9. Sauvegarde : quitter, recharger, reprendre.
  const before = await craft();
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  await page.click('#btn-quit');
  await waitFor(page, () => window.__game.screen() === 'home', null, 10000);
  await page.reload();
  await startGame(page);
  await settle(page);
  const after = await craft();
  const stillFelled = await page.evaluate((key) => window.__game.sim().world.isFelled(key, window.__game.sim().time), tree2.key);
  b = await body();
  check(
    'Quitter, recharger : recettes apprises, compétence, foyer et arbre abattu sont conservés',
    after.knowledge.known.length === before.knowledge.known.length && after.knowledge.xp === before.knowledge.xp && after.fires.length === 1 && stillFelled && countItem(b, 'pansement') === 2,
    `${after.knowledge.known.length} recettes · ${Math.round(after.knowledge.xp)} points · ${after.fires.length} foyer`,
  );

  // Outils de test : devant l'affleurement de fer le plus proche ; jeu d'outils.
  const t0 = performance.now();
  await page.evaluate(() => window.__game.teleport('fer'));
  const tpMs = Math.round(performance.now() - t0);
  await settle(page);
  const iron = await nearestOf(page, 'filon_fer', 4);
  const kitCount = await page.evaluate(() => window.__game.testKit());
  b = await body();
  check(
    'Outils de test : « Affleurement de fer le plus proche » amène à côté d’un affleurement ; jeu d’outils reçu',
    iron !== null && kitCount === 7 && countItem(b, 'batee') === 1 && countItem(b, 'baton_fouir') === 1,
    `recherche ${tpMs} ms · ${kitCount} objet(s) reçu(s)`,
  );
  check('Aucune erreur dans la console (phase 4)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Téléphone (à l'horizontale) : sac à deux colonnes, onglets Fabriquer et Carnet, bouton « Utiliser ».
  console.log('\n— Phase 4 : téléphone');
  const touchCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await touchCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const tPage = await touchCtx.newPage();
  const tErrors = watchErrors(tPage, 'phase 4 (téléphone)');
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
    const r = await tPage.locator(sel).first().boundingBox();
    await tapAt(r.x + r.width / 2, r.y + r.height / 2);
  };
  await tPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[0] = { item: 'ecorce', count: 1 };
    sim.inventory.bag.push({ item: 'pierre', count: 1, mass: 0.6, radius: 0.04 });
  });
  await tap('[data-touch="bag"]');
  await sleep(600);
  const pickBox = await tPage.locator('.bag-pick').boundingBox();
  const infoBox = await tPage.locator('.bag-info').boundingBox();
  const tabs = await tPage.evaluate(() => [...document.querySelectorAll('.bag-tabs button')].filter((x) => x.offsetParent).map((x) => x.textContent));
  writeFileSync(`${OUT}phase4-telephone-sac.png`, await tPage.screenshot());
  check('Téléphone à l’horizontale : le sac en 3D à gauche, les actions à droite ; onglets Sac, Corps, Fabriquer, Construire, Carnet', pickBox.width > 330 && pickBox.height > 250 && infoBox.x >= pickBox.x + pickBox.width - 2 && tabs.join(',') === 'Sac,Corps,Fabriquer,Construire,Carnet', `sac ${Math.round(pickBox.width)}×${Math.round(pickBox.height)} · actions à x=${Math.round(infoBox.x)} · ${tabs.join(', ')}`);
  let tb = await tPage.evaluate(() => window.__game.bag());
  const barkCell = tb.cells.find((cl) => cl.kind === 'ecorce');
  await tapAt(barkCell.x, barkCell.y);
  await tap('.item-actions button:has-text("Poser sur le plan de travail")');
  await tap('[data-tab="fabriquer"]');
  await sleep(300);
  const craftVisible = await tPage.isVisible('.panel-fabriquer');
  writeFileSync(`${OUT}phase4-telephone-fabriquer.png`, await tPage.screenshot());
  await tap('.craft-actions button:has-text("Faire")');
  await waitFor(tPage, () => window.__game.body().inventory.pockets.some((p) => p?.item === 'fibres'), null, 10000).catch(() => undefined);
  const tBody = await tPage.evaluate(() => window.__game.body());
  check('Téléphone : toucher l’écorce, « Poser sur le plan de travail », onglet « Fabriquer », « Faire » : 2 fibres', craftVisible && countItem(tBody, 'fibres') === 2);
  await tap('[data-tab="carnet"]');
  await sleep(300);
  const carnetVisible = await tPage.isVisible('.carnet');
  await tap('.bag-close');
  await sleep(300);
  check('Téléphone : onglet « Carnet » puis « Fermer »', carnetVisible && !(await tPage.evaluate(() => window.__game.bag().open)));
  const tBlock = await nearestOf(tPage, 'bloc_quartz');
  await tPage.evaluate((n) => {
    const sim = window.__game.sim();
    window.__game.place(n.x - 1.9, n.z);
    sim.act({ type: 'sortir', from: { zone: 'sac', index: sim.inventory.bag.findIndex((s) => s.item === 'pierre') } });
  }, tBlock);
  await settle(tPage);
  await tPage.evaluate((n) => window.__game.lookAt(n.x, n.y + 0.2, n.z), tBlock);
  await sleep(400);
  for (let k = 0; k < 4; k++) {
    await tap('[data-touch="use"]');
    await sleep(500);
  }
  const tFlakes = await tPage.evaluate(([x, z]) => window.__game.session().props.filter((p) => p.kind === 'quartz' && Math.hypot(p.x - x, p.z - z) < 3.5).length, [tBlock.x, tBlock.z]);
  check('Téléphone : le bouton « Utiliser » frappe le bloc de quartz avec le galet tenu', tFlakes >= 1, `${tFlakes} éclat(s)`);
  check('Aucune erreur dans la console (phase 4, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  // Manette : Y ouvre le sac, RB change d'onglet, X pose sur le plan de travail, A fabrique.
  console.log('\n— Phase 4 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript(installTestPad, QA_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 4 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const { press } = padControls(pPage);
  await pPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[0] = { item: 'ecorce', count: 1 };
    sim.inventory.bag.push({ item: 'pierre', count: 1, mass: 0.6, radius: 0.04 });
  });
  await press(3);
  const padOpened = await pPage.evaluate(() => window.__game.bag().open);
  await press(5);
  await press(5);
  let pb = await pPage.evaluate(() => window.__game.bag());
  const onCraftTab = pb.tab === 'fabriquer' && (await pPage.isVisible('.panel-fabriquer'));
  await press(2);
  const pc = await pPage.evaluate(() => window.__game.craft());
  check('Manette : Y ouvre le sac, RB deux fois → « Fabriquer », X pose l’écorce choisie sur le plan de travail', padOpened && onCraftTab && pc.bench[0]?.item === 'ecorce' && pc.recipe?.id === 'fibres', `sac ouvert ${padOpened} · onglet ${pb.tab} · plan : ${JSON.stringify(pc.bench)}`);
  await press(0);
  await waitFor(pPage, () => window.__game.body().inventory.pockets.some((p) => p?.item === 'fibres'), null, 10000).catch(() => undefined);
  const pBody = await pPage.evaluate(() => window.__game.body());
  check('Manette : A lance l’étape (battre l’écorce) : 2 fibres', countItem(pBody, 'fibres') === 2);
  await press(1);
  await sleep(300);
  check('Manette : B referme le sac', !(await pPage.evaluate(() => window.__game.bag().open)));
  check('Aucune erreur dans la console (phase 4, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

/** Centre d'une pièce dans le monde (même calcul que building.ts). */
const PIECE_CENTER = `(st, slot, dy) => {
  const G = 2, H = 2.4;
  let lx, lz;
  if (slot.t === 'f' || slot.t === 'r') { lx = (slot.i + 0.5) * G; lz = (slot.j + 0.5) * G; }
  else if (slot.t === 'c') { lx = slot.i * G; lz = slot.j * G; }
  else if (slot.d === 'x') { lx = (slot.i + 0.5) * G; lz = slot.j * G; }
  else { lx = slot.i * G; lz = (slot.j + 0.5) * G; }
  const c = Math.cos(st.yaw), n = Math.sin(st.yaw);
  return { x: st.x + lx * c + lz * n, y: st.y + slot.k * H + dy, z: st.z - lx * n + lz * c };
}`;

/** Point du monde à partir de coordonnées locales d'une construction. */
const LOCAL = `(st, lx, ly, lz) => { const c = Math.cos(st.yaw), n = Math.sin(st.yaw); return { x: st.x + lx * c + lz * n, y: st.y + ly, z: st.z - lx * n + lz * c }; }`;

async function phase5Scenario(browser) {
  console.log('\n— Phase 5 : construction (ordinateur)');
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 560 } });
  await ctx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 5');
  await page.goto(BASE);
  await startGame(page);
  await settle(page);
  const build = () => page.evaluate(() => window.__game.build());
  const message = () => page.textContent('#message');
  // Un coin dégagé : on s'écarte un peu de l'arrivée.
  await page.evaluate(() => {
    const s = window.__game.sim().state;
    window.__game.place(s.x + 14, s.z + 10);
  });
  await settle(page);
  await sleep(500);
  let b = await build();
  check('Départ : plans de construction connus (plancher, murs, porte, toit…), aucun chantier', b.plans.includes('sol_rondins') && b.plans.includes('mur_pierre') && !b.plans.includes('forge') && b.structures.length === 0, b.plans.join(', '));

  // 1. Onglet « Construire » : tracer un plancher.
  await page.keyboard.press('Tab');
  await waitFor(page, () => window.__game.bag().open, null, 5000);
  await sleep(300);
  await page.click('[data-tab="construire"]');
  await sleep(300);
  const planButtons = await page.evaluate(() => [...document.querySelectorAll('.plans button')].map((x) => x.textContent));
  await page.click('.plans button:has-text("plancher en rondins")');
  await sleep(400);
  b = await build();
  const bagClosed = !(await page.evaluate(() => window.__game.bag().open));
  check('Onglet « Construire » : la liste des plans avec leurs matériaux ; « Tracer » ferme le sac et passe en mode construction', bagClosed && b.mode === 'sol_rondins' && planButtons.some((t) => /4 bûches/.test(t)), planButtons.slice(0, 2).join(' | '));
  await page.evaluate(() => {
    const s = window.__game.sim().state;
    const yaw = window.__game.session().yaw;
    const x = s.x + Math.sin(yaw) * 3;
    const z = s.z + Math.cos(yaw) * 3;
    window.__game.lookAt(x, window.__game.sim().terrain.heightAt(x, z), z);
  });
  await sleep(500);
  b = await build();
  const promptPlan = await page.textContent('#prompt');
  writeFileSync(`${OUT}phase5-fantome.png`, await page.screenshot());
  await page.keyboard.press('KeyR');
  await sleep(300);
  const turned = (await build()).turn;
  check('Le fantôme suit le regard (vert : possible) ; R le tourne', b.preview?.ok === true && /poser le plan/.test(promptPlan ?? '') && turned === 1, `« ${promptPlan} »`);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.up();
  await sleep(500);
  b = await build();
  const placed = b.structures.length === 1 && b.structures[0].pieces[0].step === 0;
  await page.mouse.down({ button: 'right' });
  await sleep(120);
  await page.mouse.up({ button: 'right' });
  await sleep(300);
  b = await build();
  check('Clic gauche : le plan est posé (chantier) ; clic droit : fin du mode construction', placed && b.mode === null, await message());

  // 2. Apporter les matériaux et assembler (F).
  const st0 = b.structures[0];
  const floorCenter = await page.evaluate(([fn, st]) => eval(fn)(st, st.pieces[0].slot, 0), [PIECE_CENTER, st0]);
  // Bûches posées à côté du chantier ; cordes en poche ; une perche et un bâton à fouir pour les pilotis s'il en faut.
  await page.evaluate(([c]) => {
    const sim = window.__game.sim();
    for (let k = 0; k < 4; k++) sim.props.spawnDynamic({ kind: 'buche', x: c.x + 1.8 + k * 0.25, y: c.y + 0.6, z: c.z + 0.6, rot: 0.25, radius: 0.07, length: 0.6 });
    sim.inventory.pockets[0] = { item: 'corde', count: 2 };
    sim.inventory.bag.push({ item: 'perche', count: 2 }, { item: 'baton_fouir', count: 1, q: 70, d: 80, dm: 80 });
  }, [floorCenter]);
  const nSteps = 2 + (st0.pieces[0].stilts > 0 ? 1 : 0);
  await sleep(800);
  const hintMissing = await page.evaluate(([c]) => {
    window.__game.lookAt(c.x, c.y - 0.1, c.z);
    return null;
  }, [floorCenter]);
  await sleep(400);
  const promptSite = await page.textContent('#prompt');
  for (let step = 0; step < nSteps; step++) {
    await page.keyboard.press('KeyF');
    await waitFor(page, (n) => window.__game.build().structures[0]?.pieces[0]?.step > n, step, 15000).catch(() => undefined);
    await sleep(300);
  }
  b = await build();
  const floor = b.structures[0].pieces[0];
  check(
    'Bûches posées à côté, cordes en poche : F fait chaque étape (pilotis s’il le faut, rondins, ligature), le plancher est terminé et solide',
    floor.step === nSteps && floor.hp > 0 && b.colliders > 0,
    `${st0.pieces[0].stilts} pilotis · indication : « ${promptSite} » · ${await message()}`,
  );
  void hintMissing;

  // 3. Une porte sur le bord avant, assemblée à la main.
  const st1 = b.structures[0];
  const doorAim = await page.evaluate(([fn, st]) => eval(fn)(st, 1, 1.2, 0), [LOCAL, st1]);
  const r = await page.evaluate(([aim]) => window.__game.act({ type: 'planifier', plan: 'porte', aim, turn: 0, on: null }), [doorAim]);
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.push({ item: 'perche', count: 2 }, { item: 'baton', count: 6 }, { item: 'couteau', count: 1, q: 70, d: 120, dm: 120 });
    sim.inventory.pockets[0] = { item: 'corde', count: 1 };
  });
  // On se place devant la porte (côté extérieur), face à elle.
  const outside = await page.evaluate(([fn, st]) => eval(fn)(st, 1, 0, -1.6), [LOCAL, st1]);
  await page.evaluate(([o]) => window.__game.place(o.x, o.z), [outside]);
  await sleep(600);
  await page.evaluate(([a]) => window.__game.lookAt(a.x, a.y, a.z), [doorAim]);
  await sleep(300);
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press('KeyF');
    await waitFor(page, (n) => (window.__game.build().structures[0]?.pieces.find((p) => p.plan === 'porte')?.step ?? 0) > n, step, 15000).catch(() => undefined);
    await sleep(300);
  }
  b = await build();
  const door = b.structures[0].pieces.find((p) => p.plan === 'porte');
  check('Plan de porte tracé sur le bord du plancher, trois étapes (montants, battant, attaches) : porte terminée', r?.ok && door?.step === 3, r?.message ?? '');
  // La porte fermée arrête le joueur ; E l'ouvre ; on entre.
  const localZ = () => page.evaluate((st) => {
    const s = window.__game.sim().state;
    const c = Math.cos(st.yaw), n = Math.sin(st.yaw);
    return (s.x - st.x) * n + (s.z - st.z) * c;
  }, st1);
  await page.keyboard.down('KeyW');
  await sleep(1500);
  await page.keyboard.up('KeyW');
  const blockedZ = await localZ();
  await page.evaluate(([a]) => window.__game.lookAt(a.x, a.y, a.z), [doorAim]);
  await sleep(300);
  const promptDoor = await page.textContent('#prompt');
  await page.keyboard.press('KeyE');
  await sleep(500);
  const opened = (await build()).structures[0].pieces.find((p) => p.plan === 'porte').open;
  await page.evaluate((st) => {
    window.__game.session().yaw = st.yaw;
    window.__game.session().pitch = 0;
  }, st1);
  // Sur une pente, le plancher peut dépasser d'une marche : on saute en avançant, comme un joueur.
  await page.keyboard.down('KeyW');
  await sleep(500);
  await page.keyboard.press('Space');
  await sleep(1300);
  await page.keyboard.up('KeyW');
  const insideZ = await localZ();
  writeFileSync(`${OUT}phase5-porte.png`, await page.screenshot());
  check('Porte fermée : on bute dessus ; E l’ouvre ; on entre dans la case', blockedZ < -0.2 && opened && insideZ > 0.5, `bloqué à z=${blockedZ.toFixed(2)} · « ${promptDoor} » · dedans à z=${insideZ.toFixed(2)}`);

  // 4. Le feu : une torche allumée à un foyer enflamme un mur ; on l'éteint depuis le panneau du mur.
  await page.evaluate((st) => {
    const sim = window.__game.sim();
    const c = Math.cos(st.yaw), n = Math.sin(st.yaw);
    const at = (lx, ly, lz) => ({ x: st.x + lx * c + lz * n, y: st.y + ly, z: st.z - lx * n + lz * c });
    // Mur du fond, construit directement (le chemin complet est vérifié plus haut).
    const aim = at(1, 1.2, 2);
    const pl = sim.build.placement({ plan: 'mur_clayonnage', aim, yaw: 0, turn: 0, player: at(1, 0, 1) });
    const ref = sim.build.apply(pl);
    while (!sim.build.advance(ref.s, ref.p, false)) {}
    const f = at(1, 0, 1.2);
    sim.props.spawnDynamic({ kind: 'foyer', x: f.x + 0.6, y: st.y + 0.12, z: f.z, rot: 0, radius: 0.45, length: 0, fixed: true, fire: { lit: true, fuel: 900, pot: null, cook: 0 } });
    sim.inventory.bag.push({ item: 'pot', count: 1, q: 70, d: 200, dm: 200, w: 1 });
    sim.inventory.bag.unshift({ item: 'torche', count: 1, d: 600, dm: 600 });
    sim.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
  }, st1);
  await sleep(600);
  await page.keyboard.press('KeyF');
  await sleep(400);
  const torchMsg = await message();
  const wallAim = await page.evaluate(([fn, st]) => eval(fn)(st, 1, 1.2, 2), [LOCAL, st1]);
  await page.evaluate(([a]) => window.__game.lookAt(a.x, a.y, a.z), [wallAim]);
  await sleep(300);
  const promptFire = await page.textContent('#prompt');
  await page.keyboard.press('KeyF');
  await sleep(2500);
  b = await build();
  const wall = b.structures[0].pieces.find((p) => p.plan === 'mur_clayonnage');
  writeFileSync(`${OUT}phase5-feu.png`, await page.screenshot());
  check('Torche allumée au foyer (F), puis F sur le mur de clayonnage : il prend feu et s’abîme', /allume/.test(torchMsg ?? '') && wall?.burning > 0 && wall.hp < 220, `« ${promptFire} » · état ${wall?.hp}`);
  await page.evaluate(() => window.__game.act({ type: 'ranger' }));
  await sleep(300);
  await page.evaluate(([a]) => window.__game.lookAt(a.x, a.y, a.z), [wallAim]);
  await sleep(300);
  await page.keyboard.press('KeyE');
  await waitFor(page, () => window.__game.bag().open, null, 5000).catch(() => undefined);
  await sleep(400);
  const panelTitle = await page.textContent('.bag-title');
  const putOut = await page.locator('.item-actions button:has-text("Éteindre")').count();
  if (putOut) await page.click('.item-actions button:has-text("Éteindre")');
  await sleep(400);
  b = await build();
  const wall2 = b.structures[0].pieces.find((p) => p.plan === 'mur_clayonnage');
  check('E sur le mur : son panneau (stabilité, état, EN FEU) ; « Éteindre (pot d’eau) » éteint le feu', /EN FEU/.test(panelTitle ?? '') && wall2.burning === 0, `« ${panelTitle} »`);
  await page.keyboard.press('Tab');
  await sleep(300);

  // 5. Sauvegarde : quitter, recharger, reprendre.
  const before = await build();
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000);
  await page.click('#btn-quit');
  await waitFor(page, () => window.__game.screen() === 'home', null, 10000);
  await page.reload();
  await startGame(page);
  await settle(page);
  const after = await build();
  const count = (x) => x.structures.reduce((n, st) => n + st.pieces.length, 0);
  check('Quitter, recharger : les constructions sont conservées (pièces, porte ouverte)', count(after) === count(before) && after.structures[0].pieces.find((p) => p.plan === 'porte')?.open === true, `${count(after)} pièces`);
  const kit = await page.evaluate(() => window.__game.buildKit());
  await sleep(800);
  const nearKit = await page.evaluate(() => {
    const st = window.__game.session();
    return st.props.filter((p) => ['buche', 'perche', 'baton', 'pierre', 'argile'].includes(p.kind) && Math.hypot(p.x - st.state.x, p.z - st.state.z) < 3.5).length;
  });
  check('Outil de test : matériaux de construction posés à côté du joueur', kit === 48 && nearKit >= 40, `${kit} objets, ${nearKit} à portée`);
  check('Aucune erreur dans la console (phase 5)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Téléphone : onglet Construire, boutons « Poser », « Tourner », « Annuler ».
  console.log('\n— Phase 5 : téléphone');
  const touchCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await touchCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const tPage = await touchCtx.newPage();
  const tErrors = watchErrors(tPage, 'phase 5 (téléphone)');
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
    const rect = await tPage.locator(sel).first().boundingBox();
    await tapAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
  };
  await tPage.evaluate(() => {
    const s = window.__game.sim().state;
    window.__game.place(s.x - 12, s.z + 10);
  });
  await settle(tPage);
  await tap('[data-touch="bag"]');
  await sleep(500);
  await tap('[data-tab="construire"]');
  await sleep(300);
  writeFileSync(`${OUT}phase5-telephone-construire.png`, await tPage.screenshot());
  await tap('.plans button:has-text("poteau")');
  await sleep(400);
  const labels = await tPage.evaluate(() => ['throw', 'interact', 'use'].map((n) => document.querySelector(`[data-touch="${n}"]`).textContent));
  await tPage.evaluate(() => {
    const s = window.__game.sim().state;
    const yaw = window.__game.session().yaw;
    const x = s.x + Math.sin(yaw) * 2.5;
    const z = s.z + Math.cos(yaw) * 2.5;
    window.__game.lookAt(x, window.__game.sim().terrain.heightAt(x, z), z);
  });
  await sleep(400);
  await tap('[data-touch="throw"]');
  await sleep(400);
  let tb = await tPage.evaluate(() => window.__game.build());
  const tPlaced = tb.structures.length === 1;
  await tap('[data-touch="use"]');
  await sleep(300);
  tb = await tPage.evaluate(() => window.__game.build());
  const back = await tPage.evaluate(() => document.querySelector('[data-touch="throw"]').textContent);
  check('Téléphone : « Tracer », boutons « Poser · Tourner · Annuler », « Poser » pose le plan, « Annuler » revient au jeu', labels.join(',') === 'Poser,Tourner,Annuler' && tPlaced && tb.mode === null && back === 'Lancer', labels.join(', '));
  check('Aucune erreur dans la console (phase 5, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  // Manette : Y, RB jusqu'à « Construire », A trace, RT pose, LT annule.
  console.log('\n— Phase 5 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript(installTestPad, QA_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 5 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const { press } = padControls(pPage);
  await pPage.evaluate(() => {
    const s = window.__game.sim().state;
    window.__game.place(s.x + 14, s.z + 10);
  });
  await settle(pPage);
  await press(3);
  await press(5);
  await press(5);
  await press(5);
  const tab = (await pPage.evaluate(() => window.__game.bag())).tab;
  await press(0);
  let pb = await pPage.evaluate(() => window.__game.build());
  const mode = pb.mode;
  await pPage.evaluate(() => {
    const s = window.__game.sim().state;
    const yaw = window.__game.session().yaw;
    const x = s.x + Math.sin(yaw) * 3;
    const z = s.z + Math.cos(yaw) * 3;
    window.__game.lookAt(x, window.__game.sim().terrain.heightAt(x, z), z);
  });
  await sleep(400);
  await press(7);
  await sleep(300);
  pb = await pPage.evaluate(() => window.__game.build());
  const pPlaced = pb.structures.length === 1;
  await press(6);
  await sleep(300);
  pb = await pPage.evaluate(() => window.__game.build());
  check('Manette : Y, RB ×3 → « Construire », A trace le premier plan, RT pose, LT annule', tab === 'construire' && mode === 'sol_rondins' && pPlaced && pb.mode === null, `onglet ${tab} · mode ${mode}`);
  check('Aucune erreur dans la console (phase 5, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

async function phase6Scenario(browser) {
  console.log('\n— Phase 6 : créatures et horreur (ordinateur)');
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 560 }, fauna: true });
  await ctx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA6_SETTINGS);
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 6');
  await page.goto(BASE);
  await startGame(page);
  await settle(page);
  const fauna = () => page.evaluate(() => window.__game.creatures());
  const message = () => page.textContent('#message');
  const clear = () =>
    page.evaluate(() => {
      for (const c of window.__game.sim().fauna.creatures.values()) c.dead = true;
    });
  // 1. Un vrai monde : des animaux apparaissent selon la région (vallée du Zambèze).
  await page.evaluate(() => window.__game.teleport('vallee'));
  await settle(page);
  await waitFor(page, () => window.__game.creatures().count > 0, null, 30000).catch(() => undefined);
  let f = await fauna();
  const species = [...new Set(f.list.map((c) => c.sp))];
  check('Faune : des animaux apparaissent autour du joueur selon la région (vallée)', f.enabled && f.count > 0, `${f.count} créatures : ${species.join(', ')}`);
  writeFileSync(`${OUT}phase6-vallee.png`, await page.screenshot());
  // La suite se joue sans apparitions spontanées, pour des vérifications précises.
  await page.evaluate(() => (window.__game.sim().fauna.wild = false));
  await clear();
  await sleep(2500);
  // 2. Le premier clic démarre le son (règle des navigateurs).
  await page.click('#game');
  await sleep(400);
  f = await fauna();
  check('Sons : le premier clic démarre le son (fabriqué par le navigateur)', f.soundRunning === true);
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000).catch(() => undefined);
  await page.click('#btn-resume');
  await sleep(300);
  // 3. Des impalas fuient le joueur qui court vers eux.
  await page.evaluate(() => window.__game.spawnCreatures('impala', 32, 4));
  await sleep(600);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  let fled = false;
  for (let k = 0; k < 30 && !fled; k++) {
    await sleep(200);
    fled = (await fauna()).list.some((c) => c.sp === 'impala' && c.mode === 'fuite');
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  check('Impalas : ils fuient le joueur qui court vers eux', fled);
  await clear();
  await sleep(1500);
  // 4. Combat : la lance en main, F frappe l'animal visé (dégâts localisés), jusqu'à la carcasse.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.unshift({ item: 'lance', count: 1 });
    window.__game.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
  });
  await sleep(300);
  const preyId = await page.evaluate(() => {
    const sim = window.__game.sim();
    const s = sim.state;
    const yaw = window.__game.session().yaw;
    const [id] = sim.spawnCreatures('phacochere', s.x + Math.sin(yaw) * 2.3, s.z + Math.cos(yaw) * 2.3, 1);
    const c = sim.fauna.creatures.get(id);
    c.yaw = yaw + Math.PI / 2;
    sim.fauna.setCaught(id, 'test');
    return id;
  });
  const aimPrey = () =>
    page.evaluate((id) => {
      const c = window.__game.sim().fauna.creatures.get(id);
      if (c) window.__game.lookAt(c.x, c.y + 0.45, c.z);
    }, preyId);
  await aimPrey();
  await sleep(400);
  const hitPrompt = await page.textContent('#prompt');
  const hp0 = await page.evaluate((id) => window.__game.sim().fauna.creatures.get(id).hp, preyId);
  await page.keyboard.press('KeyF');
  await sleep(500);
  const hp1 = await page.evaluate((id) => window.__game.sim().fauna.creatures.get(id)?.hp ?? 0, preyId);
  check('Combat : « F : frapper le phacochère » ; le coup de lance le blesse', /frapper le phacochère/.test(hitPrompt ?? '') && hp1 < hp0, `${hitPrompt} · ${hp0} → ${Math.round(hp1)}`);
  for (let k = 0; k < 15; k++) {
    const dead = await page.evaluate((id) => !window.__game.sim().fauna.creatures.get(id) || window.__game.sim().fauna.creatures.get(id).dead, preyId);
    if (dead) break;
    await aimPrey();
    await page.keyboard.press('KeyF');
    await sleep(900);
  }
  await sleep(500);
  f = await fauna();
  const carcass = f.carcasses.find((c) => c.sp === 'phacochere');
  check('Le phacochère abattu laisse une carcasse', !!carcass, JSON.stringify(f.carcasses));
  // 5. Dépeçage au couteau, puis cuisson au foyer et repas.
  await page.evaluate(() => window.__game.act({ type: 'ranger' }));
  await sleep(300);
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.unshift({ item: 'couteau', count: 1 });
    window.__game.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
  });
  await sleep(400);
  if (carcass) await page.evaluate((k) => window.__game.lookAt(k.x, k.y, k.z), carcass);
  await sleep(400);
  const butcherPrompt = await page.textContent('#prompt');
  await page.keyboard.press('KeyF');
  await waitFor(page, () => window.__game.body().inventory.bag.some((b) => b.item === 'viande_crue') || window.__game.body().inventory.pockets.some((p) => p?.item === 'viande_crue'), null, 30000).catch(() => undefined);
  let body = await page.evaluate(() => window.__game.body());
  const meat = countItem(body, 'viande_crue');
  check('Dépeçage : « F : dépecer la carcasse » donne de la viande crue', /dépecer la carcasse/.test(butcherPrompt ?? '') && meat >= 2, `${butcherPrompt} · ${meat} morceaux`);
  const fire = await page.evaluate(() => {
    const sim = window.__game.sim();
    const s = sim.state;
    return sim.props.spawnDynamic({ kind: 'foyer', x: s.x + 1.2, y: s.y + 0.1, z: s.z, rot: 0, radius: 0.45, length: 0, fixed: true, fire: { lit: true, fuel: 3000, pot: null, cook: 0 } });
  });
  const cooked = await page.evaluate((fire) => {
    const sim = window.__game.sim();
    const i = sim.inventory.bag.findIndex((b) => b.item === 'viande_crue');
    const p = sim.inventory.pockets.findIndex((x) => x?.item === 'viande_crue');
    const from = i >= 0 ? { zone: 'sac', index: i } : { zone: 'poche', index: p };
    return window.__game.act({ type: 'poser_feu', prop: fire, from });
  }, fire);
  await waitFor(page, (fire) => window.__game.sim().props.defOf(fire)?.fire?.pot?.item === 'viande_cuite', fire, 70000).catch(() => undefined);
  await page.evaluate((fire) => window.__game.act({ type: 'reprendre_feu', prop: fire }), fire);
  body = await page.evaluate(() => window.__game.body());
  check('Cuisson : la viande posée sur le foyer allumé cuit (« Reprendre la viande »)', cooked?.ok && countItem(body, 'viande_cuite') >= 2, `${cooked?.message ?? ''} · ${countItem(body, 'viande_cuite')} cuits`);
  await page.evaluate(() => window.__game.act({ type: 'ranger' }));
  // Le foyer est éteint et retiré : près d'un feu, les hyènes n'approchent pas (vérifié par les tests unitaires).
  await page.evaluate((fire) => window.__game.sim().props.remove(fire), fire);
  await clear();
  await sleep(1500);
  // 6. Les hyènes encerclent un joueur blessé et mordent.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.vitals.health = 45;
    sim.vitals.injuries.push({ id: 900, zone: 'jambe_d', kind: 'coupure', grave: false, age: 0, heal: 0, bandaged: false, splinted: false, disinfected: false, clotted: false, infection: 0, infectAt: -1 });
    window.__game.spawnCreatures('hyene', 30, 3);
  });
  let bitten = false;
  let hyenaMsg = '';
  for (let k = 0; k < 120 && !bitten; k++) {
    await sleep(500);
    const m = (await message()) ?? '';
    if (/hyène vous mord/.test(m)) {
      bitten = true;
      hyenaMsg = m;
    }
  }
  const strike = await page.evaluate(() => Number(getComputedStyle(document.querySelector('#vignette')).opacity));
  check('Hyènes : elles encerclent le joueur blessé et mordent (blessure localisée, bord rouge)', bitten && strike > 0.2, `${hyenaMsg} · bord rouge ${strike.toFixed(2)}`);
  writeFileSync(`${OUT}phase6-hyenes.png`, await page.screenshot());
  await clear();
  await page.evaluate(() => {
    const v = window.__game.sim().vitals;
    v.injuries = [];
    v.health = 100;
  });
  await sleep(1500);
  // 7. Onglet « Construire » : les pièges.
  await page.keyboard.press('Tab');
  await waitFor(page, () => window.__game.bag().open, null, 5000).catch(() => undefined);
  await page.click('[data-tab="construire"]');
  await sleep(300);
  const planButtons = await page.evaluate(() => [...document.querySelectorAll('.plans button')].map((x) => x.textContent));
  check('Onglet « Construire » : collet, assommoir et fosse à pieux, avec leurs matériaux', planButtons.some((t) => /collet \(2 bâtons, une corde\)/.test(t)) && planButtons.some((t) => /assommoir/.test(t)) && planButtons.some((t) => /fosse à pieux/.test(t)), planButtons.filter((t) => /collet|assommoir|fosse/.test(t)).join(' | '));
  await page.keyboard.press('Escape');
  await sleep(400);
  // 8. Un collet retient l'impala qui y passe.
  const trapped = await page.evaluate(async () => {
    const sim = window.__game.sim();
    const s = sim.state;
    const yaw = window.__game.session().yaw;
    const x = s.x + Math.sin(yaw) * 6;
    const z = s.z + Math.cos(yaw) * 6;
    const trap = sim.props.spawnDynamic({ kind: 'collet', x, y: sim.terrain.heightAt(x, z) + 0.05, z, rot: 0, radius: 0.35, length: 0.1, fixed: true, trap: { armed: true, caught: null } });
    // Comme un piège construit : les créatures le connaissent tout de suite.
    sim.noticeWorldChange();
    sim.spawnCreatures('impala', x, z + 0.2, 1);
    return trap;
  });
  await waitFor(page, (t) => window.__game.sim().props.defOf(t)?.trap?.caught?.startsWith('c'), trapped, 8000).catch(() => undefined);
  const caught = await page.evaluate((t) => {
    const sim = window.__game.sim();
    const id = sim.props.defOf(t)?.trap?.caught;
    const c = id ? sim.fauna.creatures.get(id) : null;
    return c ? { sp: c.sp, mode: c.mode } : null;
  }, trapped);
  const trapMsg = (await message()) ?? '';
  check('Piège : le collet retient l’impala, qui se débat', caught?.sp === 'impala' && caught.mode === 'pris', `${JSON.stringify(caught)} · ${trapMsg}`);
  await clear();
  await sleep(1500);
  // 9. La créature du lac : elle saisit le nageur ; il se dégage en se débattant (E).
  await page.evaluate(() => window.__game.lakeTest());
  await settle(page);
  await page.evaluate(() => {
    const g = [...window.__game.sim().fauna.groups.values()].find((x) => x.sp === 'ombre');
    g.attention = 0.95;
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitFor(page, () => window.__game.creatures().grab !== null, null, 120000).catch(() => undefined);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  f = await fauna();
  const dread = await page.evaluate(() => Number(getComputedStyle(document.querySelector('#dread')).opacity));
  writeFileSync(`${OUT}phase6-lac.png`, await page.screenshot());
  const grabbed = f.grab !== null;
  for (let k = 0; k < 14 && (await fauna()).grab; k++) {
    await page.keyboard.press('KeyE');
    await sleep(250);
  }
  const freed = (await fauna()).grab === null;
  check('Lac : la créature saisit le nageur (la vue s’assombrit) ; il se dégage en se débattant (E)', grabbed && freed && dread > 0.15, `saisi ${grabbed} · libéré ${freed} · assombri ${dread.toFixed(2)}`);
  // 10. Sauvegarde : la faune (populations, individus suivis) est conservée.
  const saved = await page.evaluate(() => window.__game.save());
  check('Sauvegarde : populations et individus suivis enregistrés', typeof saved === 'string' && saved.includes('"fauna"') && saved.includes('"traits"'));
  // 11. Outils de test : faire apparaître des créatures depuis les réglages.
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000).catch(() => undefined);
  await page.click('#btn-pause-settings');
  await sleep(300);
  const hasVolume = await page.isVisible('#set-volume');
  await page.selectOption('#set-species', 'elephant');
  await page.click('#set-spawn');
  await sleep(500);
  f = await fauna();
  check('Réglages : volume des sons ; l’outil de test fait apparaître des éléphants', hasVolume && f.list.some((c) => c.sp === 'elephant'), `${f.list.filter((c) => c.sp === 'elephant').length} éléphants`);
  check('Aucune erreur dans la console (phase 6)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Téléphone : « Utiliser » frappe l'animal visé.
  console.log('\n— Phase 6 : téléphone');
  const touchCtx = await browser.newContext({ ...devices['Pixel 7 landscape'], fauna: true });
  await touchCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA6_SETTINGS);
  const tPage = await touchCtx.newPage();
  const tErrors = watchErrors(tPage, 'phase 6 (téléphone)');
  await tPage.goto(BASE);
  await startGame(tPage);
  await settle(tPage);
  const cdp = await touchCtx.newCDPSession(tPage);
  const tap = async (sel, ms = 140) => {
    const rect = await tPage.locator(sel).first().boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), id: 3 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  };
  const tPrey = await tPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.fauna.wild = false;
    for (const c of sim.fauna.creatures.values()) c.dead = true;
    sim.inventory.bag.unshift({ item: 'hache', count: 1 });
    window.__game.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    const s = sim.state;
    const yaw = window.__game.session().yaw;
    const [id] = sim.spawnCreatures('phacochere', s.x + Math.sin(yaw) * 1.6, s.z + Math.cos(yaw) * 1.6, 1);
    sim.fauna.creatures.get(id).yaw = yaw + Math.PI / 2;
    sim.fauna.setCaught(id, 'test');
    return id;
  });
  await sleep(400);
  await tPage.evaluate((id) => {
    const c = window.__game.sim().fauna.creatures.get(id);
    window.__game.lookAt(c.x, c.y + 0.45, c.z);
  }, tPrey);
  await sleep(400);
  const tPrompt = await tPage.textContent('#prompt');
  const thp0 = await tPage.evaluate((id) => window.__game.sim().fauna.creatures.get(id).hp, tPrey);
  await tap('[data-touch="use"]');
  await sleep(400);
  const thp1 = await tPage.evaluate((id) => window.__game.sim().fauna.creatures.get(id)?.hp ?? 0, tPrey);
  check('Téléphone : « Utiliser » frappe l’animal visé', /« Utiliser » : frapper le phacochère/.test(tPrompt ?? '') && thp1 < thp0, `${tPrompt} · ${thp0} → ${Math.round(thp1)}`);
  check('Aucune erreur dans la console (phase 6, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await touchCtx.close();

  // Manette : LT frappe l'animal visé.
  console.log('\n— Phase 6 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 }, fauna: true });
  await padCtx.addInitScript(installTestPad, QA6_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 6 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const { press } = padControls(pPage);
  const pPrey = await pPage.evaluate(() => {
    const sim = window.__game.sim();
    sim.fauna.wild = false;
    for (const c of sim.fauna.creatures.values()) c.dead = true;
    sim.inventory.bag.unshift({ item: 'lance', count: 1 });
    window.__game.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    const s = sim.state;
    const yaw = window.__game.session().yaw;
    const [id] = sim.spawnCreatures('phacochere', s.x + Math.sin(yaw) * 2.3, s.z + Math.cos(yaw) * 2.3, 1);
    sim.fauna.creatures.get(id).yaw = yaw + Math.PI / 2;
    sim.fauna.setCaught(id, 'test');
    return id;
  });
  await sleep(400);
  await pPage.evaluate((id) => {
    const c = window.__game.sim().fauna.creatures.get(id);
    window.__game.lookAt(c.x, c.y + 0.45, c.z);
  }, pPrey);
  await sleep(300);
  const php0 = await pPage.evaluate((id) => window.__game.sim().fauna.creatures.get(id).hp, pPrey);
  await press(6);
  await sleep(300);
  const php1 = await pPage.evaluate((id) => window.__game.sim().fauna.creatures.get(id)?.hp ?? 0, pPrey);
  check('Manette : LT frappe l’animal visé', php1 < php0, `${php0} → ${Math.round(php1)}`);
  check('Aucune erreur dans la console (phase 6, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

async function phase7Scenario(browser, touchOnly = false) {
  console.log('\n— Phase 7 : véhicules et machines (ordinateur)');
  if (!touchOnly) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 560 } });
  await ctx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const page = await ctx.newPage();
  const errors = watchErrors(page, 'phase 7');
  await page.goto(BASE);
  await startGame(page);
  await settle(page);
  const message = () => page.textContent('#message');
  const driving = () => page.evaluate(() => window.__game.driving());
  const vehicles = () => page.evaluate(() => window.__game.vehicles());
  const aimAt = (id, dy = 0.6) =>
    page.evaluate(([vid, h]) => {
      const v = window.__game.sim().vehicle(vid);
      window.__game.lookAt(v.x, v.y + h, v.z);
    }, [id, dy]);
  // 1. Plans : chariot à bras et radeau connus d'emblée ; le kit de test apprend les autres.
  const known0 = await page.evaluate(() => window.__game.sim().knowledge.plans.slice());
  await page.evaluate(() => window.__game.vehicleKit());
  await page.evaluate(() => window.__game.openBag());
  await sleep(400);
  const allButtons = (await page.evaluate(() => window.__game.bag())).all;
  await page.evaluate(() => window.__game.closeBag());
  check(
    'Plans : chariot à bras et radeau connus d’emblée ; onglet Construire : véhicules et machines',
    known0.includes('chariot_bras') && known0.includes('radeau') && ['chariot à bras', 'chariot (', 'radeau', 'pirogue', 'roue à eau', 'machine à vapeur fixe', 'meule', 'soufflet mécanique', 'pompe'].every((w) => allButtons.some((b) => b.toLowerCase().includes(`tracer : ${w}`))),
    allButtons.filter((b) => b.startsWith('Tracer')).length + ' plans',
  );
  // 2. Tracer le chariot à bras (fantôme), le chantier, deux étapes : le châssis calé attend ses roues.
  const ground = await page.evaluate(() => {
    const s = window.__game.sim().state;
    const yaw = window.__game.session().yaw;
    return { x: s.x + Math.sin(yaw) * 3.6, y: window.__game.sim().terrain.heightAt(s.x + Math.sin(yaw) * 3.6, s.z + Math.cos(yaw) * 3.6), z: s.z + Math.cos(yaw) * 3.6 };
  });
  await page.evaluate(() => window.__game.startBuild('chariot_bras'));
  await page.evaluate(([g]) => window.__game.lookAt(g.x, g.y, g.z), [ground]);
  await sleep(500);
  const ghostPrompt = await page.textContent('#prompt');
  await page.click('#game');
  await sleep(500);
  const site = await page.evaluate(() => window.__game.sim().build.sites.find((x) => x.plan === 'chariot_bras') ?? null);
  check('Plan du chariot à bras : le fantôme suit le regard, un clic pose le chantier', !!site, `« ${ghostPrompt} »`);
  await page.evaluate(() => window.__game.stopBuild());
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.bag.push({ item: 'buche', count: 1, mass: 5, radius: 0.07, length: 0.6 }, { item: 'buche', count: 1, mass: 5, radius: 0.07, length: 0.6 }, { item: 'perche', count: 2 });
  });
  if (site) await page.evaluate(([st]) => window.__game.lookAt(st.x, st.y + 0.4, st.z), [site]);
  await sleep(300);
  for (let step = 0; step < 2; step++) {
    await page.keyboard.press('KeyF');
    await waitFor(page, (n) => (window.__game.sim().build.sites.find((x) => x.plan === 'chariot_bras')?.step ?? 99) > n, step, 15000).catch(() => undefined);
    await sleep(300);
  }
  await sleep(500);
  let vs = await vehicles();
  const cart = vs.find((v) => v.frame === 'chariot_bras');
  check('Chantier en deux étapes (F) : le chariot à bras est terminé, calé, sans roues', !!cart && cart.parts.length === 0, (await message()) ?? '');
  // 3. Prendre sur le châssis : son panneau ; on installe les quatre petites roues.
  if (cart) await aimAt(cart.id, 0.55);
  await sleep(300);
  await page.keyboard.press('KeyE');
  await sleep(500);
  let bag = await page.evaluate(() => window.__game.bag());
  const panel = bag.open && bag.all.some((b) => b.startsWith('Installer une petite roue'));
  for (const slot of ['avant gauche', 'avant droite', 'arrière gauche', 'arrière droite']) {
    await page.evaluate((label) => window.__game.bagRun(label), `Installer une petite roue (${slot})`);
    await waitFor(page, () => !window.__game.sim().gesture, null, 10000).catch(() => undefined);
    await sleep(200);
  }
  vs = await vehicles();
  const cart2 = vs.find((v) => v.frame === 'chariot_bras');
  check('Prendre (E) sur le châssis ouvre son panneau ; quatre petites roues installées', panel && cart2?.parts.length === 4, `${cart2?.parts.length} roues · ${(await message()) ?? ''}`);
  // 4. Pousser : le joueur prend les brancards, avance (W), le chariot roule devant lui ; E pour lâcher.
  await page.evaluate(() => window.__game.bagRun('Pousser'));
  await sleep(300);
  const d0 = await driving();
  const p0 = cart2 ? { x: cart2.x, z: cart2.z } : { x: 0, z: 0 };
  await page.keyboard.down('KeyW');
  await sleep(3500);
  const hud = await page.textContent('#vehicle-hud');
  const hudShown = await page.isVisible('#vehicle-hud');
  await page.keyboard.up('KeyW');
  vs = await vehicles();
  const cart3 = vs.find((v) => v.frame === 'chariot_bras');
  const moved = cart3 ? Math.hypot(cart3.x - p0.x, cart3.z - p0.z) : 0;
  const st = (await sess(page)).state;
  check('Pousser : le joueur derrière les brancards, W fait rouler le chariot ; tableau de bord (vitesse, effort)', d0?.mode === 'pousse' && moved > 2.5 && Math.hypot(st.x - cart3.x, st.z - cart3.z) < 2 && hudShown && /km\/h/.test(hud ?? '') && /effort/.test(hud ?? ''), `${moved.toFixed(1)} m · « ${hud} »`);
  await page.keyboard.press('KeyE');
  await sleep(400);
  check('E lâche les brancards', (await driving()) === null);
  // Coffre du chariot : une corde (poche 1) rangée depuis son panneau ; une caisse apparaît sur le plateau.
  await page.evaluate(() => {
    const sim = window.__game.sim();
    sim.inventory.pockets[0] = { item: 'corde', count: 2 };
  });
  if (cart3) await aimAt(cart3.id, 0.6);
  await sleep(300);
  await page.keyboard.press('KeyE');
  await sleep(500);
  const chestBtn = (await page.evaluate(() => window.__game.bag())).actions.find((a) => a.startsWith('Ranger dans'));
  if (chestBtn) await page.evaluate((label) => window.__game.bagRun(label), chestBtn);
  await sleep(300);
  await page.evaluate(() => window.__game.closeBag());
  const cargo = (await vehicles()).find((v) => v.frame === 'chariot_bras')?.cargo ?? [];
  await sleep(300);
  const crate = cart3 ? await page.evaluate((id) => window.__game.hasMesh(`${id} caisse`), cart3.id) : false;
  check('Coffre du chariot : depuis son panneau, « Ranger dans le chariot à bras » y met la corde ; une caisse apparaît sur le plateau', chestBtn === 'Ranger dans le chariot à bras' && cargo.some((c) => c.item === 'corde') && crate, `${chestBtn} · ${JSON.stringify(cargo)} · caisse ${crate}`);
  // 5. Chariot à vapeur : on monte sur le siège, la machine l'emmène ; la vue tourne avec lui.
  const wagon = await page.evaluate(() => window.__game.spawnVehicle('chariot', true));
  await sleep(800);
  await aimAt(wagon, 1.0);
  await sleep(300);
  await page.keyboard.press('KeyE');
  await sleep(400);
  bag = await page.evaluate(() => window.__game.bag());
  const seatBtn = bag.all.includes('Monter sur le siège');
  await page.evaluate(() => window.__game.bagRun('Monter sur le siège'));
  await sleep(400);
  const w0 = (await vehicles()).find((v) => v.id === wagon);
  await page.keyboard.down('KeyW');
  await sleep(4000);
  const fast = (await driving())?.speed ?? 0;
  const yaw0 = (await sess(page)).yaw;
  await page.keyboard.down('KeyD');
  await sleep(1200);
  await page.keyboard.up('KeyD');
  const yaw1 = (await sess(page)).yaw;
  writeFileSync(`${OUT}phase7-chariot.png`, await page.screenshot());
  await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  await sleep(1500);
  await page.keyboard.up('Space');
  const w1 = (await vehicles()).find((v) => v.id === wagon);
  const turned = Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0)));
  check('Chariot à vapeur : sur le siège, W accélère (machine), D tourne et la vue suit le chariot, Espace freine', seatBtn && fast > 3 && turned > 0.4 && Math.hypot(w1.x - w0.x, w1.z - w0.z) > 10 && (await driving())?.speed < 1, `${fast.toFixed(1)} m/s · virage ${turned.toFixed(2)} rad`);
  const snd = await page.evaluate(() => window.__game.sounds());
  check('Sons : le chariot à vapeur fait entendre ses coups de piston et le roulement de ses roues', snd.running && (snd.counts.vapeur_coup ?? 0) > 3 && (snd.counts.roue_roule ?? 0) > 3, JSON.stringify({ vapeur: snd.counts.vapeur_coup, roues: snd.counts.roue_roule }));
  await page.keyboard.press('KeyE');
  await sleep(500);
  const out = (await sess(page)).state;
  const w2 = (await vehicles()).find((v) => v.id === wagon);
  check('E : on descend à côté du chariot', (await driving()) === null && Math.hypot(out.x - w2.x, out.z - w2.z) > 0.9 && Math.hypot(out.x - w2.x, out.z - w2.z) < 4);
  // Vue de l'extérieur : on recule de quelques pas et on regarde le chariot (capture).
  await page.evaluate(([w]) => {
    const s = window.__game.sim().state;
    const dx = s.x - w.x;
    const dz = s.z - w.z;
    const l = Math.hypot(dx, dz) || 1;
    window.__game.place(w.x + (dx / l) * 5.5, w.z + (dz / l) * 5.5);
  }, [w2]);
  await sleep(600);
  await page.evaluate(([w]) => window.__game.lookAt(w.x, w.y + 0.9, w.z), [w2]);
  await sleep(500);
  writeFileSync(`${OUT}phase7-chariot-dehors.png`, await page.screenshot());
  // 6. Radeau sur le lac : on monte à bord en nageant, on pagaie (l'endurance baisse).
  await page.evaluate(() => window.__game.teleport('lac'));
  await settle(page);
  const raft = await page.evaluate(() => window.__game.spawnVehicle('radeau', false));
  await sleep(1500);
  const r0 = (await vehicles()).find((v) => v.id === raft);
  const board = await page.evaluate((id) => window.__game.act({ type: 'vehicule', v: id, op: 'monter' }), raft);
  await sleep(300);
  const stamina0 = (await sess(page)).state.stamina;
  await page.keyboard.down('KeyW');
  await sleep(6000);
  const hudRaft = await page.textContent('#vehicle-hud');
  await page.evaluate(() => window.__game.lookDown(0.45));
  await sleep(300);
  writeFileSync(`${OUT}phase7-radeau.png`, await page.screenshot());
  await page.keyboard.up('KeyW');
  const r1 = (await vehicles()).find((v) => v.id === raft);
  const stamina1 = (await sess(page)).state.stamina;
  check('Radeau : il flotte ; on monte à bord depuis l’eau, W pagaie, l’endurance baisse', board?.ok && Math.abs(r0.y) < 0.4 && Math.hypot(r1.x - r0.x, r1.z - r0.z) > 3 && stamina1 < stamina0 - 8, `${board?.message} · ${Math.hypot(r1.x - r0.x, r1.z - r0.z).toFixed(1)} m · endurance ${Math.round(stamina0)} → ${Math.round(stamina1)} · « ${hudRaft} »`);
  await page.keyboard.press('KeyE');
  await sleep(400);
  // 7. Sauvegarde : les véhicules (pièces, chaudière) sont enregistrés.
  const saved = await page.evaluate(() => window.__game.save());
  check('Sauvegarde : véhicules enregistrés (pièces, chaudière)', typeof saved === 'string' && saved.includes('"vehicles"') && saved.includes('"machine_vapeur"'));
  // 8. Outils de test : faire apparaître un véhicule depuis les réglages.
  const n0 = (await vehicles()).length;
  await page.keyboard.press('Escape');
  await waitFor(page, () => window.__game.screen() === 'pause', null, 5000).catch(() => undefined);
  await page.click('#btn-pause-settings');
  await sleep(300);
  await page.selectOption('#set-vehicle', 'pirogue');
  await page.click('#set-vehicle-go');
  await sleep(500);
  const vsAfter = await vehicles();
  check('Réglages : l’outil de test fait apparaître une pirogue', vsAfter.length === n0 + 1 && vsAfter.some((v) => v.frame === 'pirogue'));
  check('Aucune erreur dans la console (phase 7)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // Vagues : en qualité Moyenne, par vent fort, la surface du lac ondule (et le radeau danse).
  const wCtx = await browser.newContext({ viewport: { width: 1000, height: 560 } });
  await wCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), { ...QA_SETTINGS, quality: 'medium' });
  const wPage = await wCtx.newPage();
  const wErrors = watchErrors(wPage, 'phase 7 (vagues)');
  await wPage.goto(BASE);
  await startGame(wPage);
  await settle(wPage);
  await wPage.evaluate(() => window.__game.teleport('lac'));
  await settle(wPage);
  await wPage.evaluate(() => {
    const sim = window.__game.sim();
    for (let t = sim.time; t < sim.time + 40000; t += 50) {
      sim.time = t;
      if (sim.wind().speed > 6.5) break;
    }
  });
  const wRaft = await wPage.evaluate(() => window.__game.spawnVehicle('radeau', false));
  await sleep(1500);
  const ys = [];
  for (let k = 0; k < 12; k++) {
    ys.push(await wPage.evaluate((id) => window.__game.sim().vehicle(id).y, wRaft));
    await sleep(150);
  }
  const water = await wPage.evaluate(() => window.__game.water());
  const wind = await wPage.evaluate(() => window.__game.wind());
  writeFileSync(`${OUT}phase7-vagues.png`, await wPage.screenshot());
  check('Vagues : par vent fort, la surface du lac ondule et le radeau danse sur l’eau', water?.waves && water.maxY > 0.05 && Math.max(...ys) - Math.min(...ys) > 0.02, `vent ${wind?.speed.toFixed(1)} m/s · vagues ${water?.maxY.toFixed(2)} m · radeau ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} m`);
  check('Aucune erreur dans la console (phase 7, vagues)', wErrors.length === 0, wErrors.slice(0, 3).join(' | '));
  await wCtx.close();
  }

  // Téléphone : Prendre sur le chariot, « Pousser », joystick vers l'avant, Prendre pour lâcher.
  console.log('\n— Phase 7 : téléphone');
  const tCtx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await tCtx.addInitScript((settings) => localStorage.setItem('baz.settings.v1', JSON.stringify(settings)), QA_SETTINGS);
  const tPage = await tCtx.newPage();
  const tErrors = watchErrors(tPage, 'phase 7 (téléphone)');
  await tPage.goto(BASE);
  await startGame(tPage);
  await settle(tPage);
  const cdp = await tCtx.newCDPSession(tPage);
  const tapAt = async (x, y, ms = 120) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 7 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  const tap = async (sel) => {
    const r = await tPage.locator(sel).first().boundingBox();
    await tapAt(r.x + r.width / 2, r.y + r.height / 2);
  };
  const tCart = await tPage.evaluate(() => window.__game.spawnVehicle('chariot_bras', false));
  await sleep(800);
  await tPage.evaluate((id) => {
    const v = window.__game.sim().vehicle(id);
    window.__game.lookAt(v.x, v.y + 0.6, v.z);
  }, tCart);
  await sleep(300);
  await tap('[data-touch="interact"]');
  await sleep(600);
  const tBag = await tPage.evaluate(() => window.__game.bag());
  const tOpen = tBag.open;
  // Le toucher qui ouvre le panneau ne déclenche pas le bouton apparu sous le doigt.
  const noGhost = (await tPage.evaluate(() => window.__game.sim().gesture)) === null;
  writeFileSync(`${OUT}phase7-telephone-panneau.png`, await tPage.screenshot());
  await tap('.item-actions button:has-text("Pousser")');
  await sleep(400);
  const tDrive = await tPage.evaluate(() => window.__game.driving());
  const tv0 = await tPage.evaluate((id) => ({ ...window.__game.sim().vehicle(id) }), tCart);
  const vp = tPage.viewportSize();
  const jx = vp.width * 0.18;
  const jy = vp.height * 0.7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jx, y: jy, id: 1 }] });
  for (let k = 1; k <= 6; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jx, y: jy - k * 12, id: 1 }] });
    await sleep(30);
  }
  await sleep(3000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tv1 = await tPage.evaluate((id) => ({ ...window.__game.sim().vehicle(id) }), tCart);
  const tPrompt = await tPage.textContent('#prompt');
  await tap('[data-touch="interact"]');
  await sleep(400);
  const tAfter = await tPage.evaluate(() => window.__game.driving());
  check('Téléphone : Prendre sur le chariot ouvre son panneau (sans cliquer le bouton apparu sous le doigt), « Pousser », le joystick le fait rouler, Prendre le lâche', tOpen && noGhost && tDrive?.mode === 'pousse' && Math.hypot(tv1.x - tv0.x, tv1.z - tv0.z) > 1.5 && tAfter === null, `${Math.hypot(tv1.x - tv0.x, tv1.z - tv0.z).toFixed(1)} m · « ${tPrompt} »`);
  check('Aucune erreur dans la console (phase 7, téléphone)', tErrors.length === 0, tErrors.slice(0, 3).join(' | '));
  await tCtx.close();

  // Manette : X ouvre le chariot à vapeur, on monte, le stick gauche avance, X pour descendre.
  console.log('\n— Phase 7 : manette');
  const padCtx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await padCtx.addInitScript(installTestPad, QA_SETTINGS);
  const pPage = await padCtx.newPage();
  const pErrors = watchErrors(pPage, 'phase 7 (manette)');
  await pPage.goto(BASE);
  await startGame(pPage);
  await settle(pPage);
  const { press, axes } = padControls(pPage);
  const pWagon = await pPage.evaluate(() => window.__game.spawnVehicle('chariot', true));
  await sleep(800);
  await pPage.evaluate((id) => {
    const v = window.__game.sim().vehicle(id);
    window.__game.lookAt(v.x, v.y + 1.0, v.z);
  }, pWagon);
  await sleep(300);
  await press(2);
  await sleep(400);
  const pBag = await pPage.evaluate(() => window.__game.bag());
  const pOpen = pBag.open && pBag.actions[0] === 'Monter sur le siège';
  // A : la première action du panneau (monter sur le siège).
  await press(0);
  await sleep(400);
  const pSeated = (await pPage.evaluate(() => window.__game.driving()))?.mode === 'siege';
  const pv0 = await pPage.evaluate((id) => ({ ...window.__game.sim().vehicle(id) }), pWagon);
  await axes([0, -1, 0, 0]);
  await sleep(3000);
  await axes([0, 0, 0, 0]);
  const pv1 = await pPage.evaluate((id) => ({ ...window.__game.sim().vehicle(id) }), pWagon);
  await sleep(1500);
  await press(2);
  await sleep(400);
  const pAfter = await pPage.evaluate(() => window.__game.driving());
  check('Manette : X ouvre le chariot, A pour monter sur le siège, le stick gauche le fait avancer, X pour descendre', pOpen && pSeated && Math.hypot(pv1.x - pv0.x, pv1.z - pv0.z) > 5 && pAfter === null, `${Math.hypot(pv1.x - pv0.x, pv1.z - pv0.z).toFixed(1)} m · ${pBag.actions.slice(0, 2).join(', ')}`);
  check('Aucune erreur dans la console (phase 7, manette)', pErrors.length === 0, pErrors.slice(0, 3).join(' | '));
  await padCtx.close();
}

/**
 * Les scénarios des phases 1 à 5 se jouent sans créatures : un animal ne doit pas fausser un test
 * qui n'a rien à voir avec lui. Les contextes ouverts avec { fauna: true } (phase 6) les gardent.
 */
function noFaunaByDefault(browser) {
  const open = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const { fauna, ...rest } = options;
    const ctx = await open(rest);
    if (fauna) return ctx;
    const patch = () => {
      try {
        const raw = localStorage.getItem('baz.settings.v1');
        const s = raw ? JSON.parse(raw) : {};
        if (s.fauna === undefined) {
          s.fauna = false;
          localStorage.setItem('baz.settings.v1', JSON.stringify(s));
        }
      } catch {
        // Stockage indisponible : la faune reste active.
      }
    };
    const add = ctx.addInitScript.bind(ctx);
    // Toujours après les scripts du scénario (qui écrivent les réglages).
    ctx.addInitScript = async (...args) => {
      await add(...args);
      await add(patch);
    };
    await add(patch);
    return ctx;
  };
}

// --only=ordinateur,telephone,manette,phase2,verification,phase3,phase4,phase5,phase6,phase7,performance,captures,webgpu pour ne lancer que certains scénarios.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const want = (name) => (only ? only.has(name) : name !== 'webgpu' || process.argv.includes('--webgpu'));

const server = await startServer();
try {
  const browser = await chromium.launch();
  noFaunaByDefault(browser);
  if (want('ordinateur')) await desktopScenario(browser);
  if (want('telephone')) await touchScenario(browser);
  if (want('manette')) await gamepadScenario(browser);
  if (want('performance')) await benchScenario(browser);
  if (want('phase2')) await phase2Scenario(browser);
  if (want('verification')) await qaScenario(browser);
  if (want('phase3')) await phase3Scenario(browser);
  if (want('phase4')) await phase4Scenario(browser);
  if (want('phase5')) await phase5Scenario(browser);
  if (want('phase6')) await phase6Scenario(browser);
  if (want('phase7')) await phase7Scenario(browser);
  if (want('phase7t')) await phase7Scenario(browser, true);
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
