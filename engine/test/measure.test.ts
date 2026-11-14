/** SCR-110: the resource measurement's arithmetic (scripts/measure.ts). The watching itself needs a running app. */
import { expect, test } from 'bun:test';
import { bytes, cpuPercents, parseCpuTime, peak, percentile, perHour, report } from '../../scripts/measure.ts';

test('cumulative CPU time in every form ps prints', () => {
  expect(parseCpuTime('0:01.50')).toBeCloseTo(1.5);
  expect(parseCpuTime('12:34.56')).toBeCloseTo(754.56);
  expect(parseCpuTime('1:02:03.45')).toBeCloseTo(3723.45);
  expect(parseCpuTime('1-02:03:04')).toBe(93_784);
  expect(parseCpuTime('x')).toBeNaN();
});

test('CPU per interval from cumulative time; a restarted process (time going back) is skipped', () => {
  expect(cpuPercents([{ wall: 0, cpu: 10 }, { wall: 5, cpu: 10.5 }, { wall: 10, cpu: 11.5 }])).toEqual([10, 20]);
  expect(cpuPercents([{ wall: 0, cpu: 10 }, { wall: 5, cpu: 0.2 }, { wall: 10, cpu: 0.7 }])).toEqual([10]);
});

test('median, p95, peak and growth an hour', () => {
  const v = Array.from({ length: 20 }, (_, i) => i + 1);
  expect(percentile(v, 50)).toBe(10);
  expect(percentile(v, 95)).toBe(19);
  expect(percentile([NaN], 50)).toBeNaN();
  expect(peak([3, NaN, 7])).toBe(7);
  expect(peak([])).toBeNaN();
  expect(perHour(1000, 2000, 10)).toBe(6000);
  expect(bytes(1536)).toBe('1.5 KB');
  expect(bytes(-2 * 1024 ** 2)).toBe('−2.0 MB');
});

test('the report names the machine and the period, and every column', () => {
  const md = report({
    minutes: 10, machine: 'Apple M1, 16 GB, macOS 26.1',
    app: { cpu: [1, 2, 3], power: [0.5, 1], rssKb: [100_000, 120_000] },
    engine: { cpu: [0.1], power: [0], rssKb: [50_000] },
    db: { start: 1_000_000, end: 1_100_000 }, logs: { start: 0, end: 0 },
  });
  expect(md).toContain('Measured for 10 min on Apple M1, 16 GB, macOS 26.1.');
  expect(md).toContain('| App (capture, Quick View, model judge) | 2.0% | 3.0% | 0.5 | 1.0 | 97.7 MB | 117.2 MB |');
  expect(md).toContain('growing 585.9 KB an hour');
});
