"""End-to-end test of the real extension in Chromium, with the screenshots used in the README.

* Loads the unpacked extension into Playwright's Chromium (run under xvfb-run on a server).
* Opens the app page, loads the built-in sample data, and drives the UI like a user:
  drag a card to another column, start and stop a timer, quick-add a task, save the open
  tabs as a workspace (three local test pages served from test/fixtures), open each view.
* Checks the stored state after every step and writes results/e2e.json, results/shot_*.png
  and the frames of assets/demo.gif.

    xvfb-run -a python3 scripts/e2e.py
"""
import functools
import http.server
import json
import pathlib
import shutil
import threading
import time

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
FRAMES = []
CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def serve_fixtures():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "test" / "fixtures"))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def state(page):
    return page.evaluate("chrome.storage.local.get('orbit_state_v1').then(r => r.orbit_state_v1)")


def shot(page, name, frame=True):
    page.evaluate("document.getElementById('toast')?.classList.remove('on')")
    page.wait_for_timeout(300)
    p = OUT / f"shot_{name}.png"
    page.screenshot(path=str(p))
    if frame:
        FRAMES.append(p)
    return p


def main():
    srv = serve_fixtures()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    prof = ROOT / ".e2e-profile"
    shutil.rmtree(prof, ignore_errors=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(prof), headless=False, viewport={"width": 1440, "height": 900}, device_scale_factor=1,
            args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext = sw.url.split("/")[2]
        check("service worker started", ext, ext)
        # three ordinary tabs to save as a workspace later
        for f in sorted((ROOT / "test" / "fixtures").glob("*.html")):
            ctx.new_page().goto(base + f.name)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(f"chrome-extension://{ext}/app.html#settings")
        page.wait_for_selector("#loadSample")
        page.click("#loadSample")
        page.wait_for_timeout(400)
        s = state(page)
        check("sample data loaded", len(s["projects"]) == 3 and len(s["tasks"]) == 13, f"{len(s['projects'])} projects, {len(s['tasks'])} tasks")

        # board
        page.click("[data-view=board]")
        page.wait_for_selector(".tcard")
        shot(page, "board")
        n_cards = page.locator(".tcard").count()
        check("board shows every task", n_cards == 13, f"{n_cards} cards")

        # drag "Compare with LS / LMMSE baselines" from To do to In progress
        src = page.locator(".tcard", has_text="Compare with LS / LMMSE baselines")
        dst = page.locator(".col[data-status=doing]")
        src.drag_to(dst)
        page.wait_for_timeout(400)
        t4 = next(t for t in state(page)["tasks"] if t["id"] == "t4")
        check("drag and drop moves the card", t4["status"] == "doing", t4["status"])
        shot(page, "board_after_drag")

        # start a timer on that card, let it run, stop it
        page.locator(".tcard", has_text="Compare with LS / LMMSE baselines").locator(".play").click()
        page.wait_for_timeout(2300)
        s = state(page)
        check("timer starts on the task", s["timer"] and s["timer"]["taskId"] == "t4")
        shot(page, "timer_running")
        page.click("#timerStop")
        page.wait_for_timeout(300)
        t4 = next(t for t in state(page)["tasks"] if t["id"] == "t4")
        dur = t4["log"][-1]["end"] - t4["log"][-1]["start"] if t4["log"] else 0
        check("stopping logs a session", len(t4["log"]) == 1 and 1500 < dur < 6000, f"{dur} ms")

        # quick add with the mini-syntax
        page.fill("#quick", "Write related-work section #ieee !high due:tomorrow ~3h @writing")
        page.press("#quick", "Enter")
        page.wait_for_timeout(300)
        new = [t for t in state(page)["tasks"] if t["title"] == "Write related-work section"]
        ok = new and new[0]["projectId"] == "p_paper" and new[0]["priority"] == "high" and new[0]["estimateH"] == 3 and new[0]["tags"] == ["writing"]
        check("quick add parses the mini-syntax", ok, json.dumps({k: new[0][k] for k in ("projectId", "priority", "estimateH", "tags")}) if new else "not found")

        # open the editor drawer
        page.locator(".tcard", has_text="Train CNN channel estimator").click()
        page.wait_for_selector(".drawer.on")
        shot(page, "editor")
        page.click("#dClose")

        # project filter + timeline
        page.locator(".projects a", has_text="MSc thesis").click()
        page.click("[data-view=timeline]")
        page.wait_for_selector("#timeline svg")
        bars = page.locator("#timeline svg rect[rx='6']").count()
        arrows = page.locator("#timeline svg path.arrow").count()
        check("timeline draws bars and dependency arrows", bars >= 12 and arrows >= 4, f"{bars} bar rects, {arrows} arrows")
        shot(page, "timeline")
        page.locator(".projects a", has_text="All projects").click()
        page.click("[data-view=timeline]")
        page.wait_for_timeout(300)
        shot(page, "timeline_all", frame=False)

        # time and report
        page.click("[data-view=time]")
        page.wait_for_selector("#timeBars svg")
        shot(page, "time")
        page.click("[data-view=report]")
        page.wait_for_selector("#donut svg")
        kpi = page.locator(".kpi .v").all_inner_texts()
        check("report shows KPIs", len(kpi) == 4, " | ".join(kpi))
        shot(page, "report")
        md = page.evaluate("import('./src/store.js').then(S => chrome.storage.local.get('orbit_state_v1').then(r => S.reportMarkdown(r.orbit_state_v1, S.weeklyReport(r.orbit_state_v1))))")
        (OUT / "weekly-report-example.md").write_text(md)
        check("weekly report exports Markdown", md.startswith("# Weekly report"), f"{len(md.splitlines())} lines")

        # workspaces: save the three local tabs
        page.click("[data-view=workspaces]")
        page.fill("#wsName", "Reading for chapter 3")
        page.select_option("#wsProject", "p_thesis")
        page.click("#wsSave")
        page.wait_for_timeout(400)
        ws = state(page)["workspaces"]
        check("workspace saves the open web tabs", ws and len(ws[0]["tabs"]) == 3, f"{len(ws[0]['tabs']) if ws else 0} tabs")
        shot(page, "workspaces")
        before = len(ctx.pages)
        page.locator(".ws .open").first.click()
        page.wait_for_timeout(1500)
        check("workspace reopens in a new window", len(ctx.pages) >= before + 3, f"{len(ctx.pages) - before} new tabs")

        # popup (opened as a page at popup size)
        pop = ctx.new_page()
        pop.set_viewport_size({"width": 384, "height": 600})
        pop.goto(f"chrome-extension://{ext}/popup.html")
        pop.wait_for_selector(".it")
        pop.locator(".it .play").first.click()
        pop.wait_for_timeout(1300)
        pop.screenshot(path=str(OUT / "shot_popup.png"))
        check("popup starts a timer", state(pop)["timer"] is not None)
        ctx.close()
    srv.shutdown()
    shutil.rmtree(prof, ignore_errors=True)
    # GIF from the main screenshots
    ims = [Image.open(f).convert("RGB").resize((960, 600), Image.LANCZOS) for f in FRAMES]
    pal = ims[0].quantize(colors=96)
    q = [im.quantize(palette=pal, dither=Image.NONE) for im in ims]
    (ROOT / "assets").mkdir(exist_ok=True)
    q[0].save(ROOT / "assets" / "demo.gif", save_all=True, append_images=q[1:], duration=1600, loop=0, optimize=True)
    json.dump({"checks": CHECKS, "passed": sum(c["ok"] for c in CHECKS), "total": len(CHECKS),
               "date": time.strftime("%Y-%m-%d %H:%M")}, open(OUT / "e2e.json", "w"), indent=1)
    print(f"{sum(c['ok'] for c in CHECKS)}/{len(CHECKS)} checks passed")


if __name__ == "__main__":
    main()
