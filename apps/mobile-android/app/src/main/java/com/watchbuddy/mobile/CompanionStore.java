package com.watchbuddy.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class CompanionStore {
    private static final String PREFS_NAME = "watchbuddy_companion";
    private static final String KEY_QUIET_MODE = "quiet_mode";
    private static final String KEY_BUDGET_DATE = "budget_date";
    private static final String KEY_SENT_COUNT = "sent_count";
    private static final String KEY_LAST_NUDGE_AT = "last_nudge_at";
    private static final String KEY_BLOCKED_UNTIL = "blocked_until";
    private static final String KEY_MEMORIES = "memories";
    private static final String KEY_ACTIVITY_STATE = "activity_state";
    private static final String KEY_ACTIVITY_DETAIL = "activity_detail";
    private static final String KEY_ACTIVITY_AT = "activity_at";
    private static final String KEY_WRONG_GUESS_COUNT = "wrong_guess_count";
    private static final int MAX_MEMORIES = 50;

    private final SharedPreferences preferences;

    CompanionStore(Context context) {
        preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    boolean isQuietMode() {
        return preferences.getBoolean(KEY_QUIET_MODE, false);
    }

    void setQuietMode(boolean enabled) {
        preferences.edit().putBoolean(KEY_QUIET_MODE, enabled).apply();
    }

    InitiativeSnapshot initiativeSnapshot() {
        String today = LocalDate.now().toString();
        String storedDate = preferences.getString(KEY_BUDGET_DATE, "");
        if (!today.equals(storedDate)) {
            preferences.edit()
                    .putString(KEY_BUDGET_DATE, today)
                    .putInt(KEY_SENT_COUNT, 0)
                    .remove(KEY_LAST_NUDGE_AT)
                    .remove(KEY_BLOCKED_UNTIL)
                    .apply();
        }
        return new InitiativeSnapshot(
                preferences.getInt(KEY_SENT_COUNT, 0),
                preferences.getLong(KEY_LAST_NUDGE_AT, 0L),
                preferences.getLong(KEY_BLOCKED_UNTIL, 0L)
        );
    }

    void recordSent(long now) {
        InitiativeSnapshot snapshot = initiativeSnapshot();
        preferences.edit()
                .putInt(KEY_SENT_COUNT, snapshot.sentCount + 1)
                .putLong(KEY_LAST_NUDGE_AT, now)
                .apply();
    }

    void recordOutcome(String actionId, long now) {
        if ("guess_right".equals(actionId)) {
            preferences.edit().putInt(KEY_WRONG_GUESS_COUNT, 0).apply();
            return;
        }
        long cooldown;
        if ("busy".equals(actionId)) {
            cooldown = 6 * 60 * 60 * 1000L;
        } else if ("nothing".equals(actionId) || "guess_wrong".equals(actionId)) {
            cooldown = 4 * 60 * 60 * 1000L;
        } else {
            return;
        }
        SharedPreferences.Editor editor = preferences.edit()
                .putLong(KEY_BLOCKED_UNTIL, now + cooldown);
        if ("guess_wrong".equals(actionId)) {
            editor.putInt(
                    KEY_WRONG_GUESS_COUNT,
                    preferences.getInt(KEY_WRONG_GUESS_COUNT, 0) + 1
            );
        }
        editor.apply();
    }

    void rememberResponse(String nudgeId, String actionId, long now) {
        String type;
        String summary;
        if ("later".equals(actionId)) {
            type = "unfinished_topic";
            summary = "有一件事想晚点再告诉 WatchBuddy";
        } else if ("good".equals(actionId)) {
            type = "event";
            summary = "昨天的汇报进展顺利";
        } else if ("hard".equals(actionId)) {
            type = "event";
            summary = "昨天的汇报过程不太顺利";
        } else if ("busy".equals(actionId)) {
            type = "preference";
            summary = "当前更希望少被打扰";
        } else if ("guess_right".equals(actionId)) {
            type = "preference";
            summary = "活动状态关心的判断基本准确";
        } else if ("guess_wrong".equals(actionId)) {
            type = "preference";
            summary = "活动状态关心判断错误，需要降低使用频率";
        } else {
            type = "event";
            summary = "回应了 WatchBuddy 的一次关心";
        }
        saveMemory(type, summary, "normal", nudgeId, now);
        recordOutcome(actionId, now);
    }

    void recordActivityState(String state, String detail, long now) {
        preferences.edit()
                .putString(KEY_ACTIVITY_STATE, state)
                .putString(KEY_ACTIVITY_DETAIL, detail)
                .putLong(KEY_ACTIVITY_AT, now)
                .apply();
    }

    ActivitySnapshot activitySnapshot() {
        return new ActivitySnapshot(
                preferences.getString(KEY_ACTIVITY_STATE, ""),
                preferences.getString(KEY_ACTIVITY_DETAIL, ""),
                preferences.getLong(KEY_ACTIVITY_AT, 0L),
                preferences.getInt(KEY_WRONG_GUESS_COUNT, 0)
        );
    }

    void rememberConversation(String transcript, long now) {
        String normalized = transcript == null ? "" : transcript.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("没有可保存的对话");
        }
        String type;
        if (normalized.contains("每天") || normalized.contains("习惯")) {
            type = "ritual";
        } else if (normalized.contains("喜欢") || normalized.contains("不喜欢")) {
            type = "preference";
        } else if (normalized.contains("晚点") || normalized.contains("以后")) {
            type = "unfinished_topic";
        } else {
            type = "event";
        }
        String summary = normalized.length() > 60
                ? normalized.substring(0, 60) + "…"
                : normalized;
        saveMemory(type, summary, "private", "voice_conversation", now);
    }

    List<MemoryItem> listMemories() {
        JSONArray stored = readMemoryArray();
        List<MemoryItem> result = new ArrayList<>();
        for (int index = stored.length() - 1; index >= 0; index -= 1) {
            JSONObject item = stored.optJSONObject(index);
            if (item == null) {
                continue;
            }
            result.add(new MemoryItem(
                    item.optString("id"),
                    item.optString("type"),
                    item.optString("summary"),
                    item.optLong("updatedAt")
            ));
        }
        return result;
    }

    boolean deleteMemory(String id) {
        JSONArray stored = readMemoryArray();
        JSONArray kept = new JSONArray();
        boolean deleted = false;
        for (int index = 0; index < stored.length(); index += 1) {
            JSONObject item = stored.optJSONObject(index);
            if (item != null && id.equals(item.optString("id"))) {
                deleted = true;
                continue;
            }
            kept.put(item);
        }
        if (deleted) {
            preferences.edit().putString(KEY_MEMORIES, kept.toString()).apply();
        }
        return deleted;
    }

    int clearMemories() {
        int count = readMemoryArray().length();
        preferences.edit().remove(KEY_MEMORIES).apply();
        return count;
    }

    private void saveMemory(
            String type,
            String summary,
            String sensitivity,
            String sourceNudgeId,
            long now
    ) {
        JSONArray stored = readMemoryArray();
        JSONArray next = new JSONArray();
        int first = Math.max(0, stored.length() - MAX_MEMORIES + 1);
        for (int index = first; index < stored.length(); index += 1) {
            next.put(stored.opt(index));
        }
        JSONObject item = new JSONObject();
        try {
            item.put("id", "memory_" + UUID.randomUUID());
            item.put("type", type);
            item.put("summary", summary);
            item.put("sensitivity", sensitivity);
            item.put("sourceNudgeId", sourceNudgeId);
            item.put("updatedAt", now);
            next.put(item);
            preferences.edit().putString(KEY_MEMORIES, next.toString()).apply();
        } catch (JSONException error) {
            throw new IllegalStateException("无法保存记忆", error);
        }
    }

    private JSONArray readMemoryArray() {
        try {
            return new JSONArray(preferences.getString(KEY_MEMORIES, "[]"));
        } catch (JSONException error) {
            preferences.edit().remove(KEY_MEMORIES).apply();
            return new JSONArray();
        }
    }

    static final class InitiativeSnapshot {
        final int sentCount;
        final long lastNudgeAt;
        final long blockedUntil;

        InitiativeSnapshot(int sentCount, long lastNudgeAt, long blockedUntil) {
            this.sentCount = sentCount;
            this.lastNudgeAt = lastNudgeAt;
            this.blockedUntil = blockedUntil;
        }
    }

    static final class MemoryItem {
        final String id;
        final String type;
        final String summary;
        final long updatedAt;

        MemoryItem(String id, String type, String summary, long updatedAt) {
            this.id = id;
            this.type = type;
            this.summary = summary;
            this.updatedAt = updatedAt;
        }

        String displayText() {
            return "[" + type + "] " + summary;
        }
    }

    static final class ActivitySnapshot {
        final String state;
        final String detail;
        final long sampledAt;
        final int wrongGuessCount;

        ActivitySnapshot(String state, String detail, long sampledAt, int wrongGuessCount) {
            this.state = state;
            this.detail = detail;
            this.sampledAt = sampledAt;
            this.wrongGuessCount = wrongGuessCount;
        }
    }
}
