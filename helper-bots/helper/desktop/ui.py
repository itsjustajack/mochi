"""Helper's Windows screens (tkinter): compact, dark, Telegram-Desktop style.

Left rail: the Guild (one round avatar per agent), then Today, Inbox, Records and Settings.
Top bar: who you're talking to, the model light, "Needs your OK" count and Stop all (on every screen).
Chat: your messages, the agent's steps, and OK cards with Approve once / Always / No / Stop task.
"""

from __future__ import annotations

import datetime as dt
import sys
import tkinter as tk
import tkinter.font as tkfont
from tkinter import messagebox, simpledialog

from helper.desktop.engine import Engine

BG, RAIL, PANEL, CARD, LINE = "#17212b", "#0e1621", "#182533", "#1f2f3f", "#24364a"
TEXT, MUTED, ACCENT, GOOD, WARN, BAD = "#f5f5f5", "#7f91a4", "#5288c1", "#5fb878", "#e0b05f", "#e06c6c"
CHOICE_COLORS = {"do": GOOD, "ask": WARN, "never": BAD}
CHOICE_WORDS = {"do": "Do", "ask": "Ask me", "never": "Never"}


def fmt_time(ts: float | None) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%a %H:%M") if ts else ""


class Scroll(tk.Frame):
    """A vertically scrolling column of widgets."""

    def __init__(self, master, bg=BG):
        super().__init__(master, bg=bg)
        self.canvas = tk.Canvas(self, bg=bg, highlightthickness=0, bd=0)
        self.bar = tk.Scrollbar(self, orient="vertical", command=self.canvas.yview, width=10)
        self.inner = tk.Frame(self.canvas, bg=bg)
        self.win = self.canvas.create_window(0, 0, window=self.inner, anchor="nw")
        self.canvas.configure(yscrollcommand=self.bar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.bar.pack(side="right", fill="y")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self.win, width=e.width))
        self.canvas.bind("<Enter>", lambda e: self.canvas.bind_all("<MouseWheel>", self._wheel))
        self.canvas.bind("<Leave>", lambda e: self.canvas.unbind_all("<MouseWheel>"))

    def _wheel(self, e):
        self.canvas.yview_scroll(int(-e.delta / 120) or (-1 if e.delta > 0 else 1), "units")

    def clear(self):
        for w in self.inner.winfo_children():
            w.destroy()

    def to_bottom(self):
        self.update_idletasks()
        self.canvas.yview_moveto(1.0)


