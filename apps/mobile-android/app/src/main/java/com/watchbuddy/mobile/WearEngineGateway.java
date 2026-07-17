package com.watchbuddy.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.huawei.wearengine.HiWear;
import com.huawei.wearengine.auth.AuthCallback;
import com.huawei.wearengine.auth.Permission;
import com.huawei.wearengine.device.Device;
import com.huawei.wearengine.device.DeviceClient;
import com.huawei.wearengine.p2p.Message;
import com.huawei.wearengine.p2p.P2pClient;
import com.huawei.wearengine.p2p.Receiver;
import com.huawei.wearengine.p2p.SendCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class WearEngineGateway {
    private static final long[] RETRY_DELAYS_MS = {0L, 5_000L, 20_000L};
    private static final Set<String> ACK_STATUSES = new HashSet<>(Arrays.asList(
            "received",
            "displayed",
            "responded",
            "expired",
            "duplicate",
            "invalid"
    ));

    interface Listener {
        void onLog(String message);
        void onDeviceSelected(String name, boolean connected);
        void onMessage(String payload);
        void onDeliveryAck(String nudgeId, String status);
        void onResponse(String nudgeId, String actionId, long responseLatencyMs);
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Context appContext;
    private final Listener listener;
    private final P2pClient p2pClient;
    private final DeviceClient deviceClient;
    private final Map<String, PendingDelivery> pendingDeliveries = new HashMap<>();
    private final Set<String> processedResponses = new LinkedHashSet<>();

    private Device selectedDevice;
    private Receiver receiver;

    WearEngineGateway(Context context, Listener listener) {
        appContext = context.getApplicationContext();
        this.listener = listener;
        p2pClient = HiWear.getP2pClient(appContext);
        deviceClient = HiWear.getDeviceClient(appContext);
    }

    void requestAuthorization() {
        listener.onLog("正在请求 Wear Engine 设备权限…");
        HiWear.getAuthClient(appContext).requestPermission(new AuthCallback() {
            @Override
            public void onOk(Permission[] permissions) {
                postLog("Wear Engine 授权成功");
            }

            @Override
            public void onCancel() {
                postLog("用户取消了 Wear Engine 授权");
            }
        }, Permission.DEVICE_MANAGER);
    }

    void configurePeer(String packageName, String fingerprint) {
        if (packageName == null || packageName.trim().isEmpty()) {
            throw new IllegalArgumentException("表端包名不能为空");
        }
        if (fingerprint == null || fingerprint.trim().isEmpty()) {
            throw new IllegalArgumentException("表端证书指纹不能为空");
        }
        p2pClient.setPeerPkgName(packageName.trim());
        p2pClient.setPeerFingerPrint(fingerprint.trim());
        listener.onLog("已配置表端身份；指纹仅保存在本机");
    }

    void refreshDevices() {
        listener.onLog("正在读取华为运动健康中的已配对设备…");
        deviceClient.getBondedDevices()
                .addOnSuccessListener(this::handleDevices)
                .addOnFailureListener(error -> postLog("读取设备失败: " + safeError(error)));
    }

    void registerReceiver() {
        if (selectedDevice == null) {
            listener.onLog("请先发现并选择 GT 6 Pro");
            return;
        }
        if (receiver != null) {
            listener.onLog("手表回复监听已注册");
            return;
        }

        receiver = message -> {
            if (message == null || message.getData() == null) {
                postLog("收到空的手表消息");
                return;
            }
            String payload = new String(message.getData(), StandardCharsets.UTF_8);
            handleIncomingPayload(payload);
        };

        p2pClient.registerReceiver(selectedDevice, receiver)
                .addOnSuccessListener(unused -> postLog("手表回复监听注册成功"))
                .addOnFailureListener(error -> {
                    receiver = null;
                    postLog("注册回复监听失败: " + safeError(error));
                });
    }

    void send(String payload) {
        if (selectedDevice == null) {
            listener.onLog("请先发现并选择 GT 6 Pro");
            return;
        }
        if (payload == null || payload.trim().isEmpty()) {
            listener.onLog("拒绝发送空消息");
            return;
        }

        try {
            JSONObject json = new JSONObject(payload);
            String nudgeId = json.getString("nudgeId");
            long expiresAt = json.getLong("expiresAt");
            if (expiresAt <= System.currentTimeMillis()) {
                listener.onLog("拒绝发送已过期消息");
                return;
            }

            PendingDelivery delivery = new PendingDelivery(nudgeId, payload, expiresAt);
            pendingDeliveries.put(nudgeId, delivery);
            sendAttempt(delivery);
        } catch (JSONException error) {
            listener.onLog("拒绝发送无效协议消息");
        }
    }

    void close() {
        mainHandler.removeCallbacksAndMessages(null);
        pendingDeliveries.clear();
        if (receiver == null) {
            return;
        }
        Receiver registeredReceiver = receiver;
        receiver = null;
        p2pClient.unregisterReceiver(registeredReceiver);
    }

    boolean hasSelectedDevice() {
        return selectedDevice != null;
    }

    private void handleDevices(List<Device> devices) {
        if (devices == null || devices.isEmpty()) {
            postLog("Wear Engine 未返回已配对设备");
            return;
        }

        Device fallback = null;
        Device preferred = null;
        for (Device device : devices) {
            postLog("发现设备: " + device.getName() + "，连接=" + device.isConnected());
            if (fallback == null && device.isConnected()) {
                fallback = device;
            }
            if (device.getName() != null
                    && device.getName().contains("GT 6 Pro")
                    && device.isConnected()) {
                preferred = device;
                break;
            }
        }

        selectedDevice = preferred != null ? preferred : fallback;
        if (selectedDevice == null) {
            postLog("已配对设备均未连接");
            return;
        }

        Device chosen = selectedDevice;
        mainHandler.post(() -> listener.onDeviceSelected(chosen.getName(), chosen.isConnected()));
    }

    private void sendAttempt(PendingDelivery delivery) {
        if (pendingDeliveries.get(delivery.nudgeId) != delivery) {
            return;
        }
        long now = System.currentTimeMillis();
        if (delivery.expiresAt <= now) {
            pendingDeliveries.remove(delivery.nudgeId);
            postLog("消息在确认前已过期: " + delivery.nudgeId);
            return;
        }
        if (delivery.attempts >= RETRY_DELAYS_MS.length) {
            return;
        }

        delivery.attempts += 1;
        Message message = new Message.Builder()
                .setPayload(delivery.payload.getBytes(StandardCharsets.UTF_8))
                .build();

        p2pClient.send(selectedDevice, message, new SendCallback() {
            @Override
            public void onSendResult(int resultCode) {
                postLog("Wear Engine 发送结果码: " + resultCode);
            }

            @Override
            public void onSendProgress(long progress) {
                if (progress == 100) {
                    postLog("第 " + delivery.attempts + " 次数据传输完成，等待手表 ACK");
                }
            }
        }).addOnFailureListener(error -> postLog("发送失败: " + safeError(error)));

        if (delivery.attempts < RETRY_DELAYS_MS.length) {
            long delay = RETRY_DELAYS_MS[delivery.attempts];
            mainHandler.postDelayed(() -> sendAttempt(delivery), delay);
        } else {
            mainHandler.postDelayed(() -> {
                PendingDelivery pending = pendingDeliveries.get(delivery.nudgeId);
                if (pending == delivery) {
                    pendingDeliveries.remove(delivery.nudgeId);
                    postLog("手表 ACK 超时，已停止重试");
                }
            }, 15_000L);
        }
    }

    private void handleIncomingPayload(String payload) {
        try {
            JSONObject message = new JSONObject(payload);
            if (message.optInt("schemaVersion", -1) != 1) {
                postLog("拒绝不支持的协议版本");
                return;
            }
            String type = message.optString("type");
            if ("DELIVERY_ACK".equals(type)) {
                String nudgeId = message.getString("messageId");
                String status = message.getString("status");
                if (nudgeId.length() < 8 || !ACK_STATUSES.contains(status)) {
                    postLog("拒绝无效送达 ACK");
                    return;
                }
                pendingDeliveries.remove(nudgeId);
                mainHandler.post(() -> listener.onDeliveryAck(nudgeId, status));
                return;
            }
            if ("COMPANION_RESPONSE".equals(type)) {
                String nudgeId = message.getString("nudgeId");
                String actionId = message.getString("actionId");
                long latency = message.optLong("responseLatencyMs", -1L);
                if (nudgeId.length() < 8
                        || actionId.trim().isEmpty()
                        || actionId.length() > 64
                        || latency < 0
                        || latency > 24 * 60 * 60 * 1000L) {
                    postLog("拒绝无效快捷回复");
                    sendDeliveryAck(nudgeId, "invalid");
                    return;
                }
                pendingDeliveries.remove(nudgeId);
                sendDeliveryAck(nudgeId, "responded");
                if (rememberResponse(nudgeId)) {
                    mainHandler.post(() -> listener.onResponse(nudgeId, actionId, latency));
                } else {
                    postLog("忽略重复快捷回复: " + nudgeId);
                }
                return;
            }
        } catch (JSONException error) {
            postLog("收到无法解析的手表消息");
            return;
        }
        mainHandler.post(() -> listener.onMessage(payload));
    }

    private void sendDeliveryAck(String messageId, String status) {
        if (selectedDevice == null) {
            return;
        }
        try {
            JSONObject ack = new JSONObject();
            ack.put("schemaVersion", 1);
            ack.put("type", "DELIVERY_ACK");
            ack.put("messageId", messageId);
            ack.put("status", status);
            ack.put("acknowledgedAt", System.currentTimeMillis());
            Message message = new Message.Builder()
                    .setPayload(ack.toString().getBytes(StandardCharsets.UTF_8))
                    .build();
            p2pClient.send(selectedDevice, message, new SendCallback() {
                @Override
                public void onSendResult(int resultCode) {
                    postLog("回复 ACK 发送结果码: " + resultCode);
                }

                @Override
                public void onSendProgress(long progress) {
                }
            }).addOnFailureListener(error -> postLog("回复 ACK 发送失败: " + safeError(error)));
        } catch (JSONException error) {
            postLog("无法构建回复 ACK");
        }
    }

    private boolean rememberResponse(String nudgeId) {
        if (!processedResponses.add(nudgeId)) {
            return false;
        }
        while (processedResponses.size() > 128) {
            String oldest = processedResponses.iterator().next();
            processedResponses.remove(oldest);
        }
        return true;
    }

    private void postLog(String message) {
        mainHandler.post(() -> listener.onLog(message));
    }

    private String safeError(Exception error) {
        String name = error == null ? "UnknownError" : error.getClass().getSimpleName();
        String message = error == null ? "" : error.getMessage();
        return message == null || message.trim().isEmpty() ? name : name + ": " + message;
    }

    private static final class PendingDelivery {
        private final String nudgeId;
        private final String payload;
        private final long expiresAt;
        private int attempts;

        private PendingDelivery(String nudgeId, String payload, long expiresAt) {
            this.nudgeId = nudgeId;
            this.payload = payload;
            this.expiresAt = expiresAt;
        }
    }
}
