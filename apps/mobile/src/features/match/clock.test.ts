import { DisplayClock } from './clock';
const id = '00000000-0000-4000-8000-000000000001';
let mono: number;
let wall: number;
let clock: DisplayClock;
beforeEach(() => {
  mono = 100;
  wall = 1000;
  clock = new DisplayClock(
    () => mono,
    () => wall,
  );
});
test('estimates server time with processing removed and monotonic display progression', () => {
  clock.start(id);
  mono += 120;
  wall += 120;
  expect(
    clock.receive({
      requestId: id,
      serverReceivedAt: 2000,
      serverSentAt: 2020,
    }),
  ).toBe(true);
  expect(clock.now()).toBe(2070);
  wall = -5000;
  mono += 30;
  expect(clock.now()).toBe(2100);
  expect(clock.remaining(2080)).toBe(0);
});
test('ignores unsolicited, duplicated and wall-jump samples', () => {
  const pong = { requestId: id, serverReceivedAt: 2000, serverSentAt: 2020 };
  expect(clock.receive(pong)).toBe(false);
  clock.start(id);
  mono += 120;
  wall += 1000;
  expect(clock.receive(pong)).toBe(false);
  expect(clock.receive(pong)).toBe(false);
  expect(clock.now()).toBeNull();
});
test('uses lower RTT estimates, expires them after ten seconds and requires a new sample after resume', () => {
  clock.start(id);
  mono += 100;
  wall += 100;
  expect(
    clock.receive({
      requestId: id,
      serverReceivedAt: 2000,
      serverSentAt: 2000,
    }),
  ).toBe(true);
  clock.start(id);
  mono += 500;
  wall += 500;
  clock.receive({
    requestId: id,
    serverReceivedAt: 10000,
    serverSentAt: 10000,
  });
  expect(clock.now()).toBe(2550);
  mono += 10_001;
  expect(clock.now()).toBeNull();
  clock.start(id);
  clock.invalidate();
  expect(
    clock.receive({
      requestId: id,
      serverReceivedAt: 2000,
      serverSentAt: 2000,
    }),
  ).toBe(false);
});
test('keeps a newer qualifying sample when the lowest RTT sample expires', () => {
  clock.start(id);
  mono += 20;
  wall += 20;
  clock.receive({
    requestId: id,
    serverReceivedAt: 2000,
    serverSentAt: 2000,
  });
  const newerId = '00000000-0000-4000-8000-000000000002';
  mono += 9000;
  wall += 9000;
  clock.start(newerId);
  mono += 100;
  wall += 100;
  clock.receive({
    requestId: newerId,
    serverReceivedAt: 11100,
    serverSentAt: 11100,
  });
  expect(clock.quality()?.uncertaintyMs).toBe(10);
  mono += 901;
  expect(clock.quality()).toMatchObject({ uncertaintyMs: 50 });
});
test('rejects a sample after a wall-clock discontinuity without dropping prior good samples', () => {
  clock.start(id);
  mono += 20;
  wall += 20;
  clock.receive({
    requestId: id,
    serverReceivedAt: 2000,
    serverSentAt: 2000,
  });
  const next = '00000000-0000-4000-8000-000000000002';
  clock.start(next);
  mono += 20;
  wall += 1000;
  expect(
    clock.receive({
      requestId: next,
      serverReceivedAt: 3000,
      serverSentAt: 3000,
    }),
  ).toBe(false);
  expect(clock.now()).not.toBeNull();
});
test('rejects processing longer than observed round trip and backwards monotonic time', () => {
  clock.start(id);
  mono += 10;
  wall += 10;
  expect(
    clock.receive({
      requestId: id,
      serverReceivedAt: 2000,
      serverSentAt: 2020,
    }),
  ).toBe(false);
  clock.start(id);
  mono -= 10;
  wall -= 10;
  expect(
    clock.receive({
      requestId: id,
      serverReceivedAt: 2000,
      serverSentAt: 2000,
    }),
  ).toBe(false);
});
