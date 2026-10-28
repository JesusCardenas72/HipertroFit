package ch.duartesantos.opengym;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * "Auto-backup on changes" → a folder the user picks.
 *
 * writeAutoBackup() in lib/mobile.js used to drop its dated snapshot in Directory.Documents and
 * no further, which meant the destination was whatever Capacitor decided. This lets the user
 * point it anywhere they can reach through the Storage Access Framework: a folder on the SD
 * card, Downloads, or a folder owned by a sync app that mirrors it into Google Drive
 * (Autosync, FolderSync…). Google Drive itself is deliberately not in that list — Drive dropped
 * its writable SAF tree years ago, so no Android app can be handed a Drive folder to write into;
 * a mirroring app is the only route that does not mean shipping an OAuth client and a Google
 * sign-in inside HipertroFit.
 *
 * The chosen folder lives in SharedPreferences, not in the app state JSON: it is a per-device
 * grant (a URI permission this specific install holds), it means nothing on another phone, and
 * that JSON is exactly what gets exported and — in the self-hosted flavour — PUT to a server.
 * Same reasoning as opengym-remote.json in lib/mobile.js.
 *
 * No new dependency: DocumentsContract is framework API (19+), so this avoids pulling in
 * androidx.documentfile for what amounts to one lookup and one write.
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    private static final String PREFS = "hipertrofit-backup-folder";
    private static final String KEY_URI = "tree-uri";
    private static final String MIME_JSON = "application/json";
    // Exactly what backupFileName() in lib/mobile.js produces. remove() refuses anything else, so
    // a folder the user also keeps their own files in can never lose one of them to the pruning.
    private static final Pattern BACKUP_NAME = Pattern.compile("hipertrofit-backup-\\d{4}-\\d{2}-\\d{2}\\.json");

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The stored folder, but only while the permission behind it still holds. The user can
     * revoke it from Android settings, and an SD card can leave; either way the grant is gone
     * and the honest answer is "no folder", so Settings offers to pick one again instead of
     * the backup failing silently every time.
     */
    private Uri grantedTree() {
        String saved = prefs().getString(KEY_URI, null);
        if (saved == null) return null;
        Uri uri = Uri.parse(saved);
        for (android.content.UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isWritePermission()) return uri;
        }
        prefs().edit().remove(KEY_URI).apply();
        return null;
    }

    /** Human-readable name of a tree, for the Settings row. Falls back to the raw document id. */
    private String displayName(Uri tree) {
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContext().getContentResolver().query(
                doc, new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) { }
        return DocumentsContract.getTreeDocumentId(tree);
    }

    private JSObject describe(Uri tree) {
        JSObject r = new JSObject();
        r.put("folder", tree == null ? null : displayName(tree));
        r.put("uri", tree == null ? null : tree.toString());
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(describe(grantedTree()));
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (tree == null) {           // user backed out of the picker — not an error
            call.resolve(describe(grantedTree()));
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Could not keep access to that folder", e);
            return;
        }
        prefs().edit().putString(KEY_URI, tree.toString()).apply();
        call.resolve(describe(tree));
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Uri tree = grantedTree();
        if (tree != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { }
        }
        prefs().edit().remove(KEY_URI).apply();
        call.resolve(describe(null));
    }

    /**
     * Write (or overwrite) one file in the chosen folder. One snapshot per day is the contract
     * lib/mobile.js sets, so an existing file of the same name is truncated rather than left to
     * become "backup (1).json" — SAF's createDocument happily makes duplicates otherwise, and a
     * folder being synced to Drive would fill up with them.
     */
    @PluginMethod
    public void write(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null) {
            call.reject("name and data are required");
            return;
        }
        Uri tree = grantedTree();
        if (tree == null) {
            call.reject("no-folder");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            Uri file = findChild(resolver, tree, name);
            if (file == null) file = DocumentsContract.createDocument(resolver, parent, MIME_JSON, name);
            if (file == null) {
                call.reject("Could not create the backup file in that folder");
                return;
            }
            // "wt" = write + truncate. Plain "w" leaves any tail of a longer previous snapshot
            // behind on some providers, which would produce trailing garbage after the JSON.
            try (OutputStream out = resolver.openOutputStream(file, "wt")) {
                if (out == null) {
                    call.reject("Could not open the backup file for writing");
                    return;
                }
                out.write(data.getBytes(StandardCharsets.UTF_8));
            }
            JSObject r = new JSObject();
            r.put("uri", file.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not write the backup", e);
        }
    }

    /**
     * Names of the files directly in the chosen folder. Only names: which of them are old
     * snapshots to drop is decided in lib/mobile.js (backupsToPrune), next to its test.
     */
    @PluginMethod
    public void list(PluginCall call) {
        Uri tree = grantedTree();
        if (tree == null) {
            call.reject("no-folder");
            return;
        }
        JSArray names = new JSArray();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContext().getContentResolver().query(children, new String[]{
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (!c.isNull(0)) names.put(c.getString(0));
            }
        } catch (Exception e) {
            call.reject("Could not list the backup folder", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("names", names);
        call.resolve(r);
    }

    /** Delete one dated snapshot from the chosen folder. A name that is already gone is not an error. */
    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("name");
        if (name == null || !BACKUP_NAME.matcher(name).matches()) {
            call.reject("not a backup file name");
            return;
        }
        Uri tree = grantedTree();
        if (tree == null) {
            call.reject("no-folder");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri file = findChild(resolver, tree, name);
            if (file != null) DocumentsContract.deleteDocument(resolver, file);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete the old backup", e);
        }
    }

    /** The document in `tree` called `name`, or null. SAF has no lookup-by-name, only a listing. */
    private Uri findChild(ContentResolver resolver, Uri tree, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = resolver.query(children, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
        } catch (Exception ignored) { }
        return null;
    }
}
