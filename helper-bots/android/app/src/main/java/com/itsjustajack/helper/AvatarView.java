package com.itsjustajack.helper;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;

/** An agent's round avatar, drawn like the PC app: a coloured circle with the two-dot face. */
final class AvatarView extends View {
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint eye = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mark = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final String text;
    private final boolean selected;

    AvatarView(Context c, int color, String avatarText, boolean selected) {
        super(c);
        this.text = avatarText == null ? "" : avatarText;
        this.selected = selected;
        fill.setColor(color);
        ring.setColor(Ui.TEXT);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(Ui.dp(c, 2));
        eye.setColor(Ui.RAIL);
        mark.setColor(0xFF000000);
        mark.setTypeface(Typeface.DEFAULT_BOLD);
        mark.setTextAlign(Paint.Align.CENTER);
    }

    @Override
    protected void onDraw(Canvas cv) {
        float s = Math.min(getWidth(), getHeight());
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        if (selected) cv.drawCircle(cx, cy, s / 2f - ring.getStrokeWidth(), ring);
        float r = s / 2f - s * 0.1f;
        cv.drawCircle(cx, cy, r, fill);
        if (!text.isEmpty()) {
            mark.setTextSize(s * 0.36f);
            cv.drawText(text, cx, cy - (mark.descent() + mark.ascent()) / 2f, mark);
        } else {
            float er = s / 14f;
            float ey = cy - s * 0.05f;
            cv.drawCircle(cx - s * 0.12f, ey, er, eye);
            cv.drawCircle(cx + s * 0.12f, ey, er, eye);
        }
    }
}
