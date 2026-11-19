// HELLO — the example ICEBREAKER module. Copy this folder to start yours.
//
// One feature = one module, with three faces that share one source of truth:
//   the `hello` command   (always: every click in ICEBREAKER is a command)
//   the HELLO app         (a screen, opened with `hello open`)
//   the HOME widget       (hello.count)
// The full API: docs/PLUGINS.md and src/plugins/api.ts in the ICEBREAKER repo.

export function activate(ib) {
  const { fmt, BOLD } = ib.lib;
  let greeted = 0;

  // ── the command ──
  ib.commands.register({
    name: "hello",
    summary: "says hello and counts your notes (HELLO module)",
    usage: "hello [name]      greet someone\nhello open        the HELLO app",
    examples: [["hello", "hello, you"], ["hello Case", "hello, Case"]],
    run(ctx) {
      if (ctx.args[0] === "open") return void ib.apps.open("hello");
      greeted++;
      ib.ui.redraw();
      const who = ctx.args.join(" ") || "netrunner";
      ctx.out(`${fmt.magenta("hello")}, ${fmt.bold(who)} — ${ib.vault.notes().length} notes in your vault\n`);
    },
  });

  // ── the app ──
  ib.apps.register({
    kind: "hello",
    title: "Hello",
    icon: "✦",
    launcher: true,
    create: () => ({
      kind: "hello",
      key: "hello",
      title: () => "Hello",
      onText(t) {
        if (t === "g") return ib.shell.run("hello"), true; // the UI runs commands
        return false;
      },
      render(ui, r) {
        const y = r.y + Math.floor(r.h / 2) - 1;
        ui.textCenter(r, y, `greeted ${greeted} times`, { fg: ui.c.accent, attrs: BOLD });
        ui.button(r.x + Math.floor(r.w / 2) - 5, y + 2, "greet (g)", () => {}, { cmd: "hello", tip: "runs: hello" });
      },
    }),
  });

  // ── the HOME widget ──
  ib.widgets.register({
    id: "count",
    title: "hello",
    description: "how many times you said hello (HELLO module)",
    size: { w: 3, h: 2 },
    min: { w: 2, h: 1 },
    render(ui, r) {
      ui.text(r.x + 1, r.y, `${greeted} hellos`, { fg: ui.c.fg }, r.w - 2);
      ui.hit(r, { cmd: "hello", tip: "click: hello" });
    },
    activate: () => ib.shell.run("hello open"),
  });
}

export function deactivate() {}
