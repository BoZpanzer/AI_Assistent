'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Notifications } = require('../src/main/services/notifications');
test('same title creates inbox entries but only one toast during cooldown', () => {
  let toasts = 0, inserted = 0;
  const db = { run: () => { inserted++; } };
  const settings = { get: key => ({ notifications: true, notifyCategories: {}, notificationCooldownMinutes: 10, quietHours: { enabled: false } })[key] };
  const n = new Notifications({ db, settings, bus: { emit() {} }, platform: { toast: () => { toasts++; } } });
  n.push({ category: 'tasks', title: 'Prüfung morgen' });
  n.push({ category: 'tasks', title: 'Prüfung morgen' });
  assert.equal(inserted, 2);
  assert.equal(toasts, 1);
});
test('cooldown zero allows repeated popups', () => {
  let toasts = 0;
  const n = new Notifications({ db: { run() {} }, settings: { get: key => ({ notifications: true, notificationCooldownMinutes: 0 })[key] }, bus: { emit() {} }, platform: { toast: () => toasts++ } });
  n.push({ title: 'Test' }); n.push({ title: 'Test' });
  assert.equal(toasts, 2);
});
