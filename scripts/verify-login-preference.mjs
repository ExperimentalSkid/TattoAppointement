import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Real preference handler and client components with local browser/React fixtures.
// These checks use no server, database, network connection or production data.
const state = { scopes: new Map(), scope: "", cursor: 0, events: [], preferenceStatus: 200 };
globalThis.tintaLoginPreferenceVerification = state;
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
async function sourceModule(relative, imports = {}, jsx = false) {
  const source = (await readFile(new URL(`../${relative}`, import.meta.url), "utf8"))
    .replace(/^import\s+["'][^"']+\.css["'];?\r?\n/gm, "");
  return moduleUrl(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
  } }).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(imports[name], `Unreviewed verification import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  }));
}
const originalEnv = { NODE_ENV: process.env.NODE_ENV, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL };
const originalGlobals = Object.fromEntries(["fetch", "window", "FormData"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const origin = "https://login-preference-verification.example";
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function installGlobal(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
function nodes(element, predicate) {
  if (Array.isArray(element)) return element.flatMap(child => nodes(child, predicate));
  if (!element || typeof element !== "object") return [];
  return [...(predicate(element) ? [element] : []), ...nodes(element.props?.children, predicate)];
}
function render(scope, Component, props) { state.scope = scope; state.cursor = 0; return Component(props); }

try {
  process.env.NODE_ENV = "production"; process.env.BETTER_AUTH_URL = origin;
  const preferenceModule = await sourceModule("src/lib/login-preference.ts");
  const preferences = await import(preferenceModule);
  const nextBridge = moduleUrl(`import next from ${JSON.stringify(new URL("../node_modules/next/server.js", import.meta.url).href)}; export const NextResponse = next.NextResponse;`);
  const { POST } = await import(await sourceModule("src/app/api/preferences/login/route.ts", { "next/server": nextBridge, "@/lib/login-preference": preferenceModule }));
  const validHeaders = { Origin: origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
  const request = (body, headers = validHeaders) => new Request(`${origin}/api/preferences/login`, { method: "POST", headers, body });
  for (const remember of [false, true]) check(preferences.parseLoginPreference({ remember }), { remember });
  for (const invalid of [null, [], {}, { remember: 1 }, { remember: "true" }, { remember: false, extra: "private" }, { other: true }]) {
    check(preferences.parseLoginPreference(invalid), null);
  }
  for (const remember of [true, false]) {
    const response = await POST(request(JSON.stringify({ remember })));
    check(response.status, 200); check(await response.json(), { ok: true, remember });
    check(response.headers.get("cache-control"), "private, no-store");
    const cookie = response.headers.getSetCookie().at(-1);
    for (const attribute of [/HttpOnly/i, /SameSite=lax/i, /Secure/i, /Path=\//i]) check(attribute.test(cookie), true);
    check(cookie.includes(`Max-Age=${remember ? preferences.REMEMBER_LOGIN_SECONDS : 0}`), true);
    check(cookie.startsWith(`${preferences.LOGIN_PREFERENCE_COOKIE}=${remember ? "1" : ""};`), true);
  }
  for (const headers of [
    { ...validHeaders, Origin: "https://another.example" },
    { "Content-Type": "application/json" },
    { ...validHeaders, "Sec-Fetch-Site": "cross-site" },
  ]) {
    const response = await POST(request('{"remember":true}', headers));
    check(response.status, 403); check(response.headers.has("set-cookie"), false, "Rejected origins cannot change the login preference");
  }
  for (const body of ["", "null", "false", "{}", '{"remember":"true"}', '{"remember":false,"extra":true}', "not-json"]) {
    const response = await POST(request(body)); check(response.status, 400); check(response.headers.has("set-cookie"), false);
  }
  check((await POST(request('{"remember":true}', { ...validHeaders, "Content-Type": "text/plain" }))).status, 400);
  check((await POST(request('{"remember":true}', { ...validHeaders, "Content-Length": "129" }))).status, 413);
  let cancelled = false;
  const oversized = new Request(`${origin}/api/preferences/login`, { method: "POST", headers: validHeaders, duplex: "half", body: new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(129))); }, cancel() { cancelled = true; },
  }) });
  check((await POST(oversized)).status, 413); check(cancelled, true, "Undeclared oversized streams are cancelled at the byte limit");

  const fixtures = moduleUrl(`
    const state = globalThis.tintaLoginPreferenceVerification;
    function slot(initial) { const index = state.cursor++; let slots = state.scopes.get(state.scope); if (!slots) state.scopes.set(state.scope, slots = []);
      if (!(index in slots)) slots[index] = initial; return [slots, index]; }
    export const useState = initial => { const [slots, index] = slot(initial); return [slots[index], value => { slots[index] = value; }]; };
    export const useRef = initial => { const [slots, index] = slot({ current: initial }); return slots[index]; };
    export const useCallback = callback => callback; export const useId = () => "fixture-" + state.scope;
    export const createContext = current => { const context = { current }; context.Provider = { context }; return context; };
    export const useContext = context => context.current;
    export const jsx = (type, props) => { if (type?.context) type.context.current = props.value; return { type, props }; };
    export const jsxs = jsx; export const Fragment = "fragment";
    export const AuthFeedback = props => ({ type: "feedback", props }); export const emitDiagnostic = () => null;
    export const authClient = {
      signIn: { email: async body => { state.events.push("email:" + body.rememberMe); return { data: { user: { language: "en" } } }; },
        social: async () => { state.events.push("google"); return {}; } },
      signUp: { email: async body => { state.events.push("signup"); state.signupBody = body; return {}; } },
      linkSocial: async () => { state.events.push("google-link"); return {}; }
    };
  `);
  const choiceModule = await sourceModule("src/components/remember-login-choice.tsx", { react: fixtures, "react/jsx-runtime": fixtures }, true);
  const { RememberLoginChoice } = await import(choiceModule);
  const clientImports = { react: fixtures, "react/jsx-runtime": fixtures, "@/lib/auth-client": fixtures, "@/components/auth-feedback": fixtures,
    "@/lib/client-diagnostics": fixtures, "@/components/remember-login-choice": choiceModule, "@/lib/login-preference": preferenceModule };
  const { AuthForm } = await import(await sourceModule("src/components/auth-form.tsx", clientImports, true));
  const { GoogleSignInButton, GoogleLinkButton } = await import(await sourceModule("src/components/google-sign-in-button.tsx", clientImports, true));
  installGlobal("window", { location: { replace: path => state.events.push(`navigate:${path}`) } });
  installGlobal("FormData", class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } });
  installGlobal("fetch", async (url, options) => {
    if (url === "/api/preferences/login") {
      const { remember } = JSON.parse(options.body); state.events.push(`preference:${remember}`);
      check(options.credentials, "same-origin"); check(options.redirect, "error");
      if (state.deferredPreference) return new Promise(resolve => { state.resolvePreference = () => resolve(Response.json({ ok: true, remember })); });
      return Response.json(state.preferenceStatus === 200 ? { ok: true, remember } : { error: "fixture" }, { status: state.preferenceStatus });
    }
    check(url, "/api/preferences/language"); state.events.push("language"); return Response.json({ ok: true });
  });
  let caseIndex = 0;
  function choice(remember) {
    const scope = `choice-${caseIndex++}`;
    const props = { locale: "en", children: ["Google choice", "Email choice"] };
    let element = render(scope, RememberLoginChoice, props);
    const checkboxes = nodes(element, node => node.type === "input" && node.props.type === "checkbox");
    check(checkboxes.length, 1, "One checkbox is shared by both authentication methods"); check(checkboxes[0].props.checked, false, "Each new login page starts unchecked");
    if (remember) { checkboxes[0].props.onChange({ target: { checked: true } }); element = render(scope, RememberLoginChoice, props); }
    state.events = []; state.preferenceStatus = 200;
    return () => render(scope, RememberLoginChoice, props);
  }
  const copy = { name: "Name", email: "Email", password: "Password", invalid: "Invalid credentials", signupError: "Signup failed", signIn: "Sign in", signUp: "Sign up" };
  const submitEvent = { preventDefault() {}, currentTarget: { fields: { email: "artist@example.com", password: "fixture-password", name: "Fixture artist" } } };
  const googleButton = link => {
    const scope = `google-${caseIndex++}`;
    const wrapper = render(`${scope}-wrapper`, link ? GoogleLinkButton : GoogleSignInButton, { locale: "en" });
    return nodes(render(scope, wrapper.type, wrapper.props), node => node.type === "button")[0];
  };
  for (const remember of [false, true]) {
    choice(remember);
    await render(`email-${caseIndex++}`, AuthForm, { mode: "sign-in", copy, locale: "en" }).props.onSubmit(submitEvent);
    check(state.events, [`preference:${remember}`, `email:${remember}`, "language", "navigate:/calendar"], "Email authenticates only after the shared choice is confirmed");
    choice(remember); await googleButton(false).props.onClick();
    check(state.events, [`preference:${remember}`, "google"], "Google authenticates only after the same shared choice is confirmed");
  }
  choice(true);
  await render(`signup-${caseIndex++}`, AuthForm, { mode: "sign-up", copy, locale: "en" }).props.onSubmit(submitEvent);
  check(state.events, ["preference:true", "signup", "language", "navigate:/calendar"]);
  check(state.signupBody, { name: "Fixture artist", email: "artist@example.com", password: "fixture-password" }, "Signup uses supported SDK fields and the confirmed server preference");
  for (const method of ["email", "google"]) {
    const rerenderChoice = choice(true); state.preferenceStatus = 503;
    if (method === "email") await render(`failed-email-${caseIndex++}`, AuthForm, { mode: "sign-in", copy, locale: "en" }).props.onSubmit(submitEvent);
    else await googleButton(false).props.onClick();
    check(state.events, ["preference:true"], "A failed preference write cannot fall through to authentication");
    check(nodes(rerenderChoice(), node => node.type === "input")[0].props.disabled, false, "Failure unlocks the shared choice for retry");
  }
  const rerenderChoice = choice(false); state.deferredPreference = true;
  const inFlight = render(`locked-email-${caseIndex++}`, AuthForm, { mode: "sign-in", copy, locale: "en" }).props.onSubmit(submitEvent);
  check(nodes(rerenderChoice(), node => node.type === "input")[0].props.disabled, true);
  await googleButton(false).props.onClick();
  check(state.events, ["preference:false"], "Email and Google cannot start competing preference writes");
  state.deferredPreference = false; state.resolvePreference(); await inFlight;
  state.events = []; await googleButton(true).props.onClick();
  check(state.events, ["google-link"], "Connecting Google never changes the device login preference");
  await assert.rejects(() => preferences.persistLoginPreference(false, async () => Response.json({ ok: true, remember: true })));
  checks++;
  console.log(`${checks} login preference checks passed (strict route and shared authentication choice).`);
} finally {
  for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  for (const [name, descriptor] of Object.entries(originalGlobals)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  delete globalThis.tintaLoginPreferenceVerification;
}
