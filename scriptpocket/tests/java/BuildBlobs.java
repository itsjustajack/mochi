import com.itsjustajack.scriptpocket.Injector;
import com.itsjustajack.scriptpocket.UserScript;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.stream.Stream;

/**
 * Test helper: turns every tests/scripts/*.user.js into the exact JavaScript the app would inject,
 * using the app's own parser and Injector. Output: one .blob.js per script plus meta.json.
 * Usage: java BuildBlobs <runtime.js> <scripts dir> <out dir>
 */
public class BuildBlobs {
    public static void main(String[] args) throws Exception {
        String tpl = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        Path out = Paths.get(args[2]);
        Files.createDirectories(out);
        JSONObject summary = new JSONObject();
        try (Stream<Path> files = Files.list(Paths.get(args[1]))) {
            for (Path p : (Iterable<Path>) files.sorted()::iterator) {
                String fn = p.getFileName().toString();
                if (!fn.endsWith(".user.js")) continue;
                String id = fn.replace(".user.js", "");
                String code = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
                UserScript s = UserScript.parse(code);
                JSONObject res = new JSONObject();
                JSONObject r = new JSONObject();
                r.put("mime", "text/plain");
                r.put("b64", java.util.Base64.getEncoder().encodeToString("héllo resource".getBytes(StandardCharsets.UTF_8)));
                res.put("greeting", r);
                String requires = id.contains("require") ? "var requiredLib = { answer: 42 };\n;\n" : "";
                String blob = Injector.build(tpl, Injector.metaJson(id, s, res, "test").toString(),
                        requires + "\n" + code, "TESTTOKEN", "k3y");
                Files.write(out.resolve(id + ".blob.js"), blob.getBytes(StandardCharsets.UTF_8));
                JSONObject m = new JSONObject();
                m.put("name", s.name);
                m.put("runAt", s.runAt);
                m.put("matches", s.matches.size());
                m.put("requires", s.requires.size());
                m.put("runsOn", s.runsOn());
                summary.put(id, m);
            }
        }
        System.out.println(summary.toString(1));
        // Version comparison spot checks.
        check(UserScript.compareVersions("1.10", "1.9") > 0, "1.10 > 1.9");
        check(UserScript.compareVersions("2.0", "2.0.0") == 0, "2.0 == 2.0.0");
        check(UserScript.compareVersions("1.0", "1.0.1") < 0, "1.0 < 1.0.1");
        check(UserScript.compareVersions("2024.10.01", "2024.9.30") > 0, "date versions");
        check(!UserScript.parse("alert(1)").hasHeader, "no header detected");
        System.out.println("java checks passed");
    }

    static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError("FAILED: " + what);
    }
}
