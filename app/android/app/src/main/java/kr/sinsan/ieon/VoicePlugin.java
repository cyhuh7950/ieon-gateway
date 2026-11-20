package kr.sinsan.ieon;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Locale;

// V1 음성(기기 내장): 받아쓰기는 기기의 받아쓰기 창(구글 등)을 띄워 글자만 받는다 — 이어온 앱은 마이크 권한을 갖지 않는다.
// 읽어 주기는 기기 TextToSpeech. 음성·글자는 어디에도 저장하지 않는다. 음성으로 승인하는 기능은 없다(승인은 카드 버튼만).
@CapacitorPlugin(name = "IeonVoice")
public class VoicePlugin extends Plugin {
  private TextToSpeech tts;
  private boolean ttsReady = false;

  @Override
  public void load() {
    tts = new TextToSpeech(getContext(), (status) -> {
      ttsReady = status == TextToSpeech.SUCCESS;
      if (ttsReady) tts.setLanguage(Locale.getDefault()); // 읽을 때 화면 언어로 다시 정함(speak의 lang)
    });
  }

  @PluginMethod
  public void available(PluginCall call) {
    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    JSObject r = new JSObject();
    r.put("listen", i.resolveActivity(getContext().getPackageManager()) != null);
    r.put("speak", ttsReady);
    call.resolve(r);
  }

  @PluginMethod
  public void listen(PluginCall call) {
    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    // I18N: 받아쓰기 언어와 안내 글은 화면이 넘김(화면 언어). 안 넘기면 기기 언어.
    String lang = call.getString("lang");
    String prompt = call.getString("prompt");
    if (lang != null) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
    if (prompt != null) i.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
    if (i.resolveActivity(getContext().getPackageManager()) == null) { call.reject("no recognizer", "no_recognizer"); return; }
    startActivityForResult(call, i, "onListen");
  }

  @ActivityCallback
  private void onListen(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("cancelled", "cancelled"); return; }
    ArrayList<String> m = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
    JSObject r = new JSObject();
    r.put("text", m != null && !m.isEmpty() ? m.get(0) : "");
    call.resolve(r);
  }

  @PluginMethod
  public void speak(PluginCall call) {
    String text = call.getString("text", "");
    if (!ttsReady) { call.reject("tts not ready", "no_tts"); return; }
    String lang = call.getString("lang");
    if (lang != null) tts.setLanguage(Locale.forLanguageTag(lang)); // I18N: 화면 언어로 읽기
    String id = "ieon-" + System.currentTimeMillis();
    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
      @Override public void onStart(String u) {}
      @Override public void onDone(String u) { if (id.equals(u)) call.resolve(); }
      @Override public void onError(String u) { if (id.equals(u)) call.reject("tts error", "tts_error"); }
      @Override public void onStop(String u, boolean interrupted) { if (id.equals(u)) call.resolve(); }
    });
    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
  }

  @PluginMethod
  public void stop(PluginCall call) {
    if (tts != null) tts.stop();
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    if (tts != null) { tts.stop(); tts.shutdown(); }
  }
}
