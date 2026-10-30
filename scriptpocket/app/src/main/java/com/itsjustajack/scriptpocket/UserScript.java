package com.itsjustajack.scriptpocket;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The ==UserScript== header of a script, parsed. Plain Java so it can be tested off-device. */
public class UserScript {
    private static final Pattern BLOCK = Pattern.compile(
            "//\\s*==UserScript==\\s*\\n(.*?)//\\s*==/UserScript==", Pattern.DOTALL);
    private static final Pattern LINE = Pattern.compile("^\\s*//\\s*@([\\w:.\\-]+)(?:[ \\t]+(.*?))?\\s*$");

    public boolean hasHeader;
    public String metaStr = "";
    public String name = "";
    public String namespace = "";
    public String version = "";
    public String description = "";
    public String author = "";
    public String runAt = "document-idle";
    public boolean noframes;
    public String updateURL = "";
    public String downloadURL = "";
    public String homepage = "";
    public final List<String> matches = new ArrayList<>();
    public final List<String> includes = new ArrayList<>();
    public final List<String> excludes = new ArrayList<>();
    public final List<String> excludeMatches = new ArrayList<>();
    public final List<String> requires = new ArrayList<>();
    public final List<String> grants = new ArrayList<>();
    public final Map<String, String> resources = new LinkedHashMap<>();

    public static UserScript parse(String code) {
        UserScript s = new UserScript();
        String src = code == null ? "" : code.replace("\r\n", "\n").replace('\r', '\n');
        Matcher m = BLOCK.matcher(src);
        if (m.find()) {
            s.hasHeader = true;
            s.metaStr = m.group(0);
            for (String line : m.group(1).split("\n")) {
                Matcher lm = LINE.matcher(line);
                if (!lm.matches()) continue;
                String key = lm.group(1).toLowerCase();
                String val = lm.group(2) == null ? "" : lm.group(2).trim();
                s.apply(key, val);
            }
        }
        if (s.name.isEmpty()) s.name = "Untitled script";
        return s;
    }

    private void apply(String key, String val) {
        switch (key) {
            case "name": if (name.isEmpty()) name = val; break;
            case "namespace": namespace = val; break;
            case "version": version = val; break;
            case "description": if (description.isEmpty()) description = val; break;
            case "author": author = val; break;
            case "match": if (!val.isEmpty()) matches.add(val); break;
            case "include": if (!val.isEmpty()) includes.add(val); break;
            case "exclude": if (!val.isEmpty()) excludes.add(val); break;
            case "exclude-match": if (!val.isEmpty()) excludeMatches.add(val); break;
            case "require": if (!val.isEmpty()) requires.add(val); break;
            case "grant": if (!val.isEmpty()) grants.add(val); break;
            case "noframes": noframes = true; break;
            case "updateurl": updateURL = val; break;
            case "downloadurl": case "installurl": downloadURL = val; break;
            case "homepage": case "homepageurl": case "website": case "source": homepage = val; break;
            case "run-at":
                switch (val) {
                    case "document-start": case "document-body": case "document-end": case "document-idle":
                        runAt = val; break;
                    default: runAt = "document-idle";
                }
                break;
            case "resource": {
                String[] parts = val.split("\\s+", 2);
                if (parts.length == 2) resources.put(parts[0], parts[1].trim());
                break;
            }
            default: break;
        }
    }

    /** Where this script runs, as a short human readable line. */
    public String runsOn() {
        List<String> all = new ArrayList<>(matches);
        all.addAll(includes);
        if (all.isEmpty()) return "every site";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < all.size() && i < 3; i++) {
            if (i > 0) b.append(", ");
            b.append(all.get(i));
        }
        if (all.size() > 3) b.append(" +").append(all.size() - 3).append(" more");
        return b.toString();
    }

    /** Compares versions like "1.10.2" and "1.9"; returns >0 when a is newer than b. */
    public static int compareVersions(String a, String b) {
        String[] pa = (a == null ? "" : a).split("[.\\-_ ]");
        String[] pb = (b == null ? "" : b).split("[.\\-_ ]");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            String x = i < pa.length ? pa[i] : "0";
            String y = i < pb.length ? pb[i] : "0";
            int c;
            Long nx = number(x), ny = number(y);
            if (nx != null && ny != null) c = Long.compare(nx, ny);
            else c = x.compareTo(y);
            if (c != 0) return c;
        }
        return 0;
    }

    private static Long number(String s) {
        if (s.isEmpty()) return 0L;
        if (s.length() > 18) return null;
        for (int i = 0; i < s.length(); i++) if (!Character.isDigit(s.charAt(i))) return null;
        return Long.parseLong(s);
    }
}
