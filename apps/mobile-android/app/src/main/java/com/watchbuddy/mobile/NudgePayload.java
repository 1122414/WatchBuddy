package com.watchbuddy.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;
import java.util.UUID;

final class NudgePayload {
    final String nudgeId;
    final String source;
    final String message;
    final String json;

    private NudgePayload(String nudgeId, String source, String message, String json) {
        this.nudgeId = nudgeId;
        this.source = source;
        this.message = message;
        this.json = json;
    }

    private NudgePayload() {
        throw new AssertionError("No instances");
    }

    static NudgePayload dailyRoutine(long now) {
        return create(
                now,
                "daily_routine",
                1,
                "watching",
                "早呀。今天想给自己留一点什么？",
                action("share", "跟你说说"),
                action("later", "晚点再说"),
                action("busy", "我先忙")
        );
    }

    static NudgePayload randomSocial(long now) {
        return create(
                now,
                "random_social",
                1,
                "curious",
                "刚刚哪一小段，让你有一点点在意？",
                action("share", "有一件事"),
                action("nothing", "没什么啦"),
                action("busy", "先别打扰")
        );
    }

    static NudgePayload relationshipFollowUp(long now) {
        return create(
                now,
                "relationship_follow_up",
                2,
                "chatting",
                "昨天那个汇报后来怎么样了？我还记着。",
                action("good", "挺顺利的"),
                action("hard", "一言难尽"),
                action("later", "晚点告诉你")
        );
    }

    static NudgePayload userState(long now, String activityState) {
        String message = "活动中".equals(activityState)
                ? "你刚才好像一直在动。现在还好吗？"
                : "你刚安静下来了吗？要不要缓一会儿？";
        return create(
                now,
                "user_state",
                2,
                "concerned",
                message,
                action("guess_right", "你猜对了"),
                action("guess_wrong", "猜错了"),
                action("busy", "先别打扰")
        );
    }

    private static NudgePayload create(
            long now,
            String source,
            int intensity,
            String characterState,
            String message,
            JSONObject... actions
    ) {
        try {
            String nudgeId = "nudge_" + UUID.randomUUID();
            JSONObject payload = new JSONObject();
            payload.put("schemaVersion", 1);
            payload.put("type", "COMPANION_NUDGE");
            payload.put("nudgeId", nudgeId);
            payload.put("source", source);
            payload.put("intensity", intensity);
            payload.put("characterState", characterState);
            payload.put("message", message);
            payload.put("haptic", "soft_single");
            payload.put("createdAt", now);
            payload.put("expiresAt", now + 15 * 60 * 1000L);
            payload.put("locale", Locale.getDefault().toLanguageTag());

            JSONArray actionArray = new JSONArray();
            for (JSONObject action : actions) {
                actionArray.put(action);
            }
            payload.put("actions", actionArray);
            return new NudgePayload(nudgeId, source, message, payload.toString());
        } catch (JSONException error) {
            throw new IllegalStateException("无法构建主动消息", error);
        }
    }

    private static JSONObject action(String id, String label) {
        try {
            JSONObject action = new JSONObject();
            action.put("id", id);
            action.put("label", label);
            return action;
        } catch (JSONException error) {
            throw new IllegalStateException("无法构建快捷回复", error);
        }
    }
}
