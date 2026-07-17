package com.watchbuddy.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.ScrollingMovementMethod;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

public final class MainActivity extends Activity implements
        WearEngineGateway.Listener,
        MotionSampler.Listener,
        VoiceConversationController.Listener {
    private static final String PREFS_NAME = "watchbuddy_device";
    private static final String KEY_PEER_PACKAGE = "peer_package";
    private static final String KEY_PEER_FINGERPRINT = "peer_fingerprint";
    private static final String DEFAULT_PEER_PACKAGE = "com.watchbuddy.watch";
    private static final int RECORD_AUDIO_REQUEST = 1001;
    private static final long SCHEDULED_DEMO_DELAY_MS = 60_000L;

    private final DateTimeFormatter logTime = DateTimeFormatter.ofPattern("HH:mm:ss");
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private WearEngineGateway gateway;
    private CompanionStore companionStore;
    private CompanionCoordinator coordinator;
    private MotionSampler motionSampler;
    private VoiceConversationController voiceController;
    private SharedPreferences preferences;
    private TextView statusText;
    private TextView logText;
    private TextView initiativeReason;
    private TextView voiceStatus;
    private TextView voiceTranscript;
    private TextView activityStatus;
    private TextView memorySummary;
    private EditText peerPackage;
    private EditText peerFingerprint;
    private CheckBox quietMode;
    private Button sendButton;
    private String latestTranscript = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        bindViews();
        restorePeerIdentity();
        gateway = new WearEngineGateway(this, this);
        companionStore = new CompanionStore(this);
        coordinator = new CompanionCoordinator(companionStore, gateway);
        motionSampler = new MotionSampler(this, this);
        voiceController = new VoiceConversationController(this, this);
        restoreCompanionState();
        bindActions();
        onLog("手机端已启动；等待 Wear Engine 授权");
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        motionSampler.cancel();
        voiceController.close();
        gateway.close();
        super.onDestroy();
    }

    private void bindViews() {
        statusText = findViewById(R.id.status_text);
        logText = findViewById(R.id.log_text);
        logText.setMovementMethod(new ScrollingMovementMethod());
        peerPackage = findViewById(R.id.peer_package);
        peerFingerprint = findViewById(R.id.peer_fingerprint);
        quietMode = findViewById(R.id.quiet_mode);
        initiativeReason = findViewById(R.id.initiative_reason);
        voiceStatus = findViewById(R.id.voice_status);
        voiceTranscript = findViewById(R.id.voice_transcript);
        activityStatus = findViewById(R.id.activity_status);
        memorySummary = findViewById(R.id.memory_summary);
        sendButton = findViewById(R.id.send_button);
    }

    private void restorePeerIdentity() {
        peerPackage.setText(preferences.getString(KEY_PEER_PACKAGE, DEFAULT_PEER_PACKAGE));
        peerFingerprint.setText(preferences.getString(KEY_PEER_FINGERPRINT, ""));
    }

    private void restoreCompanionState() {
        quietMode.setChecked(companionStore.isQuietMode());
        updateMemorySummary();
    }

    private void bindActions() {
        findViewById(R.id.save_peer_button).setOnClickListener(view -> savePeerIdentity());
        findViewById(R.id.authorize_button).setOnClickListener(view -> gateway.requestAuthorization());
        findViewById(R.id.refresh_button).setOnClickListener(view -> gateway.refreshDevices());
        findViewById(R.id.receiver_button).setOnClickListener(view -> gateway.registerReceiver());
        findViewById(R.id.send_button).setOnClickListener(view -> coordinator.sendTransportDemo());
        quietMode.setOnCheckedChangeListener((button, checked) -> {
            companionStore.setQuietMode(checked);
            initiativeReason.setText(checked ? "安静模式生效：主动消息已硬阻止" : "安静模式已关闭");
        });
        findViewById(R.id.daily_button).setOnClickListener(view ->
                presentDecision(coordinator.sendDailyRoutine()));
        findViewById(R.id.random_button).setOnClickListener(view ->
                presentDecision(coordinator.sendRandomSocial()));
        findViewById(R.id.follow_up_button).setOnClickListener(view ->
                presentDecision(coordinator.sendRelationshipFollowUp()));
        findViewById(R.id.schedule_demo_button).setOnClickListener(view -> scheduleDemo());
        findViewById(R.id.voice_start_button).setOnClickListener(view -> requestVoiceStart());
        findViewById(R.id.voice_cancel_button).setOnClickListener(view -> {
            voiceController.cancelListening();
            voiceStatus.setText("已取消；麦克风与播放均已停止");
        });
        findViewById(R.id.voice_remember_button).setOnClickListener(view -> rememberVoiceTranscript());
        findViewById(R.id.activity_sample_button).setOnClickListener(view -> motionSampler.start());
        findViewById(R.id.activity_nudge_button).setOnClickListener(view ->
                presentDecision(coordinator.sendUserState()));
        findViewById(R.id.memory_view_button).setOnClickListener(view -> showMemories());
        findViewById(R.id.memory_clear_button).setOnClickListener(view -> confirmClearMemories());
        findViewById(R.id.clear_log_button).setOnClickListener(view -> logText.setText(""));
    }

    private void presentDecision(CompanionCoordinator.Decision decision) {
        String prefix = decision.sent ? "已发送：" : "已阻止：";
        initiativeReason.setText(prefix + decision.reason);
        onLog(prefix + decision.reason);
    }

    private void scheduleDemo() {
        mainHandler.removeCallbacksAndMessages(null);
        initiativeReason.setText("已安排 60 秒后的随机关心；保持应用进程运行");
        onLog("主动消息计时已开始");
        mainHandler.postDelayed(() -> presentDecision(coordinator.sendRandomSocial()),
                SCHEDULED_DEMO_DELAY_MS);
    }

    private void requestVoiceStart() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            voiceController.startListening();
            return;
        }
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_AUDIO_REQUEST);
    }

    private void rememberVoiceTranscript() {
        if (latestTranscript.trim().isEmpty()) {
            onLog("当前没有可保存的语音文本");
            return;
        }
        companionStore.rememberConversation(latestTranscript, System.currentTimeMillis());
        updateMemorySummary();
        onLog("已按内容分类保存这段对话；仅保存在本机");
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != RECORD_AUDIO_REQUEST) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            voiceController.startListening();
        } else {
            voiceStatus.setText("未授予麦克风权限，短语音保持关闭");
        }
    }

    private void showMemories() {
        List<CompanionStore.MemoryItem> memories = companionStore.listMemories();
        if (memories.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("本地记忆")
                    .setMessage("当前没有记忆")
                    .setPositiveButton("知道了", null)
                    .show();
            return;
        }

        String[] labels = memories.stream()
                .map(CompanionStore.MemoryItem::displayText)
                .toArray(String[]::new);
        new AlertDialog.Builder(this)
                .setTitle("点一条可删除")
                .setItems(labels, (dialog, which) -> confirmDeleteMemory(memories.get(which)))
                .setNegativeButton("关闭", null)
                .show();
    }

    private void confirmDeleteMemory(CompanionStore.MemoryItem memory) {
        new AlertDialog.Builder(this)
                .setTitle("删除这条记忆？")
                .setMessage(memory.summary)
                .setPositiveButton("删除", (dialog, which) -> {
                    companionStore.deleteMemory(memory.id);
                    updateMemorySummary();
                    onLog("已删除一条本地记忆");
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void confirmClearMemories() {
        int count = companionStore.listMemories().size();
        if (count == 0) {
            onLog("没有可清空的记忆");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("清空全部本地记忆？")
                .setMessage("将删除 " + count + " 条记忆，此操作无法撤销。")
                .setPositiveButton("全部清空", (dialog, which) -> {
                    int deleted = companionStore.clearMemories();
                    updateMemorySummary();
                    onLog("已清空 " + deleted + " 条本地记忆");
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void updateMemorySummary() {
        List<CompanionStore.MemoryItem> memories = companionStore.listMemories();
        if (memories.isEmpty()) {
            memorySummary.setText(R.string.memory_empty);
            return;
        }
        memorySummary.setText("已保存 " + memories.size() + " 条；最近：" + memories.get(0).summary);
    }

    private void savePeerIdentity() {
        String packageName = peerPackage.getText().toString().trim();
        String fingerprint = peerFingerprint.getText().toString().trim();
        try {
            gateway.configurePeer(packageName, fingerprint);
            preferences.edit()
                    .putString(KEY_PEER_PACKAGE, packageName)
                    .putString(KEY_PEER_FINGERPRINT, fingerprint)
                    .apply();
            updateSendAvailability();
        } catch (IllegalArgumentException error) {
            onLog(error.getMessage());
        }
    }

    private void updateSendAvailability() {
        boolean hasFingerprint = !peerFingerprint.getText().toString().trim().isEmpty();
        sendButton.setEnabled(hasFingerprint && gateway.hasSelectedDevice());
    }

    @Override
    public void onLog(String message) {
        String entry = "[" + LocalTime.now().format(logTime) + "] " + message;
        logText.append(entry + System.lineSeparator());
        View parent = (View) logText.getParent();
        parent.post(() -> logText.scrollTo(0, Math.max(0,
                logText.getLayout() == null ? 0 : logText.getLayout().getHeight() - logText.getHeight())));
    }

    @Override
    public void onDeviceSelected(String name, boolean connected) {
        statusText.setText("已选择 " + name + (connected ? " · 已连接" : " · 未连接"));
        onLog("目标设备已选择: " + name);
        updateSendAvailability();
    }

    @Override
    public void onMessage(String payload) {
        onLog("收到手表回复（" + payload.length() + " 字符）");
    }

    @Override
    public void onDeliveryAck(String nudgeId, String status) {
        onLog("手表确认消息状态: " + status);
    }

    @Override
    public void onResponse(String nudgeId, String actionId, long responseLatencyMs) {
        onLog("收到快捷回复: " + actionId + " · " + responseLatencyMs + "ms");
        if (coordinator.onResponse(nudgeId, actionId)) {
            updateMemorySummary();
        } else {
            onLog("回复不属于当前会话，仅确认送达，不写入记忆");
        }
    }

    @Override
    public void onMotionState(String state, String detail) {
        activityStatus.setText(state + " · " + detail);
        if ("活动中".equals(state) || "相对静止".equals(state)) {
            companionStore.recordActivityState(state, detail, System.currentTimeMillis());
        }
        onLog("活动采样结果: " + state);
    }

    @Override
    public void onVoiceState(String state) {
        voiceStatus.setText(state);
    }

    @Override
    public void onTranscript(String transcript) {
        latestTranscript = transcript;
        voiceTranscript.setText("你：" + transcript);
    }

    @Override
    public void onCompanionReply(String reply) {
        voiceTranscript.append(System.lineSeparator() + "WatchBuddy：" + reply);
    }
}
