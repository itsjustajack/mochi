package com.itsjustajack.helper;

/**
 * Pip's free-text answers on the phone. The on-phone AI model plugs in here next; until then Pip
 * answers by simple rules and says what it can already do. The model only ever proposes: Pip's
 * checklist (Local.act) still decides Do, Ask me or Never.
 */
final class Ai {
    private Ai() {}

    static String reply(String goal) {
        return "I can't chat freely yet: the on-phone AI is coming in the next update. Right now I can:\n"
                + "• \"remind me to call the dentist tomorrow\"\n"
                + "• \"remember that the boiler service is in March\" (goes in your records)\n"
                + "• \"one thing\" (the easiest next step)\n"
                + "• \"too much\" (only the top 3 show)\n"
                + "• \"what's on\" (your reminders)\n"
                + "• \"from now on ask me before adding reminders\"";
    }
}
