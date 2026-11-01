package com.itsjustajack.helper;

import android.content.Context;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/**
 * Helper's engine on the phone: the very same Python code as Helper.exe (helper/), carried inside
 * the app and started here. Screens call it with the same routes as the PC app (Engine.call), so the
 * gate, agents, checklists, Today, Inbox, Records and Settings are the same on both.
 */
final class PyEngine {
    private static PyObject mobile;

    private PyEngine() {}

    static synchronized PyObject start(Context c) {
        if (mobile != null) return mobile;
        Context app = c.getApplicationContext();
        Links.init(app);
        if (!Python.isStarted()) Python.start(new AndroidPlatform(app));
        PyObject m = Python.getInstance().getModule("helper.mobile");
        m.callAttr("use_android");
        m.callAttr("start", new File(app.getFilesDir(), "helper").getAbsolutePath());
        mobile = m;
        return m;
    }

    /** One screen request, like the PC app's Engine.call. Throws Api.HttpError for 4xx/5xx answers. */
    static JSONObject call(Context c, String method, String path, JSONObject body) throws IOException {
        String out = start(c).callAttr("call", method, path, body == null ? null : body.toString()).toString();
        try {
            JSONObject r = new JSONObject(out);
            int code = r.optInt("code", 500);
            JSONObject b = r.optJSONObject("body");
            if (b == null) b = new JSONObject();
            if (code >= 400) throw new Api.HttpError(code, b.optString("error", "Helper error " + code));
            return b;
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }
}
