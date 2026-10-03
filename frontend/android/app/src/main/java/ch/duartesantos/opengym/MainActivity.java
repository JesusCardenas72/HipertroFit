package ch.duartesantos.opengym;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * Feeds Android's real system-bar insets to the web layer as --sat/--sab/--sal/--sar.
 *
 * Every fixed edge in index.css — the large title's top padding, #tabbar, .sheet, #timer,
 * #toast — is sized off env(safe-area-inset-*). That works on iOS, but Android's WebView
 * only ever reports a display cutout there, never the status bar and never the navigation
 * bar, so on Android both resolve to 0. Since targetSdk 35, Android 15 lays every app out
 * edge-to-edge with no supported way back (windowOptOutEdgeToEdgeEnforcement is deprecated
 * in 16) — which put the title under the status-bar clock and the tab bar under the
 * gesture pill.
 *
 * Capacitor's own answer, android.adjustMarginsForEdgeToEdge, margins the whole WebView in
 * and gives up the edge-to-edge look. This reads the same insets and writes them into the
 * variables the stylesheet already uses, so the page keeps painting to the edges and only
 * its content is inset. iOS is untouched — none of this runs there and env() keeps
 * supplying the values.
 */
public class MainActivity extends BridgeActivity {

    /** The last insets seen, as the script that applies them; null until the first layout. */
    private String insetScript = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the bridge is built there and only sees plugins registered
        // by then. BackupFolder is the destination folder for "Auto-backup on changes".
        registerPlugin(BackupFolderPlugin.class);
        // AudioFocus pauses other apps' audio (music, podcasts) while the rest-end alert plays
        // and hands it back when the alert ends, so the music resumes on its own.
        registerPlugin(AudioFocusPlugin.class);

        super.onCreate(savedInstanceState);

        // Null when the device has no usable WebView: BridgeActivity has already swapped in
        // its own error layout and there is no page to inset.
        if (bridge == null) return;
        final WebView webView = bridge.getWebView();
        if (webView == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            // systemBars() deliberately leaves out the IME. The keyboard must not move the
            // page's bottom padding — the exercise picker already tracks it itself through
            // visualViewport (--picker-keyboard-bottom), and a second source would fight it.
            Insets in = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = view.getResources().getDisplayMetrics().density;
            // Locale.US: a comma decimal separator would make these lengths invalid CSS on a
            // Spanish or German phone, and setProperty fails silently on an invalid value.
            insetScript = String.format(
                Locale.US,
                "(function(s){" +
                "s.setProperty('--sat','%.2fpx');s.setProperty('--sab','%.2fpx');" +
                "s.setProperty('--sal','%.2fpx');s.setProperty('--sar','%.2fpx')" +
                "})(document.documentElement.style)",
                in.top / density, in.bottom / density, in.left / density, in.right / density
            );
            applyInsets(webView);
            // Pass them on rather than returning CONSUMED. The WebView fills the window so
            // nothing downstream needs them today, but consuming would hide them from any
            // plugin that adds a listener of its own later.
            return windowInsets;
        });

        // The first inset dispatch lands at first layout, normally before the bundle has
        // parsed, so that setProperty call reaches no document. Replaying on page load
        // covers the cold start and any later WebView reload; the two paths are idempotent.
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    applyInsets(view);
                }
            }
        );
    }

    private void applyInsets(WebView webView) {
        if (insetScript == null) return;   // no layout yet; the listener will replay it
        webView.evaluateJavascript(insetScript, null);
    }
}
