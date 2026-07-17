const HOUR = 60 * 60 * 1000;

export const DEFAULT_POLICY = Object.freeze({
  dailyActiveBudget: 2,
  cooldownAfterNudgeMs: 3 * HOUR,
  cooldownAfterIgnoreMs: 5 * HOUR,
  cooldownAfterBusyMs: 6 * HOUR,
  cooldownAfterWrongGuessMs: 4 * HOUR
});

export function createInitiativeState(overrides = {}) {
  return {
    localDate: overrides.localDate ?? null,
    sentCount: overrides.sentCount ?? 0,
    lastNudgeAt: overrides.lastNudgeAt ?? null,
    blockedUntil: overrides.blockedUntil ?? null,
    recentTopics: [...(overrides.recentTopics ?? [])]
  };
}

export function decideInitiative({
  candidate,
  context,
  initiativeState,
  now,
  localDate,
  policy = DEFAULT_POLICY
}) {
  const state = resetBudgetIfNeeded(initiativeState, localDate);
  const reasons = [];

  if (context.quietMode) {
    return blocked("quiet_mode", state);
  }
  if (context.userRequestedSpace) {
    return blocked("user_requested_space", state);
  }
  if (context.sleeping) {
    return blocked("sleeping", state);
  }
  if (state.blockedUntil && now < state.blockedUntil) {
    return blocked("cooldown", state);
  }
  if (state.sentCount >= policy.dailyActiveBudget) {
    return blocked("daily_budget", state);
  }
  if (state.lastNudgeAt && now - state.lastNudgeAt < policy.cooldownAfterNudgeMs) {
    return blocked("cooldown", state);
  }
  if (!context.interruptible) {
    return blocked("not_interruptible", state);
  }
  if (candidate.topic && state.recentTopics.includes(candidate.topic)) {
    return blocked("repeated_topic", state);
  }

  if (candidate.source === "relationship_follow_up") {
    reasons.push("未完成事件已到跟进时间");
  } else if (candidate.source === "daily_routine") {
    reasons.push("处于日常互动窗口");
  } else {
    reasons.push("候选通过主动策略");
  }
  reasons.push("当前可被打扰");
  reasons.push("仍有当日主动预算");

  return {
    decision: "send",
    blockedBy: null,
    reasons,
    state
  };
}

export function recordSent(state, candidate, now, localDate) {
  const current = resetBudgetIfNeeded(state, localDate);
  const recentTopics = candidate.topic
    ? [candidate.topic, ...current.recentTopics.filter((topic) => topic !== candidate.topic)].slice(0, 8)
    : current.recentTopics;

  return {
    ...current,
    sentCount: current.sentCount + 1,
    lastNudgeAt: now,
    recentTopics
  };
}

export function recordOutcome(state, outcome, now, policy = DEFAULT_POLICY) {
  const cooldowns = {
    ignored: policy.cooldownAfterIgnoreMs,
    busy: policy.cooldownAfterBusyMs,
    wrong_guess: policy.cooldownAfterWrongGuessMs
  };
  const cooldown = cooldowns[outcome];

  if (!cooldown) {
    return state;
  }
  return { ...state, blockedUntil: now + cooldown };
}

function resetBudgetIfNeeded(state, localDate) {
  if (state.localDate === localDate) {
    return state;
  }
  return {
    ...state,
    localDate,
    sentCount: 0,
    recentTopics: []
  };
}

function blocked(reason, state) {
  return {
    decision: "block",
    blockedBy: reason,
    reasons: [],
    state
  };
}
