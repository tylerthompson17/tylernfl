import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldDescription, fieldGoalKick, fieldStripHtml, spotWords } from '../src/lib/field/strip.ts';

test('spots from the offense side', () => {
  assert.equal(spotWords(56), 'own 44');
  assert.equal(spotWords(34), "the opponent's 34");
  assert.equal(spotWords(50), 'midfield');
});

test('field goal only within the longest kick', () => {
  // Labelled the conventional way (plus 17); available by the model's rule (plus 18, at most 70).
  assert.equal(fieldGoalKick(34, 18, 70), 51);
  assert.equal(fieldGoalKick(52, 18, 70), 69);
  assert.equal(fieldGoalKick(53, 18, 70), null);
  assert.equal(fieldGoalKick(56, 18, 70), null);
});

test('descriptions say the whole situation', () => {
  assert.equal(
    fieldDescription({ yardline100: 34, distance: 7, kick: 52, label: "4th and 7 at the opponent's 34" }),
    "4th and 7 at the opponent's 34. Driving left to right toward the opponent's end zone, ball on the opponent's 34, line to gain the opponent's 27. A field goal would be a 52-yard attempt.",
  );
  assert.match(fieldDescription({ yardline100: 3, distance: 3, kick: 21, label: '4th and goal' }), /line to gain the goal line/);
  assert.doesNotMatch(fieldDescription({ yardline100: 56, distance: 1, kick: null, label: '4th and 1' }), /field goal/);
});

test('markup: 19 yard lines, 9 numbers reading 10 to 50 to 10, the kick bracket only with a kick', () => {
  const html = fieldStripHtml({ yardline100: 34, distance: 7, kick: 52, label: '4th & <7>' });
  assert.equal(html.match(/class="fs-line/g)?.length, 19);
  assert.deepEqual([...html.matchAll(/class="fs-num[^"]*"[^>]*>(\d+)</g)].map((m) => Number(m[1])), [10, 20, 30, 40, 50, 40, 30, 20, 10]);
  assert.match(html, /52-yard attempt/);
  assert.match(html, /4th &amp; &lt;7&gt;/);
  assert.doesNotMatch(fieldStripHtml({ yardline100: 56, distance: 1, kick: null, label: 'x' }), /attempt/);
  // Goal to go: the line to gain is the goal line, at the right end zone's edge.
  assert.match(fieldStripHtml({ yardline100: 3, distance: 3, kick: 21, label: 'x' }), /fs-gain" style="left:91.67%/);
});
