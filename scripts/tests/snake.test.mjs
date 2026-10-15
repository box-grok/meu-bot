import assert from "node:assert/strict";
import { test } from "node:test";
import { SNAKE_HUES, createSnake, placeFood, resizeBoard, step, tickMs, turn } from "../../dist/renderer/lib/snake.js";

const zero = () => 0;

test("atravessa as quatro bordas de um tabuleiro retangular e volta pelo lado oposto, sem morrer", () => {
  const s = createSnake(8, 5, zero, 10);
  s.food = { x: -1, y: -1, hue: 0 };
  for (let i = 0; i < 8; i++) step(s, zero);
  assert.deepEqual(s.snake[0], { x: 4, y: 2 });
  turn(s, { x: 0, y: -1 });
  for (let i = 0; i < 5; i++) step(s, zero);
  assert.deepEqual(s.snake[0], { x: 4, y: 2 });
  assert.equal(s.snake.length, 3);
});

test("passar pelo próprio rabo não termina nada", () => {
  const s = createSnake(8, 8, zero, 30);
  s.food = { x: -1, y: -1, hue: 0 };
  s.snake = [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }];
  s.dir = { x: 0, y: 1 }; // desce para (4,5)
  step(s, zero);
  turn(s, { x: 1, y: 0 }); // vai para (5,5), ocupada pelo rabo
  step(s, zero);
  assert.deepEqual(s.snake[0], { x: 5, y: 5 });
  assert.equal(s.snake.length, 7);
});

test("come a bolha, cresce até o limite e as cores seguem a roda dos mascotes", () => {
  const s = createSnake(6, 6, zero, 4);
  assert.equal(s.food.hue, SNAKE_HUES[0]);
  s.food = { x: 4, y: 3, hue: s.food.hue };
  const r = step(s, zero);
  assert.equal(r.ate?.hue, SNAKE_HUES[0]);
  assert.equal(s.score, 1);
  assert.equal(s.snake.length, 4);
  assert.equal(s.food.hue, SNAKE_HUES[1]);
  s.food = { x: 5, y: 3, hue: s.food.hue };
  step(s, zero);
  assert.equal(s.score, 2);
  assert.equal(s.snake.length, 4, "no limite só a pontuação sobe");
  const hues = [];
  for (let i = 0; i < SNAKE_HUES.length; i++) hues.push(placeFood(s, zero).hue);
  assert.deepEqual(hues, [...SNAKE_HUES.slice(3), ...SNAKE_HUES.slice(0, 3)]); // criar + 2 comidas = 3 cores já usadas
});

test("a comida nunca nasce em cima da cobrinha", () => {
  const s = createSnake(4, 4, zero, 20);
  s.snake = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (!(x === 3 && y === 3)) s.snake.push({ x, y });
  const f = placeFood(s, () => 0.99);
  assert.deepEqual([f.x, f.y], [3, 3]);
  s.snake.push({ x: 3, y: 3 });
  assert.deepEqual([placeFood(s, zero).x, placeFood(s, zero).y].map(String), ["-1", "-1"].map(String));
});

test("virar: ignora a mesma direção e a oposta; guarda até três viradas", () => {
  const s = createSnake(10, 10, zero);
  turn(s, { x: 1, y: 0 });
  turn(s, { x: -1, y: 0 });
  assert.equal(s.queue.length, 0);
  turn(s, { x: 0, y: 1 }); turn(s, { x: 1, y: 0 }); turn(s, { x: 0, y: -1 }); turn(s, { x: -1, y: 0 });
  assert.equal(s.queue.length, 3);
  assert.deepEqual(s.queue[0], { x: 0, y: 1 });
});

test("ritmo: cada bolha acelera, até o mínimo", () => {
  const s = createSnake(10, 10, zero);
  assert.equal(tickMs(s), 170);
  s.score = 1;
  assert.ok(tickMs(s) < 170 && tickMs(s) > 155);
  s.score = 5;
  assert.ok(tickMs(s) < 125);
  s.score = 100;
  assert.equal(tickMs(s), 55);
});

test("redimensionar dobra o que ficaria fora e repõe a comida se preciso", () => {
  const s = createSnake(10, 10, zero, 20);
  s.snake = [{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }];
  s.food = { x: 9, y: 0, hue: s.food.hue };
  resizeBoard(s, 6, 4, zero);
  assert.deepEqual(s.snake, [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }]);
  assert.ok(s.food.x < 6 && s.food.y < 4);
  assert.equal(s.food.hue, SNAKE_HUES[0], "repor não gasta uma cor da roda");
});
