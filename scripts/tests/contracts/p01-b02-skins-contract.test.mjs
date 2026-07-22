import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFile(join(repository, path), "utf8");

test("native skin ingress never accepts a JavaScript-supplied path", async () => {
  const [commands, main, native, capabilities, desktopCargo] =
    await Promise.all([
      read("apps/desktop/src/commands/mod.rs"),
      read("apps/desktop/src/main.rs"),
      read("frontend/src/native.ts"),
      read("apps/desktop/capabilities/main.json"),
      read("apps/desktop/Cargo.toml"),
    ]);

  assert.doesNotMatch(commands, /fn\s+read_skin_file\s*\(|path:\s*String/);
  assert.doesNotMatch(main, /commands::read_skin_file/);
  assert.doesNotMatch(
    native,
    /readNativeSkinFile|tauri\.dialog|dialog\?:|tauri:\/\/drag-/,
  );
  assert.doesNotMatch(capabilities, /dialog:allow-open/);
  assert.match(commands, /fn\s+pick_skin_file\s*\(app:\s*AppHandle\)/);
  assert.match(
    commands,
    /spawn_blocking\(move \|\| \{[\s\S]*NativeSkinFileAdmission::open\(path\)/,
  );
  assert.match(commands, /fn\s+consume_skin_drop\s*\(\s*token:\s*String/);
  assert.match(main, /WindowEvent::DragDrop\(event\)/);
  assert.match(
    desktopCargo,
    /\[target\.'cfg\(windows\)'\.dependencies\][\s\S]*windows-sys/,
  );
});

test("native skin drag uses one expiring Rust-owned admission token", async () => {
  const [nativeSkin, native, hook] = await Promise.all([
    read("apps/desktop/src/native_skin.rs"),
    read("frontend/src/native.ts"),
    read("frontend/src/views/accounts/use-saved-skin-native-drag-drop.ts"),
  ]);

  assert.match(
    nativeSkin,
    /const SKIN_DROP_TOKEN_TTL: Duration = Duration::from_secs\(30\);/,
  );
  assert.match(nativeSkin, /pending: Option<PendingNativeSkinDrop>/);
  assert.match(
    nativeSkin,
    /file: File,[\s\S]*revision: NativeSkinFileRevision/,
  );
  assert.match(nativeSkin, /NativeSkinFileAdmission::open\(path\)/);
  assert.match(nativeSkin, /Semaphore::new\(1\)/);
  assert.match(nativeSkin, /try_acquire_owned\(\)/);
  assert.match(
    nativeSkin,
    /spawn_blocking\(move \|\| \{[\s\S]*NativeSkinFileAdmission::open\(path\)/,
  );
  assert.match(nativeSkin, /token\.len\(\) != 32/);
  assert.match(
    nativeSkin,
    /libc::O_CLOEXEC \| libc::O_NOFOLLOW \| libc::O_NONBLOCK/,
  );
  assert.match(
    nativeSkin,
    /FILE_FLAG_OPEN_REPARSE_POINT \| FILE_FLAG_OPEN_NO_RECALL \| FILE_FLAG_SEQUENTIAL_SCAN/,
  );
  assert.match(nativeSkin, /fn windows_path_has_local_disk_prefix/);
  assert.match(nativeSkin, /Prefix::Disk\(_\) \| Prefix::VerbatimDisk\(_\)/);
  assert.match(nativeSkin, /GetFileType\(handle\)[\s\S]*FILE_TYPE_DISK/);
  assert.match(
    nativeSkin,
    /FILE_ATTRIBUTE_REPARSE_POINT[\s\S]*FILE_ATTRIBUTE_DIRECTORY[\s\S]*FILE_ATTRIBUTE_OFFLINE[\s\S]*FILE_ATTRIBUTE_RECALL_ON_OPEN[\s\S]*FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS/,
  );
  assert.match(nativeSkin, /FileBasicInfo/);
  assert.match(nativeSkin, /FileStandardInfo/);
  assert.match(nativeSkin, /FILE_NAME_OPENED \| VOLUME_NAME_GUID/);
  assert.match(nativeSkin, /path\.starts_with\(r"\\\\\?\\Volume\{"\)/);
  assert.match(
    nativeSkin,
    /volume_serial_number: metadata\.volume_serial_number\(\)/,
  );
  assert.match(nativeSkin, /file_index: metadata\.file_index\(\)/);
  assert.match(nativeSkin, /last_write_time: metadata\.last_write_time\(\)/);
  assert.match(nativeSkin, /file_size: metadata\.file_size\(\)/);
  const beginDrag = nativeSkin.slice(
    nativeSkin.indexOf("fn begin_drag"),
    nativeSkin.indexOf("fn drag_eligible"),
  );
  const beginDrop = nativeSkin.slice(
    nativeSkin.indexOf("fn begin_drop"),
    nativeSkin.indexOf("fn cancel_drag"),
  );
  const cancelDrag = nativeSkin.slice(
    nativeSkin.indexOf("fn cancel_drag"),
    nativeSkin.indexOf("fn publish"),
  );
  assert.doesNotMatch(beginDrag, /pending\s*=/);
  assert.match(beginDrop, /state\.pending\s*=\s*None/);
  assert.doesNotMatch(cancelDrag, /pending\s*=/);
  assert.doesNotMatch(cancelDrag, /advance_generation/);
  assert.match(
    nativeSkin,
    /Some\("Another skin file is still being checked\."\)[\s\S]*Some\("Another skin file is still being checked\."\)/,
  );
  assert.match(nativeSkin, /if pending\.token != token/);
  assert.match(nativeSkin, /state\.pending\.take\(\)/);
  assert.match(nativeSkin, /tokio::time::sleep\(SKIN_DROP_TOKEN_TTL\)/);
  assert.match(nativeSkin, /expiry_coordinator\.expire\(&expiry_token\)/);
  assert.match(native, /listen\('axial:desktop:skin-drag'/);
  assert.match(native, /invoke<unknown>\('consume_skin_drop', \{ token \}\)/);
  assert.doesNotMatch(native, /paths:\s*string\[\]/);
  assert.doesNotMatch(hook, /\.paths|Path|isPngPath/);
});