class HelperApp:
    def __init__(self, root: tk.Tk, engine: Engine):
        self.root, self.e = root, engine
        self.agent = self.e.settings.get("general", {}).get("default_agent", "organizer")
        if self.agent not in self.e.agents:
            self.agent = next(iter(self.e.agents))
        self.page = "chat"
        self.task_ids: dict[str, list[str]] = {}   # agent -> task ids shown in its chat
        self._shown_sig = None
        self._toasted: set[str] = set()
        self.fonts()
        root.title("Helper")
        root.configure(bg=BG)
        root.geometry("1040x700")
        root.minsize(820, 520)
        self.build()
        self.show_chat(self.agent)
        self.tick()
        for n in self.e.notes:
            self.toast(n)
        if self.e.first_run:
            self.toast("Welcome. Helper made its folder at " + str(self.e.home.root))

    # ------------------------------------------------------------ look

    def fonts(self):
        fam = "Segoe UI" if sys.platform == "win32" else "DejaVu Sans"
        self.f = tkfont.Font(family=fam, size=10)
        self.fb = tkfont.Font(family=fam, size=10, weight="bold")
        self.fs = tkfont.Font(family=fam, size=9)
        self.fh = tkfont.Font(family=fam, size=13, weight="bold")
        self.fbig = tkfont.Font(family=fam, size=16, weight="bold")

    def label(self, master, text, font=None, fg=TEXT, bg=None, wrap=0, **kw):
        return tk.Label(master, text=text, font=font or self.f, fg=fg, bg=bg or master["bg"], justify="left",
                        anchor="w", wraplength=wrap, **kw)

    def button(self, master, text, cmd, color=ACCENT, fg="white", small=False):
        b = tk.Label(master, text=text, font=self.fs if small else self.fb, fg=fg, bg=color, padx=10 if not small else 7,
                     pady=4 if not small else 2, cursor="hand2")
        b.bind("<Button-1>", lambda e: cmd())
        return b

    def avatar(self, master, agent, size=40, selected=False):
        c = tk.Canvas(master, width=size, height=size, bg=master["bg"], highlightthickness=0, cursor="hand2")
        if selected:
            c.create_oval(1, 1, size - 1, size - 1, outline=TEXT, width=2)
        c.create_oval(4, 4, size - 4, size - 4, fill=agent.get("color") or ACCENT, outline="")
        mark = agent.get("avatar") or ""
        if mark:
            c.create_text(size / 2, size / 2, text=mark, font=self.fb)
        else:  # the two-dot face
            r = size / 14
            for x in (size * 0.38, size * 0.62):
                c.create_oval(x - r, size * 0.45 - r, x + r, size * 0.45 + r, fill=RAIL, outline="")
        return c

    # ------------------------------------------------------------ frame

    def build(self):
        self.rail = tk.Frame(self.root, bg=RAIL, width=64)
        self.rail.pack(side="left", fill="y")
        self.rail.pack_propagate(False)
        right = tk.Frame(self.root, bg=BG)
        right.pack(side="left", fill="both", expand=True)
        top = tk.Frame(right, bg=PANEL, height=48)
        top.pack(fill="x")
        top.pack_propagate(False)
        self.title = self.label(top, "", self.fh, bg=PANEL)
        self.title.pack(side="left", padx=14)
        self.dot = self.label(top, "●", self.f, fg=MUTED, bg=PANEL)
        self.dot.pack(side="left")
        self.stop_btn = self.button(top, "Stop all", self.stop_all, color=BAD)
        self.stop_btn.pack(side="right", padx=10)
        self.ok_pill = self.button(top, "Needs your OK: 0", lambda: self.show_today(), color=LINE)
        self.ok_pill.pack(side="right", padx=4)
        self.body = tk.Frame(right, bg=BG)
        self.body.pack(fill="both", expand=True)
        self.draw_rail()

    def draw_rail(self):
        for w in self.rail.winfo_children():
            w.destroy()
        for a in self.e.agents.values():
            pub = a.public()
            av = self.avatar(self.rail, pub, 44, selected=self.page == "chat" and a.key == self.agent)
            av.pack(pady=(8, 0))
            av.bind("<Button-1>", lambda ev, k=a.key: self.show_chat(k))
            self.tip(av, a.name)
        tk.Frame(self.rail, bg=LINE, height=1).pack(fill="x", pady=10, padx=12)
        for icon, name, fn in (("☀", "Today", self.show_today), ("✉", "Inbox", self.show_inbox),
                               ("📖", "Records", self.show_records), ("⚙", "Settings", self.show_settings)):
            b = tk.Label(self.rail, text=icon, font=self.fbig, fg=TEXT if self.page == name.lower() else MUTED,
                         bg=RAIL, cursor="hand2")
            b.pack(pady=4)
            b.bind("<Button-1>", lambda ev, f=fn: f())
            self.tip(b, name)

    def tip(self, w, text):
        def show(_):
            self.title_hint = self.title.cget("text")
            self.title.configure(text=text)

        def hide(_):
            self.title.configure(text=getattr(self, "title_hint", self.title.cget("text")))
        w.bind("<Enter>", show)
        w.bind("<Leave>", hide)

    def clear_body(self, page, title):
        self.page = page
        for w in self.body.winfo_children():
            w.destroy()
        self.title.configure(text=title)
        self.title_hint = title
        self.draw_rail()

    # ------------------------------------------------------------ chat

    def show_chat(self, key):
        self.agent = key
        a = self.e.agents[key]
        self.clear_body("chat", a.name)
        self.chat = Scroll(self.body)
        self.chat.pack(fill="both", expand=True)
        bar = tk.Frame(self.body, bg=PANEL)
        bar.pack(fill="x")
        self.entry = tk.Text(bar, height=2, font=self.f, bg=CARD, fg=TEXT, insertbackground=TEXT, relief="flat",
                             wrap="word", padx=8, pady=6)
        self.entry.pack(side="left", fill="x", expand=True, padx=(10, 6), pady=8)
        self.entry.bind("<Return>", self.send)
        self.entry.bind("<Shift-Return>", lambda e: None)
        self.button(bar, "Send", lambda: self.send(None)).pack(side="right", padx=10)
        self.entry.focus_set()
        self._shown_sig = None
        self.render_chat()

    def send(self, event):
        if event is not None and event.state & 0x1:  # Shift+Enter = new line
            return None
        text = self.entry.get("1.0", "end").strip()
        if not text:
            return "break"
        code, res = self.e.call("POST", "/v1/tasks", {"goal": text, "agent": self.agent})
        if code == 201:
            self.task_ids.setdefault(res["agent"], []).append(res["id"])
            self.entry.delete("1.0", "end")
            if res["agent"] != self.agent:
                self.show_chat(res["agent"])
        else:
            self.toast(res.get("error", "Couldn't send that."))
        self.render_chat()
        return "break"

    def render_chat(self):
        if self.page != "chat":
            return
        tasks = [self.e.runner.tasks[t].public() for t in self.task_ids.get(self.agent, []) if t in self.e.runner.tasks]
        sig = [(t["id"], t["status"], len(t["events"])) for t in tasks]
        if sig == self._shown_sig:
            return
        self._shown_sig = sig
        self.chat.clear()
        if not tasks:
            a = self.e.agents[self.agent]
            box = tk.Frame(self.chat.inner, bg=BG)
            box.pack(fill="x", pady=40)
            self.avatar(box, a.public(), 64).pack()
            self.label(box, a.name, self.fh).pack(pady=(6, 2))
            self.label(box, a.role, self.fs, fg=MUTED, wrap=520).pack()
            self.label(box, "Type below. Start with @name to ask someone else, or \"from now on...\" to change "
                            "what this agent may do on its own.", self.fs, fg=MUTED, wrap=520).pack(pady=8)
        for t in tasks:
            for ev in t["events"]:
                self.render_event(t, ev)
        self.chat.to_bottom()

    def bubble(self, text, mine=False, color=None, small=False):
        row = tk.Frame(self.chat.inner, bg=BG)
        row.pack(fill="x", padx=12, pady=3)
        b = self.label(row, text, self.fs if small else self.f, fg=TEXT if not small else MUTED,
                       bg=color or (ACCENT if mine else CARD), wrap=560, padx=10, pady=6)
        b.pack(side="right" if mine else "left")
        return row

    def render_event(self, t, ev):
        k = ev["kind"]
        if k == "user":
            self.bubble(ev["text"], mine=True)
        elif k == "step":
            self.bubble(f"→ {ev['tool']}  " + ", ".join(f"{a}={v}" for a, v in ev["args"].items())[:200], small=True,
                        color=BG)
        elif k == "result":
            self.bubble(("✓ " if ev["ok"] else "✗ ") + ev["text"][:300], small=True, color=BG)
        elif k == "denied":
            self.bubble(f"Not done: {ev['reason']}", small=True, color=BG)
        elif k == "system":
            self.bubble(ev["text"], small=True, color=BG)
        elif k == "checklist":
            row = self.bubble(f"Checklist: \"{ev['label']}\" is now {CHOICE_WORDS[ev['choice']]}", small=True, color=BG)
            self.button(row, "Undo", lambda c=ev["change"]: self.undo_change(c), color=LINE, small=True).pack(side="left", padx=6)
        elif k == "approval":
            self.ok_card(ev["approval"])
        elif k == "end" and ev.get("text"):
            self.bubble(ev["text"], color=CARD if t["status"] == "done" else LINE)

    def ok_card(self, a):
        live = next((p for p in self.e.gate.approvals.pending() if p.id == a["id"]), None)
        card = tk.Frame(self.chat.inner, bg=CARD, highlightbackground=WARN if a.get("tainted") else LINE,
                        highlightthickness=1)
        card.pack(fill="x", padx=12, pady=6, anchor="w")
        self.label(card, f"{a['agent']} wants to: {a.get('job') or a['tool']}", self.fb, bg=CARD).pack(fill="x", padx=10, pady=(8, 2))
        for k, v in a["args"].items():
            self.label(card, f"{k}: {v}"[:400], self.fs, fg=MUTED, bg=CARD, wrap=600).pack(fill="x", padx=10)
        self.label(card, a["reason"], self.fs, fg=WARN if a.get("tainted") else MUTED, bg=CARD, wrap=600).pack(fill="x", padx=10, pady=2)
        row = tk.Frame(card, bg=CARD)
        row.pack(fill="x", padx=10, pady=8)
        if live is None:
            self.label(row, "Answered", self.fs, fg=MUTED, bg=CARD).pack(side="left")
            return
        self.button(row, "Approve once", lambda: self.answer(a["id"], "approve"), color=GOOD).pack(side="left")
        self.button(row, "Always", lambda: self.answer(a["id"], "always"), color=LINE).pack(side="left", padx=6)
        self.button(row, "No", lambda: self.answer(a["id"], "deny"), color=LINE).pack(side="left")
        self.button(row, "Stop task", lambda: self.answer(a["id"], "stop"), color=BAD).pack(side="right")

    def answer(self, aid, verdict):
        if verdict == "always" and not messagebox.askyesno(
                "Always?", "Approve this, and let this agent do this job on its own from now on?\n"
                           "You can change it back in Settings."):
            return
        code, res = self.e.call("POST", f"/v1/approvals/{aid}", {"verdict": verdict})
        if code != 200:
            self.toast(res.get("error", "That card was already answered."))
        self._shown_sig = None
        self.refresh_page()

    def undo_change(self, change_id):
        code, res = self.e.call("POST", f"/v1/checklists/undo/{change_id}")
        self.toast("Undone." if code == 200 else res.get("error", "Couldn't undo."))

    # ------------------------------------------------------------ Today (Calm mode)

    def show_today(self):
        self.clear_body("today", "Today")
        code, d = self.e.call("GET", "/v1/today")
        s = Scroll(self.body)
        s.pack(fill="both", expand=True)
        box = s.inner
        top = tk.Frame(box, bg=BG)
        top.pack(fill="x", padx=16, pady=12)
        self.button(top, "Just one thing", self.one_thing, color=GOOD).pack(side="left")
        tm = d["calm"]["too_much"]
        self.button(top, "I'm OK now" if tm else "Too much", lambda: self.set_calm(too_much=not tm),
                    color=LINE).pack(side="left", padx=8)
        self.button(top, "Brain dump", self.brain_dump, color=LINE).pack(side="left")
        self.button(top, "+ Reminder", self.add_reminder, color=LINE).pack(side="left", padx=8)
        if d.get("quiet"):
            self.label(top, "Quiet hours", self.fs, fg=MUTED).pack(side="right")
        self.label(box, "Needs you", self.fh).pack(fill="x", padx=16, pady=(6, 4))
        if not d["items"]:
            self.label(box, "Nothing right now. Nice.", fg=MUTED).pack(fill="x", padx=16)
        for it in d["items"]:
            card = tk.Frame(box, bg=CARD)
            card.pack(fill="x", padx=16, pady=4)
            self.label(card, it["text"], self.fb, bg=CARD, wrap=560).pack(fill="x", padx=10, pady=(8, 0))
            self.label(card, "First step: " + it["first_step"], self.fs, fg=MUTED, bg=CARD).pack(fill="x", padx=10)
            row = tk.Frame(card, bg=CARD)
            row.pack(fill="x", padx=10, pady=8)
            if it["kind"] == "reminder":
                self.button(row, "Done", lambda i=it["id"]: self.rem(i, "done"), color=GOOD, small=True).pack(side="left")
                for ch, word in (("1h", "1 hour"), ("tonight", "Tonight"), ("tomorrow", "Tomorrow"), ("at_pc", "At the PC")):
                    self.button(row, word, lambda i=it["id"], c=ch: self.rem(i, "snooze", c), color=LINE,
                                small=True).pack(side="left", padx=3)
                self.button(row, "Drop it", lambda i=it["id"]: self.rem(i, "drop"), color=LINE, small=True).pack(side="right")
            elif it["kind"] == "ok":
                self.button(row, "Open", lambda i=it["id"]: self.open_ok(i), small=True).pack(side="left")
            elif it["kind"] == "capture":
                self.button(row, "Sort now", self.sort_notes, small=True).pack(side="left")
        if d["held"]:
            self.label(box, f"{d['held']} more are held until you're ready. Nothing is lost.", self.fs,
                       fg=MUTED).pack(fill="x", padx=16, pady=8)
        code, done = self.e.call("GET", "/v1/done")
        if done.get("done"):
            self.label(box, "Done for you", self.fh).pack(fill="x", padx=16, pady=(16, 4))
            for r in reversed(done["done"][-12:]):
                row = tk.Frame(box, bg=BG)
                row.pack(fill="x", padx=16, pady=1)
                self.label(row, f"{fmt_time(r['ts'])}  {r['agent']}: {r['text'][:110]}", self.fs, fg=MUTED).pack(side="left")
                if r["can_undo"]:
                    self.button(row, "Undo", lambda i=r["id"]: self.undo_done(i), color=LINE, small=True).pack(side="right")

    def one_thing(self):
        code, d = self.e.call("GET", "/v1/today")
        t = d.get("one_thing")
        messagebox.showinfo("Just one thing", f"{t['text']}\n\nFirst step: {t['first_step']}" if t else
                            "Nothing needs you right now.")

    def set_calm(self, **kw):
        self.e.call("POST", "/v1/calm", kw)
        self.show_today()

    def rem(self, rid, what, choice=""):
        self.e.call("POST", f"/v1/reminders/{rid}/{what}", {"choice": choice})
        self.show_today()

    def open_ok(self, aid):
        ap = next((p for p in self.e.gate.approvals.pending() if p.id == aid), None)
        if ap:
            t = self.e.runner.tasks.get(ap.task_id)
            if t:
                self.task_ids.setdefault(t.agent.key, [])
                if t.id not in self.task_ids[t.agent.key]:
                    self.task_ids[t.agent.key].append(t.id)
                self.show_chat(t.agent.key)

    def add_reminder(self):
        text = simpledialog.askstring("Reminder", "What do you want reminding about?", parent=self.root)
        if text:
            self.e.call("POST", "/v1/reminders", {"text": text})
            self.show_today()

    def brain_dump(self):
        win = tk.Toplevel(self.root, bg=BG)
        win.title("Brain dump")
        self.label(win, "Dump everything. Messy is fine. You'll tick the real tasks after.", fg=MUTED).pack(padx=12, pady=8)
        txt = tk.Text(win, width=60, height=14, bg=CARD, fg=TEXT, insertbackground=TEXT, font=self.f, relief="flat")
        txt.pack(padx=12)

        def save():
            self.e.call("POST", "/v1/capture", {"text": txt.get("1.0", "end")})
            win.destroy()
            self.sort_notes()
        self.button(win, "Sort it", save).pack(pady=10)

    def sort_notes(self):
        code, d = self.e.call("GET", "/v1/capture")
        for note in d.get("notes", []):
            win = tk.Toplevel(self.root, bg=BG)
            win.title("Tick the real tasks")
            vars_ = []
            for i, it in enumerate(note["items"]):
                v = tk.BooleanVar(value=it["kind"] == "task")
                vars_.append(v)
                tk.Checkbutton(win, text=it["text"], variable=v, bg=BG, fg=TEXT, selectcolor=CARD, activebackground=BG,
                               activeforeground=TEXT, font=self.f, anchor="w").pack(fill="x", padx=12)

            def keep(n=note, vs=vars_, w=win):
                self.e.call("POST", f"/v1/capture/{n['id']}/sort", {"keep": [i for i, v in enumerate(vs) if v.get()]})
                w.destroy()
                if self.page == "today":
                    self.show_today()
            self.button(win, "Make reminders", keep).pack(pady=10)

    def undo_done(self, rid):
        code, res = self.e.call("POST", f"/v1/done/{rid}/undo")
        self.toast(res.get("text") if code == 200 else res.get("error", "Couldn't undo."))
        self.show_today()

    # ------------------------------------------------------------ Inbox

    def show_inbox(self):
        self.clear_body("inbox", "Inbox")
        code, d = self.e.call("GET", "/v1/inbox")
        s = Scroll(self.body)
        s.pack(fill="both", expand=True)
        box = s.inner
        if not d.get("linked"):
            self.label(box, "Gmail isn't linked yet.", self.fh).pack(fill="x", padx=16, pady=(16, 4))
            self.label(box, "Link it in Settings > Accounts. It starts read-only: Inbox can sort and draft, "
                            "and nothing is sent without your OK.", fg=MUTED, wrap=600).pack(fill="x", padx=16)
            self.button(box, "Go to Accounts", lambda: self.show_settings("accounts")).pack(anchor="w", padx=16, pady=10)
            return
        r = d.get("readout")
        head = tk.Frame(box, bg=BG)
        head.pack(fill="x", padx=16, pady=12)
        self.label(head, f"Morning readout {r['date']} {r['time']}" if r else "No readout yet today", self.fh).pack(side="left")
        self.button(head, "Make it now", self.readout_now, color=LINE, small=True).pack(side="right")
        if r:
            card = tk.Frame(box, bg=CARD)
            card.pack(fill="x", padx=16)
            self.label(card, r["text"], bg=CARD, wrap=640).pack(fill="x", padx=12, pady=10)
        self.button(box, "Show the piles", self.show_piles, color=LINE).pack(anchor="w", padx=16, pady=10)
        self.piles = tk.Frame(box, bg=BG)
        self.piles.pack(fill="x")

    def readout_now(self):
        self.e.call("POST", "/v1/inbox/readout")
        self.show_inbox()

    def show_piles(self):
        code, d = self.e.call("GET", "/v1/inbox/piles")
        for w in self.piles.winfo_children():
            w.destroy()
        if code != 200:
            self.label(self.piles, d.get("error", "Couldn't read email."), fg=BAD, wrap=600).pack(fill="x", padx=16)
            return
        for p, rows in d["piles"].items():
            if not rows or p == "newsletters":
                if rows:
                    self.label(self.piles, f"Newsletters: {len(rows)} (hidden)", self.fs, fg=MUTED).pack(fill="x", padx=16, pady=4)
                continue
            self.label(self.piles, f"{d['names'][p]} ({len(rows)})", self.fb, fg=BAD if p == "scam" else TEXT).pack(fill="x", padx=16, pady=(10, 2))
            for m in rows[:3 if p == "needs_you" else 10]:
                txt = f"{m['subject'] or '(no subject)'} — {m['from'][:40]}"
                if m["scam_signs"]:
                    txt += "\nWard: " + "; ".join(m["scam_signs"])
                self.label(self.piles, txt, self.fs, fg=TEXT if p != "scam" else WARN, wrap=640).pack(fill="x", padx=24)

    # ------------------------------------------------------------ Records (Ledger)

    def show_records(self, section="private"):
        self.clear_body("records", "Records")
        tabs = tk.Frame(self.body, bg=BG)
        tabs.pack(fill="x", padx=16, pady=8)
        for sec, word in (("private", "Your records"), ("ledger", "Story lore")):
            self.button(tabs, word, lambda s_=sec: self.show_records(s_), color=ACCENT if sec == section else LINE,
                        small=True).pack(side="left", padx=(0, 6))
        code, d = self.e.call("GET", f"/v1/{section}")
        s = Scroll(self.body)
        s.pack(fill="both", expand=True)
        drafts = [e for e in d["entries"] if e["status"] == "draft"]
        real = [e for e in d["entries"] if e["status"] == "canon"]
        if drafts:
            self.label(s.inner, "Drafts waiting for your tap", self.fh).pack(fill="x", padx=16, pady=(6, 4))
        for e in drafts:
            card = tk.Frame(s.inner, bg=CARD)
            card.pack(fill="x", padx=16, pady=3)
            self.label(card, f"{e['id']} · {e['type']} · {e['name']}", self.fb, bg=CARD).pack(fill="x", padx=10, pady=(6, 0))
            self.label(card, e["summary"], self.fs, fg=MUTED, bg=CARD, wrap=620).pack(fill="x", padx=10)
            row = tk.Frame(card, bg=CARD)
            row.pack(fill="x", padx=10, pady=6)
            self.button(row, "Make it real", lambda i=e["id"]: self.promote(section, i), color=GOOD, small=True).pack(side="left")
            self.button(row, "Retire", lambda i=e["id"]: self.retire(section, i), color=LINE, small=True).pack(side="left", padx=6)
        self.label(s.inner, "Real" if section == "private" else "Canon", self.fh).pack(fill="x", padx=16, pady=(12, 4))
        for e in real:
            self.label(s.inner, f"{e['id']} · {e['name']}: {e['summary']}", self.fs, wrap=660).pack(fill="x", padx=16, pady=1)
        if not real:
            self.label(s.inner, "Nothing yet.", fg=MUTED).pack(fill="x", padx=16)

    def promote(self, section, eid):
        code, res = self.e.call("POST", f"/v1/{section}/{eid}/promote")
        self.toast("Done." if code == 200 else res.get("error", ""))
        self.show_records(section)

    def retire(self, section, eid):
        why = simpledialog.askstring("Retire", "Why is it being retired?", parent=self.root)
        if why:
            self.e.call("POST", f"/v1/{section}/{eid}/retire", {"reason": why})
            self.show_records(section)

    # ------------------------------------------------------------ Settings

    def show_settings(self, tab="agents", agent=None):
        self.clear_body("settings", "Settings")
        tabs = tk.Frame(self.body, bg=BG)
        tabs.pack(fill="x", padx=16, pady=8)
        for key, word in (("agents", "Agents"), ("accounts", "Accounts"), ("calm", "Calm mode"),
                          ("phone", "Phone link"), ("content", "Content & rules")):
            self.button(tabs, word, lambda k=key: self.show_settings(k), color=ACCENT if key == tab else LINE,
                        small=True).pack(side="left", padx=(0, 6))
        body = tk.Frame(self.body, bg=BG)
        body.pack(fill="both", expand=True)
        getattr(self, f"settings_{tab}")(body, agent) if tab == "agents" else getattr(self, f"settings_{tab}")(body)

    def settings_agents(self, body, agent=None):
        code, d = self.e.call("GET", "/v1/checklists")
        left = tk.Frame(body, bg=PANEL, width=240)
        left.pack(side="left", fill="y")
        left.pack_propagate(False)
        agent = agent or (d["agents"][0]["agent"] if d["agents"] else None)
        for a in d["agents"]:
            row = tk.Frame(left, bg=CARD if a["agent"] == agent else PANEL, cursor="hand2")
            row.pack(fill="x")
            self.label(row, a["name"], self.fb, bg=row["bg"]).pack(fill="x", padx=12, pady=(6, 0))
            self.label(row, a["text"], self.fs, fg=MUTED, bg=row["bg"]).pack(fill="x", padx=12, pady=(0, 6))
            for w in (row, *row.winfo_children()):
                w.bind("<Button-1>", lambda e, k=a["agent"]: self.show_settings("agents", k))
        if not agent:
            return
        code, a = self.e.call("GET", f"/v1/checklists/{agent}")
        right = Scroll(body)
        right.pack(side="left", fill="both", expand=True)
        box = right.inner
        head = tk.Frame(box, bg=BG)
        head.pack(fill="x", padx=16, pady=10)
        self.label(head, a["name"], self.fh).pack(side="left")
        for p, word in (("careful", "Careful"), ("normal", "Normal"), ("handsoff", "Hands-off")):
            self.button(head, word, lambda p_=p: self.preset(agent, p_), color=LINE, small=True).pack(side="right", padx=3)
        for r in a["rows"]:
            row = tk.Frame(box, bg=CARD)
            row.pack(fill="x", padx=16, pady=2)
            self.label(row, r["label"], bg=CARD).pack(side="left", padx=10, pady=6)
            for ch in ("never", "ask", "do"):
                on = r["choice"] == ch
                self.button(row, CHOICE_WORDS[ch], lambda j=r["job"], c=ch: self.set_row(agent, j, c),
                            color=CHOICE_COLORS[ch] if on else LINE, fg="white" if on else MUTED,
                            small=True).pack(side="right", padx=2, pady=4)
        ns = a["not_sure_stop"]
        row = tk.Frame(box, bg=BG)
        row.pack(fill="x", padx=16, pady=12)
        self.label(row, "Not sure? Stop: after reading an email or web page, even Do jobs ask first.", self.fs,
                   fg=MUTED, wrap=460).pack(side="left")
        self.button(row, "On" if ns else "Off", lambda: self.set_not_sure(agent, not ns),
                    color=GOOD if ns else LINE, small=True).pack(side="right")
        if a["history"]:
            self.label(box, "Recent changes", self.fb).pack(fill="x", padx=16, pady=(8, 2))
            for h in reversed(a["history"][-8:]):
                row = tk.Frame(box, bg=BG)
                row.pack(fill="x", padx=16)
                self.label(row, f"{fmt_time(h['ts'])}  {h['why'][:80]}  ({h['by']})", self.fs, fg=MUTED).pack(side="left")
                if not h.get("undone"):
                    self.button(row, "Undo", lambda i=h["id"]: (self.undo_change(i), self.show_settings("agents", agent)),
                                color=LINE, small=True).pack(side="right")

    def set_row(self, agent, job, choice):
        code, res = self.e.call("POST", f"/v1/checklists/{agent}", {"job": job, "choice": choice})
        if code != 200:
            self.toast(res.get("error", ""))
        self.show_settings("agents", agent)

    def preset(self, agent, name):
        self.e.call("POST", f"/v1/checklists/{agent}", {"preset": name})
        self.show_settings("agents", agent)

    def set_not_sure(self, agent, on):
        self.e.call("POST", f"/v1/checklists/{agent}", {"not_sure_stop": on})
        self.show_settings("agents", agent)

    def settings_accounts(self, body):
        code, d = self.e.call("GET", "/v1/accounts")
        s = Scroll(body)
        s.pack(fill="both", expand=True)
        for acc in d["accounts"]:
            card = tk.Frame(s.inner, bg=CARD)
            card.pack(fill="x", padx=16, pady=6)
            head = tk.Frame(card, bg=CARD)
            head.pack(fill="x", padx=10, pady=8)
            state = (f"Linked{' as ' + acc['who'] if acc['who'] else ''}" +
                     (" · read-only" if acc["name"] == "gmail" and not acc["can_change"] else "")) if acc["linked"] else "Not linked"
            self.label(head, acc["label"], self.fh, bg=CARD).pack(side="left")
            self.label(head, "  " + state, self.fs, fg=GOOD if acc["linked"] else MUTED, bg=CARD).pack(side="left")
            if acc["linked"]:
                self.button(head, "Unlink", lambda n=acc["name"]: self.unlink(n), color=BAD, small=True).pack(side="right")
                if acc["name"] == "gmail" and not acc["can_change"]:
                    self.button(head, "Allow changes", lambda: self.link_gmail(True), color=LINE, small=True).pack(side="right", padx=6)
            else:
                self.button(head, "Link", lambda n=acc["name"]: self.link_gmail(False) if n == "gmail" else self.link_trello(),
                            small=True).pack(side="right")
            for j in acc["jobs"]:
                who = ", ".join(f"{u['name']} ({CHOICE_WORDS.get(u['choice'], '?')})" for u in j["agents"]) or "no agent"
                self.label(card, f"{j['label']}: {who}", self.fs, fg=MUTED, bg=CARD, wrap=640).pack(fill="x", padx=14)
            tk.Frame(card, bg=CARD, height=8).pack()
        self.label(s.inner, "Change who may do what in Settings > Agents. Passwords never touch Helper. "
                            "RoboForm isn't linked yet: whether it allows linking still needs checking.",
                   self.fs, fg=MUTED, wrap=640).pack(fill="x", padx=16, pady=10)

    def link_gmail(self, can_change):
        cid = simpledialog.askstring("Link Gmail", "Google client ID (from your free Google Cloud 'Desktop app' "
                                                   "client; see the README):", parent=self.root)
        if not cid:
            return
        sec = simpledialog.askstring("Link Gmail", "Client secret:", parent=self.root, show="•")
        if not sec:
            return
        code, res = self.e.call("POST", "/v1/accounts/gmail/link", {"client_id": cid, "client_secret": sec,
                                                                    "can_change": can_change})
        self.toast(res.get("text") or res.get("error", ""))

    def link_trello(self):
        key = simpledialog.askstring("Link Trello", "Your Trello API key (trello.com/power-ups/admin):", parent=self.root)
        if not key:
            return
        from helper.accounts import trello_token_url
        import webbrowser
        webbrowser.open(trello_token_url(key.strip()))
        tok = simpledialog.askstring("Link Trello", "Press Allow in the browser, then paste the token here:",
                                     parent=self.root, show="•")
        if tok:
            code, res = self.e.call("POST", "/v1/accounts/trello/link", {"key": key, "token": tok})
            self.toast(f"Linked Trello as {res.get('who')}" if code == 200 else res.get("error", ""))
            self.show_settings("accounts")

    def unlink(self, name):
        if messagebox.askyesno("Unlink", f"Remove Helper's sign-in for {name}?"):
            self.e.call("POST", f"/v1/accounts/{name}/unlink")
            self.show_settings("accounts")

    def settings_calm(self, body):
        code, c = self.e.call("GET", "/v1/calm")
        box = tk.Frame(body, bg=BG)
        box.pack(fill="both", expand=True, padx=16, pady=8)
        entries = {}
        for key, word in (("readout", "Morning readout time"), ("quiet_start", "Quiet hours start"),
                          ("quiet_end", "Quiet hours end")):
            row = tk.Frame(box, bg=BG)
            row.pack(fill="x", pady=4)
            self.label(row, word, width=22).pack(side="left")
            ent = tk.Entry(row, width=8, bg=CARD, fg=TEXT, insertbackground=TEXT, relief="flat", font=self.f)
            ent.insert(0, c[key])
            ent.pack(side="left")
            entries[key] = ent
        row = tk.Frame(box, bg=BG)
        row.pack(fill="x", pady=8)
        self.label(row, "Pip's quests and XP", width=22).pack(side="left")
        self.button(row, "On" if c["quests"] else "Off", lambda: self.set_calm_settings(quests=not c["quests"]),
                    color=GOOD if c["quests"] else LINE, small=True).pack(side="left")
        self.button(box, "Save times", lambda: self.set_calm_settings(**{k: e.get() for k, e in entries.items()})).pack(anchor="w", pady=10)

    def set_calm_settings(self, **kw):
        code, res = self.e.call("POST", "/v1/calm", kw)
        self.toast("Saved." if code == 200 else res.get("error", ""))
        self.show_settings("calm")

    def settings_phone(self, body):
        code, d = self.e.call("GET", "/v1/link")
        box = tk.Frame(body, bg=BG)
        box.pack(fill="both", expand=True, padx=16, pady=8)
        self.label(box, "Stub Link: your phone talks to this PC over home Wi-Fi (or Tailscale when away).",
                   fg=MUTED, wrap=640).pack(fill="x")
        row = tk.Frame(box, bg=BG)
        row.pack(fill="x", pady=8)
        self.label(row, "This PC's Wi-Fi address").pack(side="left")
        ent = tk.Entry(row, width=18, bg=CARD, fg=TEXT, insertbackground=TEXT, relief="flat", font=self.f)
        ent.insert(0, self.e.link_cfg.get("host", ""))
        ent.pack(side="left", padx=8)
        on = bool(self.e.link_cfg.get("enabled"))
        self.button(row, "Turn off" if on else "Turn on", lambda: self.set_link(not on, ent.get()),
                    color=LINE if on else GOOD, small=True).pack(side="left")
        state = "Running" if d.get("running") else ("On after restart" if on else "Off")
        self.label(box, f"Status: {state}", self.fs, fg=MUTED).pack(fill="x")
        if on:
            self.button(box, "Link a new phone", self.pair).pack(anchor="w", pady=10)
            if d.get("pairing"):
                p = d["pairing"]
                self.label(box, f"Pairing code: {p['code']}", self.fbig).pack(fill="x")
                self.label(box, "Type it in the Helper app on your phone. It works once, for 5 minutes.",
                           self.fs, fg=MUTED).pack(fill="x")
        self.label(box, "Linked devices", self.fb).pack(fill="x", pady=(12, 2))
        for dev in d.get("devices", []):
            row = tk.Frame(box, bg=BG)
            row.pack(fill="x")
            self.label(row, f"{dev['name']}  (last seen {fmt_time(dev.get('last_seen'))})", self.fs).pack(side="left")
            self.button(row, "Remove", lambda i=dev["id"]: self.remove_device(i), color=BAD, small=True).pack(side="right")
        if not d.get("devices"):
            self.label(box, "None yet.", self.fs, fg=MUTED).pack(fill="x")

    def set_link(self, on, host):
        import re
        if on and not re.fullmatch(r"[0-9A-Za-z.\-:]{3,64}", host.strip()):
            self.toast("Type this PC's Wi-Fi address first, for example 192.168.1.20.")
            return
        self.e.set_link(on, host)
        self.toast("Saved. Close and open Helper to apply it.")
        self.show_settings("phone")

    def pair(self):
        self.e.call("POST", "/v1/link/pair")
        self.show_settings("phone")

    def remove_device(self, dev_id):
        if messagebox.askyesno("Remove", "Remove this phone? It will need pairing again."):
            self.e.call("POST", f"/v1/link/devices/{dev_id}/remove")
            self.show_settings("phone")

    def settings_content(self, body):
        code, c = self.e.call("GET", "/v1/content")
        code, r = self.e.call("GET", "/v1/rules")
        box = tk.Frame(body, bg=BG)
        box.pack(fill="both", expand=True, padx=16, pady=8)
        self.label(box, "Content", self.fh).pack(fill="x")
        if c["locked"]:
            self.label(box, "Filtered, locked in content.toml.", fg=MUTED).pack(fill="x")
        else:
            un = c["mode"] == "unfiltered"
            row = tk.Frame(box, bg=BG)
            row.pack(fill="x", pady=6)
            self.label(row, f"Now: {'Unfiltered 18+ until ' + fmt_time(c['until']) if un else 'Filtered'}").pack(side="left")
            self.button(row, "Back to Filtered" if un else "Unfiltered 18+", lambda: self.set_content("filtered" if un else "unfiltered"),
                        color=LINE if un else BAD, small=True).pack(side="right")
            self.label(box, "Email and other outward agents always stay Filtered. Two limits hold in every mode: "
                            "nothing sexual involving minors, and nothing sexual about real people.",
                       self.fs, fg=MUTED, wrap=640).pack(fill="x")
        self.label(box, "Your rule docs", self.fh).pack(fill="x", pady=(16, 2))
        for d in r["rules"]:
            self.label(box, f"{d['name']}: {d['state']}", self.fs).pack(fill="x")
        if not r["rules"]:
            self.label(box, "None picked yet. List them as rule_docs in policy/allowlist.toml, then approve the policy.",
                       self.fs, fg=MUTED, wrap=640).pack(fill="x")
        self.label(box, "Drive folders agents may read", self.fh).pack(fill="x", pady=(16, 2))
        for k in r["knowledge"] or ["None yet."]:
            self.label(box, k, self.fs, fg=MUTED).pack(fill="x")

    def set_content(self, mode):
        if mode == "unfiltered" and not messagebox.askyesno("Unfiltered 18+", "Turn on Unfiltered 18+ for a while? "
                                                                             "It turns itself back off."):
            return
        self.e.call("POST", "/v1/content", {"mode": mode})
        self.show_settings("content")

    # ------------------------------------------------------------ every second

    def stop_all(self):
        code, s = self.e.call("GET", "/v1/status")
        if s.get("stopped"):
            self.e.call("POST", "/v1/start")
            self.toast("Helper can take new jobs again.")
        else:
            self.e.call("POST", "/v1/stop")
            self.toast("Stopped everything.")

    def refresh_page(self):
        if self.page == "chat":
            self.render_chat()

    def tick(self):
        try:
            code, s = self.e.call("GET", "/v1/status")
            pend = s.get("pending", 0)
            self.ok_pill.configure(text=f"Needs your OK: {pend}", bg=WARN if pend else LINE)
            self.dot.configure(fg=GOOD if s.get("model", {}).get("ok") else BAD)
            self.stop_btn.configure(text="Start again" if s.get("stopped") else "Stop all",
                                    bg=GOOD if s.get("stopped") else BAD)
            for a in self.e.gate.approvals.pending():
                if a.id not in self._toasted:
                    self._toasted.add(a.id)
                    t = self.e.runner.tasks.get(a.task_id)
                    if t and t.id not in self.task_ids.setdefault(t.agent.key, []):
                        self.task_ids[t.agent.key].append(t.id)
                    self.toast(f"{a.agent} needs your OK: {a.public()['job']}")
            self.refresh_page()
        finally:
            self.root.after(1000, self.tick)

    def toast(self, text):
        """A small note in the corner for a few seconds (like a Windows toast, without extra libraries)."""
        if not text:
            return
        w = tk.Toplevel(self.root, bg=CARD)
        w.overrideredirect(True)
        w.attributes("-topmost", True)
        self.label(w, text, bg=CARD, wrap=320, padx=14, pady=10).pack()
        w.update_idletasks()
        x = self.root.winfo_rootx() + self.root.winfo_width() - w.winfo_width() - 20
        y = self.root.winfo_rooty() + self.root.winfo_height() - w.winfo_height() - 70
        w.geometry(f"+{max(0, x)}+{max(0, y)}")
        w.after(4000, w.destroy)


def main(argv=None) -> int:
    root = tk.Tk()
    try:
        from pathlib import Path
        ico = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "helper.ico"
        if sys.platform == "win32" and ico.exists():
            root.iconbitmap(str(ico))
    except tk.TclError:
        pass
    try:
        engine = Engine()
    except Exception as e:  # noqa: BLE001
        messagebox.showerror("Helper", f"Helper couldn't start:\n{e}")
        return 1
    HelperApp(root, engine)

    def close():
        engine.stop()
        root.destroy()
    root.protocol("WM_DELETE_WINDOW", close)
    root.mainloop()
    return 0
