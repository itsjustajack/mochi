package com.itsjustajack.helper;

import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick-settings tile: one tap stops every Helper task. Safe direction, so no unlock needed. */
public class StopTile extends TileService {

    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        t.setLabel("Stop Helper");
        t.setState(Api.from(this) == null ? Tile.STATE_UNAVAILABLE : Tile.STATE_INACTIVE);
        t.updateTile();
    }

    @Override
    public void onClick() {
        Api api = Api.from(this);
        if (api == null) return;
        new Thread(() -> {
            String sub;
            try {
                api.stopAll();
                sub = "Stopped";
            } catch (Exception e) {
                sub = "Not running";
            }
            final String fs = sub;
            Tile t = getQsTile();
            if (t != null) {
                t.setSubtitle(fs);
                t.setState(Tile.STATE_INACTIVE);
                t.updateTile();
            }
            StatusWidget.refresh(this);
        }).start();
    }
}
