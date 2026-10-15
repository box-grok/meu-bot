/**
 * Desenho e teclado da cobrinha da tela vazia (regras em lib/snake.ts). Começa sozinha quando o painel
 * aparece e para quando ele some; setas ou WASD viram, e segurar a tecla é turbo (o passo cai pela metade). O tabuleiro é o painel inteiro (as bordas do app
 * são as paredes, que ela atravessa) e acompanha a janela. Fundo sólido do tema: só a grade de pontos,
 * a cobrinha no azul da máquina e a bolha-mascote (o ícone do app, com olhos e boca) na cor da vez.
 */
import { createSnake, resizeBoard, step, tickMs, turn, type SnakeState } from "./lib/snake.js";

/** Lado alvo de uma célula, em px: o tabuleiro ganha colunas/linhas conforme a janela. */
const CELL_PX = 30;
/** A bolha do mascote (template #intro-mascot-tpl), no viewBox 64. */
const BUBBLE = "M12 8h40a8 8 0 0 1 8 8v26a8 8 0 0 1-8 8H30l-11 10V50h-7a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z";
const KEYS: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
};

interface Particle { x: number; y: number; vx: number; vy: number; life: number; hue: number }

export interface SnakeGame { start(): void; stop(): void; readonly running: boolean }

export function mountSnake(canvas: HTMLCanvasElement): SnakeGame {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas 2d indisponível");
  const bubble = new Path2D(BUBBLE);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state: SnakeState = createSnake();
  let raf = 0;
  let running = false;
  let lastTick = 0;
  let t = 1;
  let w = 0, h = 0;
  let dpr = 1;
  let particles: Particle[] = [];
  /** Teclas de direção seguradas (código da tecla → quando desceu). Toque curto só vira; segurar vira turbo. */
  const held = new Map<string, number>();
  const HOLD_MS = 160;
  const BOOST = 0.5;
  let colors = { line: "#dfe3e8", accent: "#2f6fed", fg: "#1c1f23" };

  const readColors = (): void => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
    colors = { line: pick("--line", colors.line), accent: pick("--host-accent", "") || pick("--accent", colors.accent), fg: pick("--fg", colors.fg) };
  };
  const resize = (): void => {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    resizeBoard(state, Math.max(6, Math.round(w / CELL_PX)), Math.max(4, Math.round(h / CELL_PX)));
  };
  new ResizeObserver(resize).observe(canvas);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = (ev.target as HTMLElement | null)?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const dir = KEYS[ev.key] ?? KEYS[ev.key.toLowerCase()];
    if (dir === undefined) return;
    ev.preventDefault();
    if (ev.repeat) return; // o sistema repete a tecla segurada; o turbo vem de `held`, não de virar de novo
    held.set(ev.key.toLowerCase(), performance.now());
    turn(state, dir);
  };
  const onKeyUp = (ev: KeyboardEvent): void => { held.delete(ev.key.toLowerCase()); };
  const onBlur = (): void => { held.clear(); };
  const boosting = (now: number): boolean => { for (const t0 of held.values()) if (now - t0 >= HOLD_MS) return true; return false; };

  const burst = (x: number, y: number, hue: number): void => {
    if (reduced) return;
    const cx = w / state.cols, cy = h / state.rows;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.4;
      particles.push({ x: (x + 0.5) * cx, y: (y + 0.5) * cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue });
    }
  };

  const drawBubble = (cx: number, cy: number, side: number, hue: number, bob: number): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(side / 64, side / 64);
    ctx.translate(-32, -32 + bob);
    ctx.fillStyle = `hsl(${hue} 78% 62%)`;
    ctx.fill(bubble);
    ctx.fillStyle = "#0d1322";
    ctx.beginPath(); ctx.arc(24, 27, 4, 0, Math.PI * 2); ctx.arc(40, 27, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(26, 37, 12, 3.5, 1.75); ctx.fill();
    ctx.restore();
  };

  const draw = (now: number): void => {
    const { cols, rows } = state;
    const cw = w / cols, ch = h / rows, cell = Math.min(cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.line;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { ctx.beginPath(); ctx.arc((x + 0.5) * cw, (y + 0.5) * ch, Math.max(1, cell * 0.06), 0, Math.PI * 2); ctx.fill(); }

    if (state.food.x >= 0) {
      const bob = reduced ? 0 : Math.sin(now / 420) * 1.6;
      drawBubble((state.food.x + 0.5) * cw, (state.food.y + 0.5) * ch, cell * 1.15, state.food.hue, bob);
    }

    // Posições contínuas: o delta entre passo anterior e atual é "desembrulhado" (17→0 vira 17→18), então
    // a cabeça desliza pela borda; cada segmento é colado ao anterior pela menor distância no toro. A
    // cadeia pode sair do quadro: desenha-se de novo deslocada de ±lado nos eixos em que vazou.
    const wrapX = (d: number): number => (d > 1 ? d - cols : d < -1 ? d + cols : d);
    const wrapY = (d: number): number => (d > 1 ? d - rows : d < -1 ? d + rows : d);
    const pos = state.snake.map((c, j) => {
      const p = state.prev[j] ?? c;
      return { x: (p.x + wrapX(c.x - p.x) * t + 0.5) * cw, y: (p.y + wrapY(c.y - p.y) * t + 0.5) * ch };
    });
    for (let j = 1; j < pos.length; j++) {
      const a = pos[j - 1]!, b = pos[j]!;
      if (b.x - a.x > w / 2) b.x -= w; else if (a.x - b.x > w / 2) b.x += w;
      if (b.y - a.y > h / 2) b.y -= h; else if (a.y - b.y > h / 2) b.y += h;
    }
    const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
    const offX = [0, ...(Math.min(...xs) < cell ? [w] : []), ...(Math.max(...xs) > w - cell ? [-w] : [])];
    const offY = [0, ...(Math.min(...ys) < cell ? [h] : []), ...(Math.max(...ys) > h - cell ? [-h] : [])];
    const len = pos.length;
    const d = state.dir, px = -d.y, py = d.x, er = cell * 0.11;
    for (const ox of offX) for (const oy of offY) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = colors.accent;
      for (let j = len - 2; j >= 0; j--) {
        const a = pos[j]!, b = pos[j + 1]!;
        const f = j / Math.max(1, len - 1);
        ctx.globalAlpha = 1 - f * 0.55;
        ctx.lineWidth = cell * (0.74 - 0.3 * f);
        ctx.beginPath(); ctx.moveTo(b.x + ox, b.y + oy); ctx.lineTo(a.x + ox, a.y + oy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const hd = { x: pos[0]!.x + ox, y: pos[0]!.y + oy };
      ctx.fillStyle = colors.accent;
      ctx.beginPath(); ctx.arc(hd.x, hd.y, cell * 0.42, 0, Math.PI * 2); ctx.fill();
      for (const sgn of [-1, 1]) {
        const ex = hd.x + d.x * cell * 0.13 + px * sgn * cell * 0.17, ey = hd.y + d.y * cell * 0.13 + py * sgn * cell * 0.17;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0d1322"; ctx.beginPath(); ctx.arc(ex + d.x * er * 0.4, ey + d.y * er * 0.4, er * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life -= 0.03;
      ctx.fillStyle = `hsl(${p.hue} 78% 62% / ${Math.max(0, p.life).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, cell * 0.09 * p.life + 1, 0, Math.PI * 2); ctx.fill();
    }
  };

  const loop = (now: number): void => {
    if (!running) return;
    const ms = tickMs(state) * (boosting(now) ? BOOST : 1);
    let guard = 0;
    while (now - lastTick >= ms && guard++ < 3) {
      const { ate } = step(state);
      lastTick += ms;
      if (ate !== null) burst(ate.x, ate.y, ate.hue);
    }
    if (now - lastTick > ms * 3) lastTick = now;
    t = reduced ? 1 : Math.max(0, Math.min(1, (now - lastTick) / ms));
    draw(now);
    raf = requestAnimationFrame(loop);
  };

  return {
    get running() { return running; },
    start() {
      if (running) return;
      running = true;
      const r = canvas.getBoundingClientRect();
      state = createSnake(Math.max(6, Math.round(r.width / CELL_PX)), Math.max(4, Math.round(r.height / CELL_PX)));
      particles = [];
      readColors(); resize();
      lastTick = performance.now(); t = 1;
      held.clear();
      document.addEventListener("keydown", onKey);
      document.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      raf = requestAnimationFrame(loop);
    },
    stop() {
      if (!running) return;
      running = false;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
      cancelAnimationFrame(raf);
    },
  };
}
