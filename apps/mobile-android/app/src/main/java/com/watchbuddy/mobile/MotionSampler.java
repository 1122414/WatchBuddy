package com.watchbuddy.mobile;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;

final class MotionSampler implements SensorEventListener {
    interface Listener {
        void onMotionState(String state, String detail);
    }

    private static final long SAMPLE_DURATION_MS = 10_000L;
    private static final double ACTIVE_STANDARD_DEVIATION = 0.35;

    private final SensorManager sensorManager;
    private final Sensor accelerometer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Listener listener;

    private int sampleCount;
    private double sum;
    private double squareSum;
    private boolean sampling;

    MotionSampler(Context context, Listener listener) {
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        accelerometer = sensorManager == null
                ? null
                : sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        this.listener = listener;
    }

    boolean start() {
        cancel();
        if (sensorManager == null || accelerometer == null) {
            listener.onMotionState("不可用", "设备没有可用的加速度计");
            return false;
        }

        sampleCount = 0;
        sum = 0;
        squareSum = 0;
        sampling = sensorManager.registerListener(
                this,
                accelerometer,
                SensorManager.SENSOR_DELAY_UI
        );
        if (!sampling) {
            listener.onMotionState("不可用", "系统拒绝注册活动传感器");
            return false;
        }
        listener.onMotionState("采样中", "请按平时状态持有或佩戴手机 10 秒");
        mainHandler.postDelayed(this::finish, SAMPLE_DURATION_MS);
        return true;
    }

    void cancel() {
        mainHandler.removeCallbacksAndMessages(null);
        if (sampling && sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
        sampling = false;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!sampling || event == null || event.values.length < 3) {
            return;
        }
        double magnitude = Math.sqrt(
                event.values[0] * event.values[0]
                        + event.values[1] * event.values[1]
                        + event.values[2] * event.values[2]
        );
        sampleCount += 1;
        sum += magnitude;
        squareSum += magnitude * magnitude;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    private void finish() {
        if (!sampling) {
            return;
        }
        sensorManager.unregisterListener(this);
        sampling = false;
        if (sampleCount < 5) {
            listener.onMotionState("不可用", "有效传感器样本不足");
            return;
        }

        double mean = sum / sampleCount;
        double variance = Math.max(0, squareSum / sampleCount - mean * mean);
        double standardDeviation = Math.sqrt(variance);
        boolean active = standardDeviation >= ACTIVE_STANDARD_DEVIATION;
        String detail = "加速度波动 σ=" + String.format("%.2f", standardDeviation)
                + "，仅用于低风险打扰判断";
        listener.onMotionState(active ? "活动中" : "相对静止", detail);
    }
}
