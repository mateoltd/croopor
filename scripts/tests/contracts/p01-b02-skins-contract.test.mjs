import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFile(join(repository, path), "utf8");

test("native skin ingress never accepts a JavaScript-supplied path", async () => {
  const [commands, main, native, capabilities] = await Promise.all([
    read("apps/desktop/src/commands/mod.rs"),
    read("apps/desktop/src/main.rs"),
    read("frontend/src/native.ts"),
    read("apps/desktop/capabilities/main.json"),
  ]);

  assert.doesNotMatch(commands, /fn\s+read_skin_file\s*\(|path:\s*String/);
  assert.doesNotMatch(main, /commands::read_skin_file/);
  assert.doesNotMatch(native, /readNativeSkinFile|tauri\.dialog|dialog\?:|tauri:\/\/drag-/);
  assert.doesNotMatch(capabilities, /dialog:allow-open/);
  assert.match(commands, /fn\s+pick_skin_file\s*\(app:\s*AppHandle\)/);
  assert.match(commands, /fn\s+consume_skin_drop\s*\(\s*token:\s*String/);
  assert.match(main, /WindowEvent::DragDrop\(event\)/);
});

test("native skin drag uses one expiring Rust-owned admission token", async () => {
  const [nativeSkin, native, hook] = await Promise.all([
    read("apps/desktop/src/native_skin.rs"),
    read("frontend/src/native.ts"),
    read("frontend/src/views/accounts/use-saved-skin-native-drag-drop.ts"),
  ]);

  assert.match(nativeSkin, /const SKIN_DROP_TOKEN_TTL: Duration = Duration::from_secs\(30\);/);
  assert.match(nativeSkin, /pending: Option<PendingNativeSkinDrop>/);
  assert.match(nativeSkin, /file: File,[\s\S]*revision: NativeSkinFileRevision/);
  assert.match(nativeSkin, /NativeSkinFileAdmission::open\(path\)/);
  assert.doesNotMatch(nativeSkin, /spawn_blocking[\s\S]*NativeSkinFileAdmission::open/);
  assert.match(nativeSkin, /token\.len\(\) != 32/);
  assert.match(nativeSkin, /if pending\.token != token/);
  assert.match(nativeSkin, /state\.pending\.take\(\)/);
  assert.match(nativeSkin, /tokio::time::sleep\(SKIN_DROP_TOKEN_TTL\)/);
  assert.match(nativeSkin, /expiry_coordinator\.expire\(&expiry_token\)/);
  assert.match(native, /listen\('axial:desktop:skin-drag'/);
  assert.match(native, /invoke<unknown>\('consume_skin_drop', \{ token \}\)/);
  assert.doesNotMatch(native, /paths:\s*string\[\]/);
  assert.doesNotMatch(hook, /\.paths|Path|isPngPath/);
});
