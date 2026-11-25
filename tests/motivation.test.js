const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardMessage, pushMessage } = require('../utils/motivation');

const noPlan = { percentage: null, earned: 0, possible: 0 };

test('dashboard check-in welcomes a fresh start without invoking streak pressure', () => {
  const message = dashboardMessage(noPlan, { streak: 12 }, new Date(2026, 0, 1, 9));
  assert.match(message, /No plan is okay/);
  assert.match(message, /small steps add up over time/);
  assert.doesNotMatch(message, /streak|risk|perfect|keep it alive/i);
});

test('dashboard check-in celebrates completed effort and makes more progress optional', () => {
  const message = dashboardMessage({
    percentage: 40,
    earned: 10,
    possible: 25,
    rating: 'Room to Adjust',
  });
  assert.match(message, /10 of 25 planned points earned/);
  assert.match(message, /real progress/);
  assert.match(message, /Small wins add up over time/);
  assert.match(message, /anything more is optional/i);
  assert.doesNotMatch(message, /points away|small push|keep it up/i);
});

test('a fully completed plan is celebrated without calling the day perfect', () => {
  const message = dashboardMessage({
    percentage: 100,
    earned: 30,
    possible: 30,
    rating: 'Excellent',
  });
  assert.match(message, /30\/30 planned points earned/);
  assert.match(message, /appreciate what you did/);
  assert.doesNotMatch(message, /perfect day|nothing left on the table|standard/i);
});

test('morning reminder invites a focus without tying it to a streak', () => {
  const message = pushMessage('morning', {
    summary: noPlan,
    streakStats: { streak: 12 },
    pendingAm: 2,
  });
  assert.match(message.body, /Choose what fits your energy/);
  assert.match(message.body, /every step counts/);
  assert.doesNotMatch(message.body, /streak|risk|keep it alive/i);
});

test('streak notification is a gentle choice, not a warning', () => {
  const message = pushMessage('streak', { summary: noPlan, streakStats: { streak: 12 } });
  assert.equal(message.title, 'Small Wins — gentle check-in');
  assert.match(message.body, /if it feels right|rest you need/i);
  assert.doesNotMatch(`${message.title} ${message.body}`, /at risk|on the line|save today|keep.*streak/i);
});

test('evening notification recognizes effort without asking users to catch up', () => {
  const message = pushMessage('evening', {
    summary: { percentage: 50, earned: 10, possible: 20, rating: 'Fair' },
  });
  assert.match(message.body, /What you did counts/);
  assert.match(message.body, /anything more is optional/);
  assert.doesNotMatch(message.body, /still time|points from|nothing logged/i);
});
