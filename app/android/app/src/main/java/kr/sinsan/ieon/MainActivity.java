package kr.sinsan.ieon;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

// 안드로이드 뒤로 가기: 앱 화면(대화·방)에서는 목록으로 돌아가고, 목록에서는 앱을 닫는다.
// 화면은 대화·방을 열 때 브라우저 기록을 하나 쌓는다(page.tsx) — 그 기록이 있으면 뒤로, 없으면 닫기.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(VoicePlugin.class); // V1 음성(앱 안 코드, 새 부품 없음)
    super.onCreate(savedInstanceState);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null && web.canGoBack()) web.goBack();
        else finish();
      }
    });
  }
}
