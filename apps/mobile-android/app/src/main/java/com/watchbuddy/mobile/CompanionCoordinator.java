package com.watchbuddy.mobile;

import java.util.HashMap;
import java.util.Map;

final class CompanionCoordinator {
    private static final int DAILY_BUDGET = 2;
    private static final long COOLDOWN_MS = 3 * 60 * 60 * 1000L;
    private static final long ACTIVITY_FRESHNESS_MS = 15 * 60 * 1000L;

    private final CompanionStore store;
    private final WearEngineGateway gateway;
    private final Map<String, NudgePayload> sentNudges = new HashMap<>();

    CompanionCoordinator(CompanionStore store, WearEngineGateway gateway) {
        this.store = store;
        this.gateway = gateway;
    }

    Decision sendDailyRoutine() {
        return evaluateAndSend(NudgePayload.dailyRoutine(System.currentTimeMillis()));
    }

    Decision sendRandomSocial() {
        return evaluateAndSend(NudgePayload.randomSocial(System.currentTimeMillis()));
    }

    Decision sendRelationshipFollowUp() {
        return evaluateAndSend(NudgePayload.relationshipFollowUp(System.currentTimeMillis()));
    }

    Decision sendUserState() {
        long now = System.currentTimeMillis();
        CompanionStore.ActivitySnapshot activity = store.activitySnapshot();
        if (activity.sampledAt == 0 || now - activity.sampledAt > ACTIVITY_FRESHNESS_MS) {
            return Decision.blocked("需要先完成一次 10 秒活动采样");
        }
        if (!"活动中".equals(activity.state) && !"相对静止".equals(activity.state)) {
            return Decision.blocked("最近一次活动采样无有效结论");
        }
        if (activity.wrongGuessCount >= 2) {
            return Decision.blocked("状态猜测已连续失准，规则已降权停用");
        }
        return evaluateAndSend(NudgePayload.userState(now, activity.state));
    }

    void sendTransportDemo() {
        NudgePayload nudge = NudgePayload.relationshipFollowUp(System.currentTimeMillis());
        sentNudges.put(nudge.nudgeId, nudge);
        gateway.send(nudge.json);
    }

    boolean onResponse(String nudgeId, String actionId) {
        if (!sentNudges.containsKey(nudgeId)) {
            return false;
        }
        store.rememberResponse(nudgeId, actionId, System.currentTimeMillis());
        sentNudges.remove(nudgeId);
        return true;
    }

    private Decision evaluateAndSend(NudgePayload nudge) {
        long now = System.currentTimeMillis();
        if (!gateway.hasSelectedDevice()) {
            return Decision.blocked("尚未选择 GT 6 Pro");
        }
        if (store.isQuietMode()) {
            return Decision.blocked("安静模式已开启");
        }

        CompanionStore.InitiativeSnapshot state = store.initiativeSnapshot();
        if (state.blockedUntil > now) {
            return Decision.blocked("用户反馈需要空间，仍在冷却中");
        }
        if (state.sentCount >= DAILY_BUDGET) {
            return Decision.blocked("已达到今日 2 次主动预算");
        }
        if (state.lastNudgeAt > 0 && now - state.lastNudgeAt < COOLDOWN_MS) {
            return Decision.blocked("距离上次主动消息不足 3 小时");
        }

        sentNudges.put(nudge.nudgeId, nudge);
        gateway.send(nudge.json);
        store.recordSent(now);
        return Decision.sent("有今日预算 · 当前未开启安静模式 · " + sourceReason(nudge.source));
    }

    private String sourceReason(String source) {
        if ("relationship_follow_up".equals(source)) {
            return "跟进未完成事件";
        }
        if ("daily_routine".equals(source)) {
            return "处于日常互动窗口";
        }
        if ("user_state".equals(source)) {
            return "最近 15 分钟有真实活动采样";
        }
        return "随机社交候选通过策略";
    }

    static final class Decision {
        final boolean sent;
        final String reason;

        private Decision(boolean sent, String reason) {
            this.sent = sent;
            this.reason = reason;
        }

        static Decision sent(String reason) {
            return new Decision(true, reason);
        }

        static Decision blocked(String reason) {
            return new Decision(false, reason);
        }
    }
}
