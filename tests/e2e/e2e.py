"""
End-to-end test for the SignBridge prototype (optional, developer-only).

Needs: Python 3, `pip install playwright`, `playwright install chromium`.
Run from the project folder:   python3 tests/e2e/e2e.py

What is REAL: the app code, localStorage/sessionStorage, getUserMedia (Chromium fake camera flags),
the router, the AI matching, charts, downloads.
What is STUBBED (see stubs.js): PeerJS (replaced by a BroadcastChannel version, so the two
"browsers" are two tabs of one Chromium), MediaPipe (hands come from window.__fakeHands),
speech recognition and speech synthesis. So this does NOT prove real WebRTC, real hand
tracking, real speech recognition or the public PeerJS broker work.
"""
import json, os, re, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PORT = 8123
BASE = f"http://localhost:{PORT}/index.html"
STUBS = open(os.path.join(HERE, "stubs.js"), encoding="utf-8").read()
PEER_STUB = STUBS.split("//=== PEER ===")[1].split("//=== MEDIAPIPE ===")[0]
MP_STUB = STUBS.split("//=== MEDIAPIPE ===")[1].split("//=== INIT ===")[0]
INIT = STUBS.split("//=== INIT ===")[1]

results, page_errors = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS  " if ok else "FAIL  ") + name + (f"   [{detail}]" if (detail and not ok) else ""), flush=True)


def wait(page, js, timeout=8000):
    try:
        page.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def txt(page, sel):
    el = page.query_selector(sel)
    return el.inner_text() if el else ""


def go(page, h):
    page.evaluate(f"location.hash = '{h}'")


def hash_starts(page, prefix, timeout=6000):
    return wait(page, f"location.hash.startsWith({json.dumps(prefix)})", timeout)


def register(page, name, email, pw, role):
    go(page, "#/register")
    page.wait_for_selector("#auth-form")
    page.fill("#name", name)
    page.fill("#email", email)
    page.fill("#password", pw)
    page.check(f"input[name=role][value={role}]")
    page.click("#submit")


def hand_js(fingers):
    return "__hand(" + json.dumps(fingers) + ")"


def section(title, fn, *a):
    print(f"\n== {title}")
    try:
        fn(*a)
    except Exception as e:  # keep going so one crash does not hide the rest
        check(f"{title}: section completed without crashing", False, repr(e)[:300])


