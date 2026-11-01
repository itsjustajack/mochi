package com.itsjustajack.helper;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Brain dump notes. Each note is encrypted on the phone the moment it is saved, with the key shared
 * with the PC at pairing (ChaCha20-Poly1305, built into Android 9+). The same format the PC reads:
 *   "HLN1" + 12-byte nonce + ciphertext + 16-byte tag, with "HLN1" as associated data.
 * Notes wait in the app's private folder until the PC can be reached, or Jack saves them to Drive.
 * Works with no connection at all.
 */
final class Notes {
    static final byte[] MAGIC = "HLN1".getBytes(StandardCharsets.US_ASCII);

    private Notes() {}

    static byte[] seal(byte[] key, String text) throws Exception {
        byte[] nonce = new byte[12];
        new SecureRandom().nextBytes(nonce);
        Cipher c = Cipher.getInstance("ChaCha20/Poly1305/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "ChaCha20"), new IvParameterSpec(nonce));
        c.updateAAD(MAGIC);
        byte[] ct = c.doFinal(text.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[4 + 12 + ct.length];
        System.arraycopy(MAGIC, 0, out, 0, 4);
        System.arraycopy(nonce, 0, out, 4, 12);
        System.arraycopy(ct, 0, out, 16, ct.length);
        return out;
    }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "notes");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Encrypts and queues a note. Returns the queued file. */
    static File save(Context c, String text) throws Exception {
        byte[] key = KeyBox.notesKey(c);
        if (key == null) throw new IOException("Pair with the PC first, so notes can be locked with its key.");
        byte[] sealed = seal(key, text);
        Arrays.fill(key, (byte) 0);
        File f = new File(dir(c), "note-" + System.currentTimeMillis() + ".hln");
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(sealed);
        }
        return f;
    }

    static List<File> queued(Context c) {
        File[] fs = dir(c).listFiles((d, n) -> n.endsWith(".hln"));
        List<File> out = new ArrayList<>();
        if (fs != null) out.addAll(Arrays.asList(fs));
        out.sort((a, b) -> a.getName().compareTo(b.getName()));
        return out;
    }

    /** Sends every queued note to the PC. Returns how many went. Stops at the first failure. */
    static int sendQueued(Context c) {
        Api api = Api.from(c);
        if (api == null) return 0;
        int sent = 0;
        for (File f : queued(c)) {
            try {
                api.sendNote(Files.readAllBytes(f.toPath()));
                if (f.delete()) sent++;
            } catch (Exception e) {
                break;
            }
        }
        return sent;
    }
}
