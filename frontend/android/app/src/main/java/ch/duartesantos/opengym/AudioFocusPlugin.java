package ch.duartesantos.opengym;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pauses the user's music for the rest-end alert and hands it back afterwards.
 *
 * Left to itself, a sound played by the WebView can take full audio focus, and Spotify or a
 * podcast app treats that as "another app started playing" — it pauses and stays paused. This
 * asks for AUDIOFOCUS_GAIN_TRANSIENT instead: the other app gets AUDIOFOCUS_LOSS_TRANSIENT and
 * pauses, and when release() abandons the focus it gets AUDIOFOCUS_GAIN back and resumes by
 * itself. (…_MAY_DUCK would only lower its volume; the bell is meant to be heard on its own.)
 *
 * lib/sound.js calls pause() 1.5 s before the alert starts and release() 1.5 s after its last
 * clip ends, or at once if it is cut off; lib/mobile.js wires those calls up. No new
 * dependency — AudioManager is framework API.
 */
@CapacitorPlugin(name = "AudioFocus")
public class AudioFocusPlugin extends Plugin {

    /** Nothing to react to: the alert is a few seconds long and we give focus back on our own. */
    private final AudioManager.OnAudioFocusChangeListener listener = change -> { };

    /** API 26+ focus request, built once and reused so release() abandons the same request. */
    private AudioFocusRequest request = null;

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        AudioManager am = audio();
        JSObject r = new JSObject();
        if (am == null) {
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (request == null) {
                request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build())
                        .setOnAudioFocusChangeListener(listener)
                        .build();
            }
            result = am.requestAudioFocus(request);
        } else {
            result = legacyRequest(am);
        }
        r.put("granted", result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void release(PluginCall call) {
        AudioManager am = audio();
        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (request != null) am.abandonAudioFocusRequest(request);
            } else {
                legacyAbandon(am);
            }
        }
        call.resolve();
    }

    @SuppressWarnings("deprecation")
    private int legacyRequest(AudioManager am) {
        return am.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
    }

    @SuppressWarnings("deprecation")
    private void legacyAbandon(AudioManager am) {
        am.abandonAudioFocus(listener);
    }
}
