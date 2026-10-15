/**
 * goal-round-driver：活跃目标下在工具轮结束后自动续发，推动多轮直至完成或达上限。
 */

export const DEFAULT_GOAL_DRIVER_MAX_ROUNDS = 3;

export const GOAL_DRIVER_CONTINUE_PREFIX = '[goal-round-driver]';

export function goalDriverContinueText(goalText: string, round: number, maxRounds: number): string {
  const g = goalText.trim().slice(0, 200);
  return (
    `${GOAL_DRIVER_CONTINUE_PREFIX} 续轮 ${round}/${maxRounds}：请继续推进目标「${g}」。` +
    '若已完成请调用 goal_done；若阻塞请说明原因或 ask_user_question，勿空转重复相同工具。'
  );
}

export function isGoalDriverMessage(content: string): boolean {
  return content.trimStart().startsWith(GOAL_DRIVER_CONTINUE_PREFIX);
}

export interface ShouldDriveGoalRoundInput {
  goalActive: boolean;
  turnOk: boolean;
  aborted: boolean;
  hasFollowUp: boolean;
  askUserPending: boolean;
  /** 本驱动周期内已续轮次数（不含用户首轮） */
  roundsUsed: number;
  maxRounds?: number;
}

/** 是否应再发起一轮 goal-round-driver 续发 */
export function shouldDriveGoalRound(input: ShouldDriveGoalRoundInput): boolean {
  const max = Math.max(1, Math.floor(input.maxRounds ?? DEFAULT_GOAL_DRIVER_MAX_ROUNDS));
  if (!input.goalActive) return false;
  if (!input.turnOk) return false;
  if (input.aborted) return false;
  if (input.hasFollowUp) return false;
  if (input.askUserPending) return false;
  if (input.roundsUsed >= max) return false;
  return true;
}
