/**
 * Cobrinha da tela vazia: quando a última aba fecha, o painel vira um descanso com uma cobrinha que
 * atravessa as paredes (sai de um lado, volta pelo outro) e nunca morre — passa pelo próprio rabo. A
 * comida são as bolhas-mascote (as mesmas do Novo), uma cor de cada vez, na ordem de MASCOT_HUES.
 * Puro: só regras e estado; o desenho e o teclado ficam em renderer/snake.ts. Testável com node --test.
 */
import { MASCOT_HUES } from "./intro-mascots.js";

export interface Cell { x: number; y: number }
export interface Dir { x: number; y: number }
export interface Food extends Cell { hue: number }

export interface SnakeState {
  /** Tabuleiro em células: o painel inteiro do app, então a proporção acompanha a janela. */
  cols: number;
  rows: number;
  snake: Cell[];
  /** Posição anterior de cada segmento, para interpolar o desenho entre passos. */
  prev: Cell[];
  dir: Dir;
  /** Viradas pendentes (até 3), para uma sequência rápida de teclas não perder nenhuma. */
  queue: Dir[];
  food: Food;
  /** Bolhas comidas. */
  score: number;
  /** A cobrinha para de crescer aqui; depois só a pontuação sobe (cabe no tabuleiro e continua calma). */
  maxLen: number;
  hueIndex: number;
}

export const SNAKE_HUES = MASCOT_HUES;

export function createSnake(cols = 18, rows = cols, rand: () => number = Math.random, maxLen = 24): SnakeState {
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const snake = [{ x: cx, y: cy }, { x: (cx - 1 + cols) % cols, y: cy }, { x: (cx - 2 + cols) % cols, y: cy }];
  const state: SnakeState = { cols, rows, snake, prev: snake.map((c) => ({ ...c })), dir: { x: 1, y: 0 }, queue: [], food: { x: -1, y: -1, hue: 0 }, score: 0, maxLen, hueIndex: 0 };
  state.food = placeFood(state, rand);
  return state;
}

/** Comida numa célula livre, com a próxima cor da roda de mascotes (nunca repete a anterior). */
export function placeFood(state: SnakeState, rand: () => number = Math.random): Food {
  const taken = new Set(state.snake.map((c) => c.y * state.cols + c.x));
  const free: Cell[] = [];
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) if (!taken.has(y * state.cols + x)) free.push({ x, y });
  const hue = SNAKE_HUES[state.hueIndex % SNAKE_HUES.length]!;
  state.hueIndex += 1;
  const cell = free.length === 0 ? { x: -1, y: -1 } : free[Math.min(free.length - 1, Math.floor(rand() * free.length))]!;
  return { ...cell, hue };
}

/** Enfileira uma virada; ignora a mesma direção e a oposta (voltar por cima de si). */
export function turn(state: SnakeState, dir: Dir): void {
  const last = state.queue.length > 0 ? state.queue[state.queue.length - 1]! : state.dir;
  if ((last.x === -dir.x && last.y === -dir.y) || (last.x === dir.x && last.y === dir.y)) return;
  if (state.queue.length < 3) state.queue.push(dir);
}

/** Um passo: anda, atravessa a borda, come se chegou na bolha. Nunca termina. */
export function step(state: SnakeState, rand: () => number = Math.random): { ate: Food | null } {
  const next = state.queue.shift();
  if (next !== undefined) state.dir = next;
  const head = state.snake[0]!;
  const nx = (head.x + state.dir.x + state.cols) % state.cols;
  const ny = (head.y + state.dir.y + state.rows) % state.rows;
  const ate = nx === state.food.x && ny === state.food.y;
  const grow = ate && state.snake.length < state.maxLen;
  const old = state.snake;
  const snake = [{ x: nx, y: ny }, ...old];
  if (!grow) snake.pop();
  state.prev = snake.map((_, j) => ({ ...old[Math.min(j, old.length - 1)]! }));
  state.snake = snake;
  if (!ate) return { ate: null };
  const eaten = state.food;
  state.score += 1;
  state.food = placeFood(state, rand);
  return { ate: eaten };
}

/** Ritmo: cada bolha comida acelera 7%, de 170 ms por passo até 55 ms (uns 15 passos por segundo). */
export function tickMs(state: SnakeState, base = 170, min = 55): number {
  return Math.max(min, base * Math.pow(0.93, state.score));
}

/** A janela mudou: o tabuleiro ganha/perde células; o que ficaria fora é dobrado para dentro. */
export function resizeBoard(state: SnakeState, cols: number, rows: number, rand: () => number = Math.random): void {
  if (cols === state.cols && rows === state.rows) return;
  state.cols = cols; state.rows = rows;
  const fold = (c: Cell): Cell => ({ x: ((c.x % cols) + cols) % cols, y: ((c.y % rows) + rows) % rows });
  state.snake = state.snake.map(fold);
  state.prev = state.snake.map((c) => ({ ...c }));
  if (state.food.x >= cols || state.food.y >= rows) { state.hueIndex -= 1; state.food = placeFood(state, rand); }
}
