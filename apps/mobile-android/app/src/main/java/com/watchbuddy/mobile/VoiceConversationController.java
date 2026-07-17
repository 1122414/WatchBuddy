package com.watchbuddy.mobile;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;

import java.util.ArrayList;
import java.util.Locale;

final class VoiceConversationController implements RecognitionListener, TextToSpeech.OnInitListener {
    interface Listener {
        void onVoiceState(String state);
        void onTranscript(String transcript);
        void onCompanionReply(String reply);
    }

    private final Context appContext;
    private final Listener listener;
    private final TextToSpeech textToSpeech;
    private SpeechRecognizer speechRecognizer;
    private boolean ttsReady;

    VoiceConversationController(Context context, Listener listener) {
        appContext = context.getApplicationContext();
        this.listener = listener;
        textToSpeech = new TextToSpeech(appContext, this);
    }

    boolean startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            listener.onVoiceState("系统语音识别不可用");
            return false;
        }
        cancelListening();
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(appContext);
        speechRecognizer.setRecognitionListener(this);

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        speechRecognizer.startListening(intent);
        listener.onVoiceState("正在听，最长由系统识别器控制；可随时取消");
        return true;
    }

    void cancelListening() {
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (ttsReady) {
            textToSpeech.stop();
        }
    }

    void close() {
        cancelListening();
        textToSpeech.shutdown();
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            listener.onVoiceState("系统语音合成初始化失败");
            return;
        }
        int result = textToSpeech.setLanguage(Locale.SIMPLIFIED_CHINESE);
        ttsReady = result != TextToSpeech.LANG_MISSING_DATA
                && result != TextToSpeech.LANG_NOT_SUPPORTED;
    }

    @Override
    public void onReadyForSpeech(Bundle params) {
        listener.onVoiceState("请说话…");
    }

    @Override
    public void onBeginningOfSpeech() {
        listener.onVoiceState("正在识别…");
    }

    @Override
    public void onRmsChanged(float rmsdB) {
    }

    @Override
    public void onBufferReceived(byte[] buffer) {
    }

    @Override
    public void onEndOfSpeech() {
        listener.onVoiceState("识别完成，正在组织回复…");
    }

    @Override
    public void onError(int error) {
        releaseRecognizer();
        listener.onVoiceState("语音识别结束，错误码 " + error + "；可重新开始");
    }

    @Override
    public void onResults(Bundle results) {
        releaseRecognizer();
        ArrayList<String> options = results == null
                ? null
                : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (options == null || options.isEmpty()) {
            listener.onVoiceState("没有识别到内容");
            return;
        }
        String transcript = options.get(0).trim();
        listener.onTranscript(transcript);
        String reply = createSafeReply(transcript);
        listener.onCompanionReply(reply);
        if (ttsReady) {
            textToSpeech.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "watchbuddy_reply");
            listener.onVoiceState("回复由手机播放；点取消可立即停止");
        } else {
            listener.onVoiceState("语音合成不可用，已显示文字回复");
        }
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        ArrayList<String> options = partialResults == null
                ? null
                : partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (options != null && !options.isEmpty()) {
            listener.onTranscript(options.get(0));
        }
    }

    @Override
    public void onEvent(int eventType, Bundle params) {
    }

    private void releaseRecognizer() {
        SpeechRecognizer active = speechRecognizer;
        speechRecognizer = null;
        if (active != null) {
            active.destroy();
        }
    }

    private String createSafeReply(String transcript) {
        if (transcript.contains("累") || transcript.contains("压力") || transcript.contains("难受")) {
            return "听起来你今天扛了不少。我不急着给建议，先陪你缓一会儿。";
        }
        if (transcript.contains("开心") || transcript.contains("顺利") || transcript.contains("完成")) {
            return "这件事值得替你高兴。要不要把最满意的那一小段也记下来？";
        }
        if (transcript.contains("忙") || transcript.contains("晚点")) {
            return "好，我先安静一点。等你想说的时候，我还在。";
        }
        return "我听见了。现在更想让我陪你聊聊，还是先替你把这件事记住？";
    }
}
