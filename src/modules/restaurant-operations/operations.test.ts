import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WORKING_DAYS, prepSchema, statusSchema, workingHoursSchema } from './service.js';

test('status body is a strict boolean set; identity fields are rejected', () => {
  assert.ok(statusSchema.safeParse({ isPaused: true }).success);
  for (const bad of [{}, { isPaused: 'true' }, { isPaused: 1 }, { isPaused: true, restaurantId: 'r1' }]) {
    assert.equal(statusSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('default prep minutes is an integer between 5 and 120', () => {
  assert.ok(prepSchema.safeParse({ defaultPrepMinutes: 25 }).success);
  for (const v of [4, 121, 12.5, '25', null]) assert.equal(prepSchema.safeParse({ defaultPrepMinutes: v }).success, false, String(v));
});

test('working hours: seven distinct weekdays, HH:MM, close after open', () => {
  const days = DEFAULT_WORKING_DAYS;
  const withDay = (i: number, patch: object) => ({ days: days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  assert.ok(workingHoursSchema.safeParse({ days }).success);
  assert.equal(workingHoursSchema.safeParse({ days: days.slice(0, 6) }).success, false);
  assert.equal(workingHoursSchema.safeParse({ days: [...days.slice(0, 6), { ...days[0]! }] }).success, false); // duplicate Monday
  assert.equal(workingHoursSchema.safeParse(withDay(2, { openTime: '9:00' })).success, false);
  assert.equal(workingHoursSchema.safeParse(withDay(2, { closeTime: '24:00' })).success, false);
  assert.equal(workingHoursSchema.safeParse(withDay(2, { openTime: '22:00', closeTime: '09:00' })).success, false);
  // a closed day may carry any valid times
  assert.ok(workingHoursSchema.safeParse(withDay(2, { isOpen: false, openTime: '22:00', closeTime: '09:00' })).success);
  assert.equal(workingHoursSchema.safeParse({ days, restaurantId: 'r1' }).success, false);
});
