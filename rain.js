(() => {
  "use strict";

  const canvas = document.getElementById("rainCanvas");
  const stage = document.getElementById("stage");
  if (!canvas || !stage) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  const drops = [];
  const splashes = [];
  const ripples = [];
  const MAX_DROPS = 310;
  const MAX_SPLASHES = 150;
  const MAX_RIPPLES = 36;
  let width = 850;
  let height = 530;
  let dpr = 1;
  let active = false;
  let last = performance.now();
  let spawnCarry = 0;

  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function resetDrop(drop, initial = false) {
    const depth = Math.random();
    drop.x = rand(-width * 0.18, width * 1.03);
    drop.y = initial ? rand(-height, height) : rand(-height * 0.42, -15);
    drop.vx = rand(105, 185) * (0.65 + depth * 0.72);
    drop.vy = rand(690, 1080) * (0.72 + depth * 0.52);
    drop.len = rand(13, 31) * (0.7 + depth * 0.65);
    drop.alpha = rand(0.22, 0.7) * (0.62 + depth * 0.52);
    drop.width = rand(0.55, 1.25) * (0.72 + depth * 0.45);
    // Dopadová rovina je různě vysoko, takže déšť působí prostorově v aréně.
    drop.ground = rand(height * 0.60, height * 0.985);
    drop.depth = depth;
    return drop;
  }

  function makeDrop(initial = false) {
    return resetDrop({}, initial);
  }

  function addSplash(x, y, strength) {
    const count = 2 + Math.floor(strength * 4);
    for (let i = 0; i < count && splashes.length < MAX_SPLASHES; i += 1) {
      const angle = rand(Math.PI * 1.08, Math.PI * 1.92);
      const speed = rand(28, 92) * (0.65 + strength * 0.65);
      splashes.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rand(12, 46),
        life: rand(0.13, 0.32),
        maxLife: 0,
        size: rand(0.7, 1.6),
        alpha: rand(0.35, 0.85)
      });
      splashes[splashes.length - 1].maxLife = splashes[splashes.length - 1].life;
    }
    if (ripples.length < MAX_RIPPLES && Math.random() < 0.35) {
      ripples.push({ x, y, life: rand(0.18, 0.34), maxLife: 0, radius: rand(2, 5), speed: rand(20, 45) });
      ripples[ripples.length - 1].maxLife = ripples[ripples.length - 1].life;
    }
  }

  function setActive(value) {
    active = Boolean(value);
    canvas.classList.toggle("active", active);
    if (active && drops.length === 0) {
      for (let i = 0; i < MAX_DROPS; i += 1) drops.push(makeDrop(true));
    }
    if (!active) {
      splashes.length = 0;
      ripples.length = 0;
    }
  }

  function update(dt) {
    if (!active) return;

    spawnCarry += dt * 185;
    while (drops.length < MAX_DROPS && spawnCarry >= 1) {
      drops.push(makeDrop(false));
      spawnCarry -= 1;
    }

    for (let i = 0; i < drops.length; i += 1) {
      const d = drops[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y >= d.ground || d.x > width + 45) {
        if (d.y >= d.ground) addSplash(d.x, d.ground, d.depth);
        resetDrop(d, false);
      }
    }

    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      const p = splashes[i];
      p.life -= dt;
      if (p.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      p.vy += 330 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const r = ripples[i];
      r.life -= dt;
      if (r.life <= 0) {
        ripples.splice(i, 1);
        continue;
      }
      r.radius += r.speed * dt;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!active) return;

    // Jemný mokrý opar bez zakrytí hry.
    const mist = ctx.createLinearGradient(0, height * 0.52, 0, height);
    mist.addColorStop(0, "rgba(150,180,205,0)");
    mist.addColorStop(1, "rgba(125,155,180,0.08)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, height * 0.52, width, height * 0.48);

    ctx.lineCap = "round";
    for (const d of drops) {
      const factor = d.len / d.vy;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.vx * factor, d.y - d.len);
      ctx.strokeStyle = `rgba(185,220,245,${d.alpha})`;
      ctx.lineWidth = d.width;
      ctx.stroke();
    }

    for (const r of ripples) {
      const t = r.life / r.maxLife;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.24, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(195,225,245,${0.42 * t})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    for (const p of splashes) {
      const t = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.65 + t), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(205,230,248,${p.alpha * t})`;
      ctx.fill();
    }
  }

  function frame(now) {
    const dt = Math.min(0.035, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("madness-arena-state", (event) => setActive(event.detail?.active));
  document.addEventListener("visibilitychange", () => { last = performance.now(); });

  // Záloha pro případ, že událost při načtení proběhla ještě před rain.js.
  window.setInterval(() => {
    const debugActive = Boolean(window.__madnessCoopDebug?.state?.arenaLaunched);
    if (debugActive !== active) setActive(debugActive);
  }, 400);

  resize();
  setActive(document.documentElement.dataset.arenaActive === "true");
  requestAnimationFrame(frame);
})();
