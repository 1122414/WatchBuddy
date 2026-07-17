export const PHONE_PACKAGE_NAME = 'com.watchbuddy.mobile';

// 由 scripts/configure-watch-peer.mjs 在本地写入真实 Android 签名 SHA-256。
// 在配置完成前，表端仍可运行离线角色，但不会注册跨端消息监听。
export const PHONE_CERT_FINGERPRINT = 'REPLACE_WITH_ANDROID_SHA256';
