package ch.duartesantos.opengym;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Self-update of the sideloaded APK (lib/app-update.js decides when).
 *
 * download() fetches the APK published on gh-pages into the app's cache and only keeps it if
 * it is exactly what version.json announced (SHA-256), is this same package and carries the
 * announced versionCode — a truncated download or a foreign file is deleted, never offered.
 * install() hands it to the system installer through the FileProvider already declared in the
 * manifest (cache-path in res/xml/file_paths.xml).
 *
 * Android does not let an app update itself silently, so the system "Update this app?" dialog
 * is always the last step. The first time it also needs "Install unknown apps" allowed for
 * HipertroFit (REQUEST_INSTALL_PACKAGES); install() opens that screen and continues once the
 * user comes back with it granted.
 *
 * No new dependency: HttpURLConnection and MessageDigest are framework API.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String DIR = "updates";
    private static final String FILE = "HipertroFit-update.apk";
    private static final String MIME_APK = "application/vnd.android.package-archive";

    private File apk() {
        return new File(new File(getContext().getCacheDir(), DIR), FILE);
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** The versionCode inside the APK, or -1 when it is not an APK of this package. */
    @SuppressWarnings("deprecation")
    private long archiveVersion(File f) {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(f.getAbsolutePath(), 0);
        if (info == null || !getContext().getPackageName().equals(info.packageName)) return -1;
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private boolean matches(File f, String sha, long code) {
        try {
            return f.isFile() && sha256(f).equalsIgnoreCase(sha) && archiveVersion(f) == code;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha = call.getString("sha256");
        Long code = call.getLong("versionCode");
        if (url == null || !url.startsWith("https://") || sha == null || code == null) {
            call.reject("Missing or invalid url, sha256 or versionCode");
            return;
        }
        final File target = apk();
        // Already downloaded on an earlier launch: nothing to fetch.
        if (matches(target, sha, code)) {
            call.resolve();
            return;
        }
        new Thread(() -> {
            File part = new File(target.getParentFile(), FILE + ".part");
            HttpURLConnection conn = null;
            try {
                target.getParentFile().mkdirs();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
                long total = conn.getContentLengthLong();
                long done = 0;
                int last = -1;
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != last) {
                            last = pct;
                            JSObject p = new JSObject();
                            p.put("percent", pct);
                            notifyListeners("progress", p);
                        }
                    }
                }
                if (!matches(part, sha, code)) throw new Exception("Downloaded file does not match version.json");
                if (target.exists()) target.delete();
                if (!part.renameTo(target)) throw new Exception("Could not store the update");
                call.resolve();
            } catch (Exception e) {
                part.delete();
                call.reject(e.getMessage() == null ? "Download failed" : e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private boolean mayInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (!apk().isFile()) {
            call.reject("No update downloaded");
            return;
        }
        if (mayInstall()) {
            launchInstaller(call);
            return;
        }
        // Android 8+: "Install unknown apps" must be allowed for this app first.
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "permissionBack");
    }

    @ActivityCallback
    private void permissionBack(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (mayInstall()) launchInstaller(call);
        else call.reject("Install unknown apps not allowed");
    }

    private void launchInstaller(PluginCall call) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk());
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, MIME_APK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer", e);
        }
    }
}
