import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GOAL_DRIVER_CONTINUE_PREFIX,
  goalDriverContinueText,
  isGoalDriverMessage,
  shouldDriveGoalRound,
} from './session-goal-driver';

describe('session-goal-driver', () => {
  it('detects driver messages', () => {
    assert.equal(isGoalDriverMessage(`${GOAL_DRIVER_CONTINUE_PREFIX} x`), true);
    assert.equal(isGoalDriverMessage('普通用户消息'), false);
  });

  it('builds continue text with round counters', () => {
    const t = goalDriverContinueText('写测试', 2, 3);
    assert.match(t, /续轮 2\/3/);
    assert.match(t, /写测试/);
    assert.ok(isGoalDriverMessage(t));
  });

  it('shouldDriveGoalRound gates correctly', () => {
    const base = {
      goalActive: true,
      turnOk: true,
      aborted: false,
      hasFollowUp: false,
      askUserPending: false,
      roundsUsed: 0,
      maxRounds: 3,
    };
    assert.equal(shouldDriveGoalRound(base), true);
    assert.equal(shouldDriveGoalRound({ ...base, goalActive: false }), false);
    assert.equal(shouldDriveGoalRound({ ...base, turnOk: false }), false);
    assert.equal(shouldDriveGoalRound({ ...base, aborted: true }), false);
    assert.equal(shouldDriveGoalRound({ ...base, hasFollowUp: true }), false);
    assert.equal(shouldDriveGoalRound({ ...base, askUserPending: true }), false);
    assert.equal(shouldDriveGoalRound({ ...base, roundsUsed: 3 }), false);
    assert.equal(shouldDriveGoalRound({ ...base, roundsUsed: 2 }), true);
  });
});
