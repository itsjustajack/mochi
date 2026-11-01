package com.itsjustajack.helper;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the phone's device key (from pairing) and the notes key encrypted with AES-256-GCM, using
 * a key that lives in the Android Keystore (the same idea as Stub's KeyLock). Only the last 4
 * characters are ever shown.
 */
final class KeyBox {
    private static final String ALIAS = "helper-key-v1";
    private static final String PREFS = "helper";
    private static final String FIELD = "enc_key";
    private static final String NOTES_FIELD = "enc_notes_key";

    private KeyBox() {}

    private static SecretKey masterKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    static void save(Context c, String key) throws Exception {
        saveField(c, FIELD, key);
    }

    static void saveNotesKey(Context c, String b64) throws Exception {
        saveField(c, NOTES_FIELD, b64);
    }

    /** The 32-byte key shared with the PC for encrypting notes, or null. */
    static byte[] notesKey(Context c) {
        String b64 = loadField(c, NOTES_FIELD);
        if (b64 == null) return null;
        byte[] k = Base64.decode(b64, Base64.NO_WRAP);
        return k.length == 32 ? k : null;
    }

    private static void saveField(Context c, String field, String key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, masterKey());
        byte[] iv = cipher.getIV();
        byte[] ct = cipher.doFinal(key.getBytes(StandardCharsets.UTF_8));
        String packed = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        prefs(c).edit().putString(field, packed).apply();
    }

    /** The device key, or null if none is saved or it can no longer be decrypted. */
    static String load(Context c) {
        return loadField(c, FIELD);
    }

    private static String loadField(Context c, String field) {
        String packed = prefs(c).getString(field, null);
        if (packed == null) return null;
        try {
            String[] parts = packed.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, masterKey(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    static void clear(Context c) {
        prefs(c).edit().remove(FIELD).remove(NOTES_FIELD).remove("pc_host").remove("pc_port").apply();
    }

    static String hint(String key) {
        if (key == null || key.length() < 4) return "none";
        return "…" + key.substring(key.length() - 4);
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