def main():
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--directory", ROOT],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    tmp = tempfile.mkdtemp()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                              "--autoplay-policy=no-user-gesture-required"])
            ctx = browser.new_context(accept_downloads=True, permissions=["camera", "microphone"])
            ctx.add_init_script(INIT)
            # Block every non-local request, then add the stubs (later routes win).
            ctx.route(re.compile(r"^(?!http://localhost|data:|blob:).*"), lambda r: r.abort())
            ctx.route("**/peerjs.min.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=PEER_STUB))
            ctx.route("**/vision_bundle.mjs", lambda r: r.fulfill(
                status=200, content_type="text/javascript", headers={"access-control-allow-origin": "*"}, body=MP_STUB))

            def newpage():
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: page_errors.append(str(e)))
                return pg

            T, S, X = newpage(), newpage(), newpage()
            state = {}

            # ---------------------------------------------------------------
            def s_landing():
                T.goto(BASE)
                T.wait_for_selector("#app h1")
                check("landing page loads", "AI classroom" in txt(T, "#app h1"))
                check("landing warns gestures are placeholders", "placeholders" in txt(T, "#app"))

            def s_auth():
                register(T, "Tina", "tina@example.com", "123", "teacher")
                T.wait_for_function("document.querySelector('#form-error').textContent.length > 0")
                check("short password rejected", "6 characters" in txt(T, "#form-error"))
                T.fill("#password", "secret1")
                T.click("#submit")
                check("teacher registration lands on teacher home", hash_starts(T, "#/teacher") and wait(T, "document.querySelector('h1')?.textContent.includes('Welcome, Tina')"))
                T.click("#logout")
                check("logout returns to landing", hash_starts(T, "#/") and wait(T, "document.querySelector('#logout') === null"))
                go(T, "#/login")
                T.wait_for_selector("#auth-form")
                T.fill("#email", "tina@example.com")
                T.fill("#password", "wrongpass")
                T.click("#submit")
                T.wait_for_function("document.querySelector('#form-error').textContent.length > 0")
                check("wrong password shows error", "Wrong email or password" in txt(T, "#form-error"))
                T.fill("#password", "secret1")
                T.click("#submit")
                check("correct login works", hash_starts(T, "#/teacher"))
                T.click("#logout")
                register(T, "Tina Two", "TINA@example.com", "secret1", "teacher")
                T.wait_for_function("document.querySelector('#form-error').textContent.length > 0")
                check("duplicate email rejected (case-insensitive)", "already exists" in txt(T, "#form-error"))
                go(T, "#/login")
                T.wait_for_selector("#auth-form")
                T.fill("#email", "tina@example.com")
                T.fill("#password", "secret1")
                T.click("#submit")
                hash_starts(T, "#/teacher")

            def s_guards():
                go(T, "#/student")
                check("teacher cannot open student page", hash_starts(T, "#/teacher") and "for students" in txt(T, "#flash"))
                S.goto(BASE + "#/teacher")
                check("logged-out visitor is sent to login", hash_starts(S, "#/login"))

            def s_dictionary():
                go(T, "#/teacher/dictionary")
                check("hand tracking becomes ready on dictionary page", wait(T, "document.querySelector('#track-status')?.textContent.includes('ready')", 10000))
                T.click("#capture-btn")
                check("capture without a word is refused", "Type the word" in txt(T, "#dict-error"))
                T.fill("#sign-word", "water")
                T.evaluate("window.__fakeHands = []")
                T.click("#capture-btn")
                check("countdown is shown", wait(T, "document.querySelector('#countdown').textContent === '3'", 1500))
                check("capture with no hand shows an error", wait(T, "document.querySelector('#dict-error').textContent.includes('No hand')", 6000))
                T.evaluate("window.__fakeHands = [" + hand_js([True, True, False, True, True]) + "]")
                T.click("#capture-btn")
                check("one-hand sign saved and listed", wait(T, "document.querySelector('.sign[data-word=water]') !== null", 7000))
                T.fill("#sign-word", "Book")
                T.evaluate("window.__fakeHands = [" + hand_js([True] * 5) + ".map(p=>({...p,x:p.x-0.3})), " + hand_js([False] * 5) + ".map(p=>({...p,x:p.x+0.3}))]")
                T.click("#capture-btn")
                check("two-hand sign saved (lower-cased word)", wait(T, "document.querySelector('.sign[data-word=book]')?.textContent.includes('2 hands')", 7000))
                check("sign total shows 2", txt(T, "#sign-total") == "2")
                with T.expect_download() as dl:
                    T.click("#backup-btn")
                path = os.path.join(tmp, "backup.json")
                dl.value.save_as(path)
                data = json.load(open(path))
                check("backup file has both signs with valid vectors",
                      len(data["signs"]) == 2 and {len(s["landmarks"]) for s in data["signs"]} == {63, 126})
                T.click(".sign[data-word=water] button")
                check("delete removes a sign", wait(T, "document.querySelector('.sign[data-word=water]') === null"))
                T.set_input_files("#restore-input", path)
                check("restore brings the sign back", wait(T, "document.querySelector('.sign[data-word=water]') !== null") and "Restored 2" in txt(T, "#restore-msg"))
                bad = os.path.join(tmp, "bad.json")
                open(bad, "w").write("this is not json")
                T.set_input_files("#restore-input", bad)
                check("restoring a bad file shows an error", wait(T, "document.querySelector('#restore-msg').textContent.includes('not valid JSON')"))
                T.evaluate("window.__fakeHands = []")

            def s_start():
                go(T, "#/teacher")
                T.wait_for_selector("#start-class")
                T.click("#start-class")
                T.wait_for_selector("#class-code", timeout=8000)
                state["code"] = txt(T, "#class-code").strip()
                check("class code is 6 characters", re.fullmatch(r"[A-Z2-9]{6}", state["code"]))
                check("join link shows the code", f"?join={state['code']}" in txt(T, "#join-link"))
                check("teacher sees own camera", wait(T, "document.querySelector('#local-video').videoWidth > 0", 8000))
                check("nav is locked during a class", T.query_selector("#logout") is None)
                go(T, "#/teacher/dashboard")
                check("teacher cannot leave the class page by URL", hash_starts(T, "#/teacher/class"))

            def s_student_join():
                code = state["code"]
                S.goto(f"http://localhost:{PORT}/index.html?join={code}")
                check("join link without login goes to login", hash_starts(S, "#/login"))
                register(S, "Sam", "sam@example.com", "secret1", "student")
                check("student registration lands on join page", hash_starts(S, "#/student"))
                S.wait_for_selector("#join-code")
                check("join code from link is pre-filled", S.input_value("#join-code") == code)
                S.fill("#join-code", "")
                S.click("#join-btn")
                check("empty code is refused", "Enter the class code" in txt(S, "#join-error"))
                S.fill("#join-code", "ZZZZZZ")
                S.click("#join-btn")
                check("bad code shows a clear error", wait(S, "document.querySelector('#join-error').textContent.includes('No class found')", 6000))
                check("student stays on join page after bad code", "#/student" == S.evaluate("location.hash"))
                S.fill("#join-code", code.lower())
                S.click("#join-btn")
                check("student enters the class", hash_starts(S, "#/student/class", 8000))
                check("teacher sees the student joined", wait(T, "document.querySelector('#status').textContent.includes('Sam joined')", 8000))
                check("student sees teacher name", wait(S, "document.querySelector('#status').textContent.includes('Connected to Tina')"))
                check("student gets the video of the teacher", wait(S, "document.querySelector('#remote-video').srcObject && document.querySelector('#remote-video').videoWidth > 0", 8000))
                check("teacher gets the video of the student", wait(T, "document.querySelector('#remote-video').srcObject && document.querySelector('#remote-video').videoWidth > 0", 8000))
                check("dictionary reached the student", wait(S, "document.querySelector('#dict-count').textContent.includes('2 signs')"))
                check("student hand tracking ready", wait(S, "document.querySelector('#track-status').textContent.includes('ready')", 10000))

            def s_voice_to_sign():
                T.click("#btn-speak")
                check("speaking toggle changes the button", "Stop" in txt(T, "#btn-speak"))
                T.evaluate("window.__say('good mor', false)")
                check("interim text shown to teacher", wait(T, "document.querySelector('#interim').textContent === 'good mor'", 2000))
                T.evaluate("window.__say('Hello water please')")
                check("student sees three sign chips", wait(S, "document.querySelectorAll('#signs-log .chip').length === 3", 4000))
                kinds = S.evaluate("[...document.querySelectorAll('#signs-log .chip')].map(c => c.dataset.kind + ':' + c.dataset.label)")
                check("chips are builtin:hello, custom:water, spell:please", kinds == ["builtin:hello", "custom:water", "spell:please"], kinds)
                check("custom chip draws the teacher's saved sign", S.evaluate(
                    "(() => { const c = document.querySelector('.chip[data-kind=custom] canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; return d.some((v,i) => i % 4 === 3 && v > 0); })()"))
                check("student sees captions", txt(S, "#captions") == "Hello water please")
                check("teacher log shows what was said", "You said: Hello water please" in txt(T, "#teacher-log"))
                check("big stage plays the last sign (spelled word)", wait(S, "document.querySelector('#stage').dataset.kind === 'spell' && document.querySelector('#stage').dataset.label === 'please'", 6000))
                T.fill("#typed", "thank you")
                T.press("#typed", "Enter")
                check("typed sentence reaches the student", wait(S, "document.querySelector('#captions').textContent === 'thank you'", 3000))
                T.click("#btn-speak")
                check("speaking can be stopped", "Start" in txt(T, "#btn-speak"))

            def s_sign_to_voice():
                S.evaluate("window.__fakeHands = [" + hand_js([False] * 5) + "]")
                check("built-in sign (fist = yes) reaches teacher", wait(T, "document.querySelector('#recv-log').textContent.includes('Student signed: yes')", 5000))
                check("teacher hears the word", "yes" in T.evaluate("window.__spoken"))
                check("student sees own sign in their log", "yes" in txt(S, "#my-signs"))
                S.evaluate("window.__fakeHands = []")
                S.evaluate("window.__fakeHands = [" + hand_js([True, True, False, True, True]) + "]")
                check("teacher-taught one-hand sign (water) reaches teacher", wait(T, "document.querySelector('#recv-log').textContent.includes('Student signed: water')", 5000))
                check("teacher hears 'water'", "water" in T.evaluate("window.__spoken"))
                S.evaluate("window.__fakeHands = [" + hand_js([True] * 5) + ".map(p=>({...p,x:p.x-0.3})), " + hand_js([False] * 5) + ".map(p=>({...p,x:p.x+0.3}))]")
                check("teacher-taught two-hand sign (book) reaches teacher", wait(T, "document.querySelector('#recv-log').textContent.includes('Student signed: book')", 5000))
                S.evaluate("window.__fakeHands = []")
                T.uncheck("#voice-on")
                n = len(T.evaluate("window.__spoken"))
                S.evaluate("window.__fakeHands = [" + hand_js([True, False, False, False, False]) + "]")
                check("'good' arrives but is not read aloud when muted", wait(T, "document.querySelector('#recv-log').textContent.includes('Student signed: good')", 5000) and len(T.evaluate("window.__spoken")) == n)
                S.evaluate("window.__fakeHands = []")

            def s_student_speech():
                S.click("#btn-mic")
                S.evaluate("window.__say('I have a question')")
                check("student speech reaches the teacher", wait(T, "document.querySelector('#recv-log').textContent.includes('Student said: I have a question')", 4000))
                S.click("#btn-mic")

            def s_full_class():
                X.goto(BASE)
                register(X, "Sue", "sue@example.com", "secret1", "student")
                hash_starts(X, "#/student")
                X.wait_for_selector("#join-code")
                X.fill("#join-code", state["code"])
                X.click("#join-btn")
                check("a second student is refused", wait(X, "document.querySelector('#join-error').textContent.includes('already has a student')", 8000))

            def s_leave_rejoin():
                S.click("#btn-leave")
                check("student leaving returns to join page", hash_starts(S, "#/student") and not S.evaluate("location.hash").startswith("#/student/class"))
                check("teacher is told the student left", wait(T, "document.querySelector('#status').textContent.includes('left')", 5000))
                T.fill("#typed", "is anyone there")
                T.press("#typed", "Enter")
                check("message with nobody connected is marked not delivered", wait(T, "document.querySelector('#teacher-log').textContent.includes('not delivered')", 2000))
                S.wait_for_selector("#join-code")
                S.fill("#join-code", state["code"])
                S.click("#join-btn")
                check("student can rejoin with the same code", hash_starts(S, "#/student/class", 8000) and wait(T, "document.querySelector('#status').textContent.includes('Sam joined')", 8000))

            def s_end_class():
                T.click("#btn-end")
                check("teacher goes to the transcript", hash_starts(T, "#/teacher/transcript/", 5000))
                check("student is told the class ended and returns", wait(S, "location.hash === '#/student'", 6000) and "ended the class" in txt(S, "#flash"))
                T.wait_for_selector("#transcript")
                t = txt(T, "#transcript")
                for line in ["You said: Hello water please", "You said: thank you", "Student signed: yes", "Student signed: water",
                             "Student signed: book", "Student said: I have a question"]:
                    check(f"transcript has '{line}'", line in t)
                with T.expect_download() as dl:
                    T.click("#dl-transcript")
                path = os.path.join(tmp, "t.txt")
                dl.value.save_as(path)
                check("transcript downloads as text", "Hello water please" in open(path).read())
                T.evaluate("location.hash='#/teacher'")
                T.wait_for_selector("#start-class")
                check("class appears in past classes with a length", "Transcript" in txt(T, "#app table") and "not ended" not in txt(T, "#app table"))

            def s_dashboard():
                go(T, "#/teacher/dashboard")
                T.wait_for_selector("#stat-classes")
                check("dashboard: 1 class", txt(T, "#stat-classes") == "1")
                check("dashboard: 4 signs from student", txt(T, "#stat-signs") == "4", txt(T, "#stat-signs"))
                check("dashboard: teacher phrases counted", int(txt(T, "#stat-teacher")) >= 3)
                check("dashboard: student speech counted", txt(T, "#stat-student") == "1")
                check("dashboard: 3 SVG charts drawn", T.evaluate("document.querySelectorAll('svg.chart').length") == 3)
                check("dashboard: top signs chart lists a recognised sign", "yes" in T.evaluate("document.querySelector('svg.chart[aria-label=\"Most recognised signs\"]').textContent"))
                go(T, "#/teacher/transcript/nope")
                check("unknown transcript shows not found", wait(T, "document.querySelector('.error')?.textContent.includes('not found')"))

            def s_student_guard():
                go(S, "#/teacher/dashboard")
                check("student cannot open teacher pages", hash_starts(S, "#/student") and "for teachers" in txt(S, "#flash"))

            for title, fn in [
                ("landing", s_landing), ("accounts", s_auth), ("role guards", s_guards), ("dictionary", s_dictionary),
                ("start class", s_start), ("student join", s_student_join), ("voice to sign", s_voice_to_sign),
                ("sign to voice", s_sign_to_voice), ("student speech", s_student_speech), ("second student", s_full_class),
                ("leave and rejoin", s_leave_rejoin), ("end class + transcript", s_end_class), ("dashboard", s_dashboard),
                ("student role guard", s_student_guard),
            ]:
                section(title, fn)
            browser.close()
    finally:
        server.terminate()

    check("no uncaught page errors", not page_errors, "; ".join(page_errors)[:300])
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for n in failed:
        print("  FAILED:", n)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
