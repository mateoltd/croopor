use serde::Serialize;
use std::fs::{File, Metadata};
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::dpi::PhysicalPosition;
use tauri::{DragDropEvent, Emitter, WebviewWindow};
use uuid::Uuid;

const SKIN_FILE_MAX_BYTES: u64 = 256 * 1024;
const SKIN_DROP_TOKEN_TTL: Duration = Duration::from_secs(30);
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const NATIVE_SKIN_DRAG_EVENT: &str = "axial:desktop:skin-drag";
const SKIN_DROP_LOCK_INVARIANT: &str =
    "desktop skin-drop lock poisoned; native file authority may be inconsistent";

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(crate) struct NativeSkinFile {
    name: String,
    bytes: Vec<u8>,
}

pub(crate) struct NativeSkinFileAdmission {
    name: String,
    file: File,
    revision: NativeSkinFileRevision,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct NativeSkinFileRevision {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    modified_seconds: i64,
    #[cfg(unix)]
    modified_nanoseconds: i64,
}

#[derive(Clone)]
pub(crate) struct NativeSkinDropCoordinator {
    shared: Arc<Mutex<NativeSkinDropState>>,
}

struct NativeSkinDropState {
    generation: u64,
    drag_eligible: bool,
    pending: Option<PendingNativeSkinDrop>,
}

struct PendingNativeSkinDrop {
    token: String,
    expires_at: Instant,
    admission: NativeSkinFileAdmission,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum NativeSkinDragType {
    Enter,
    Over,
    Drop,
    Leave,
}

#[derive(Clone, Copy, Serialize)]
struct NativeSkinDragPosition {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct NativeSkinDragPayload {
    r#type: NativeSkinDragType,
    eligible: bool,
    token: Option<String>,
    position: Option<NativeSkinDragPosition>,
    error: Option<&'static str>,
}

enum NativeSkinDropSelection {
    None,
    Multiple,
    One(PathBuf),
}

impl NativeSkinDropCoordinator {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(Mutex::new(NativeSkinDropState {
                generation: 0,
                drag_eligible: false,
                pending: None,
            })),
        }
    }

    fn begin_drag(&self, eligible: bool) {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        advance_generation(&mut state);
        state.drag_eligible = eligible;
        state.pending = None;
    }

    fn drag_eligible(&self) -> bool {
        self.shared
            .lock()
            .expect(SKIN_DROP_LOCK_INVARIANT)
            .drag_eligible
    }

    fn begin_drop(&self) -> u64 {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        advance_generation(&mut state);
        state.drag_eligible = false;
        state.pending = None;
        state.generation
    }

    fn cancel_drag(&self) {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        advance_generation(&mut state);
        state.drag_eligible = false;
        state.pending = None;
    }

    fn publish(
        &self,
        generation: u64,
        admission: NativeSkinFileAdmission,
    ) -> Option<String> {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        if state.generation != generation {
            return None;
        }
        let token = Uuid::new_v4().simple().to_string();
        state.pending = Some(PendingNativeSkinDrop {
            token: token.clone(),
            expires_at: Instant::now() + SKIN_DROP_TOKEN_TTL,
            admission,
        });
        Some(token)
    }

    fn expire(&self, token: &str) {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.token == token)
        {
            state.pending = None;
        }
    }

    pub(crate) fn consume(&self, token: &str) -> Result<NativeSkinFile, String> {
        if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Dropped skin file token is invalid.".to_string());
        }
        let pending = {
            let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
            let Some(pending) = state.pending.as_ref() else {
                return Err("Dropped skin file is no longer available.".to_string());
            };
            if Instant::now() >= pending.expires_at {
                state.pending = None;
                return Err("Dropped skin file expired. Drop it again.".to_string());
            }
            if pending.token != token {
                return Err("Dropped skin file token is invalid.".to_string());
            }
            state.pending.take().expect("validated pending skin drop")
        };
        pending.admission.read()
    }
}

fn advance_generation(state: &mut NativeSkinDropState) {
    state.generation = state
        .generation
        .checked_add(1)
        .expect("desktop skin-drop generation overflowed");
}

pub(crate) fn handle_native_skin_drag(
    window: &WebviewWindow,
    coordinator: NativeSkinDropCoordinator,
    event: &DragDropEvent,
) {
    match event {
        DragDropEvent::Enter { paths, position } => {
            let eligible = matches!(skin_drop_selection(paths), NativeSkinDropSelection::One(_));
            coordinator.begin_drag(eligible);
            emit_drag(window, NativeSkinDragType::Enter, eligible, None, *position, None);
        }
        DragDropEvent::Over { position } => emit_drag(
            window,
            NativeSkinDragType::Over,
            coordinator.drag_eligible(),
            None,
            *position,
            None,
        ),
        DragDropEvent::Drop { paths, position } => {
            let generation = coordinator.begin_drop();
            let position = *position;
            match skin_drop_selection(paths) {
                NativeSkinDropSelection::None => emit_drag(
                    window,
                    NativeSkinDragType::Drop,
                    false,
                    None,
                    position,
                    None,
                ),
                NativeSkinDropSelection::Multiple => emit_drag(
                    window,
                    NativeSkinDragType::Drop,
                    false,
                    None,
                    position,
                    Some("Drop one PNG skin file."),
                ),
                NativeSkinDropSelection::One(path) => {
                    let (token, error) = match NativeSkinFileAdmission::open(path) {
                        Ok(admission) => (coordinator.publish(generation, admission), None),
                        Err(error) => (None, Some(error)),
                    };
                    if let Some(token) = token.as_ref() {
                        let expiry_coordinator = coordinator.clone();
                        let expiry_token = token.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(SKIN_DROP_TOKEN_TTL).await;
                            expiry_coordinator.expire(&expiry_token);
                        });
                    }
                    emit_drag(
                        window,
                        NativeSkinDragType::Drop,
                        token.is_some(),
                        token,
                        position,
                        error.as_deref(),
                    );
                }
            }
        }
        DragDropEvent::Leave => {
            coordinator.cancel_drag();
            let _ = window.emit(
                NATIVE_SKIN_DRAG_EVENT,
                NativeSkinDragPayload {
                    r#type: NativeSkinDragType::Leave,
                    eligible: false,
                    token: None,
                    position: None,
                    error: None,
                },
            );
        }
        _ => {}
    }
}

fn emit_drag(
    window: &WebviewWindow,
    drag_type: NativeSkinDragType,
    eligible: bool,
    token: Option<String>,
    position: PhysicalPosition<f64>,
    error: Option<&str>,
) {
    let error = match error {
        Some("Choose a PNG skin file.") => Some("Choose a PNG skin file."),
        Some("Skin file is too large; choose a PNG under 256 KiB.") => {
            Some("Skin file is too large; choose a PNG under 256 KiB.")
        }
        Some("Drop one PNG skin file.") => Some("Drop one PNG skin file."),
        Some("Could not read dropped skin file.") => Some("Could not read dropped skin file."),
        Some(_) => Some("Could not read dropped skin file."),
        None => None,
    };
    let _ = window.emit(
        NATIVE_SKIN_DRAG_EVENT,
        NativeSkinDragPayload {
            r#type: drag_type,
            eligible,
            token,
            position: Some(NativeSkinDragPosition {
                x: position.x,
                y: position.y,
            }),
            error,
        },
    );
}

fn skin_drop_selection(paths: &[PathBuf]) -> NativeSkinDropSelection {
    let mut png_paths = paths
        .iter()
        .filter(|path| has_png_extension(path.as_path()));
    let Some(first) = png_paths.next() else {
        return NativeSkinDropSelection::None;
    };
    if png_paths.next().is_some() || paths.len() != 1 {
        return NativeSkinDropSelection::Multiple;
    }
    NativeSkinDropSelection::One(first.clone())
}

impl NativeSkinFileAdmission {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        if !has_png_extension(&path) {
            return Err("Choose a PNG skin file.".to_string());
        }
        let file = File::open(&path).map_err(|_| "Could not read skin file.".to_string())?;
        let metadata = file
            .metadata()
            .map_err(|_| "Could not read skin file.".to_string())?;
        if !metadata.is_file() {
            return Err("Choose a PNG skin file.".to_string());
        }
        if metadata.len() > SKIN_FILE_MAX_BYTES {
            return Err("Skin file is too large; choose a PNG under 256 KiB.".to_string());
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("skin.png")
            .to_string();
        Ok(Self {
            name,
            file,
            revision: NativeSkinFileRevision::capture(&metadata),
        })
    }

    pub(crate) fn read(mut self) -> Result<NativeSkinFile, String> {
        self.validate_revision()?;
        let mut bytes = Vec::with_capacity(self.revision.len as usize);
        self.file
            .by_ref()
            .take(SKIN_FILE_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read skin file.".to_string())?;
        if bytes.len() as u64 > SKIN_FILE_MAX_BYTES {
            return Err("Skin file is too large; choose a PNG under 256 KiB.".to_string());
        }
        self.validate_revision()?;
        if !bytes.starts_with(PNG_SIGNATURE) {
            return Err("Choose a PNG skin file.".to_string());
        }
        Ok(NativeSkinFile {
            name: self.name,
            bytes,
        })
    }

    fn validate_revision(&self) -> Result<(), String> {
        let current = self
            .file
            .metadata()
            .map_err(|_| "Could not read skin file.".to_string())?;
        if NativeSkinFileRevision::capture(&current) != self.revision {
            return Err("Skin file changed while it was being read. Choose it again.".to_string());
        }
        Ok(())
    }
}

impl NativeSkinFileRevision {
    fn capture(metadata: &Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt as _;

        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            #[cfg(unix)]
            modified_seconds: metadata.mtime(),
            #[cfg(unix)]
            modified_nanoseconds: metadata.mtime_nsec(),
        }
    }
}

fn has_png_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "axial-desktop-skin-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("test dir");
        dir
    }

    #[test]
    fn native_skin_read_uses_the_admitted_file_revision() {
        let dir = test_dir("revision");
        let path = dir.join("player.png");
        let mut original = PNG_SIGNATURE.to_vec();
        original.extend_from_slice(b"original");
        fs::write(&path, &original).expect("write original png");
        let admission = NativeSkinFileAdmission::open(path.clone()).expect("admit skin");
        let mut replacement = PNG_SIGNATURE.to_vec();
        replacement.extend_from_slice(b"replacement");
        fs::write(&path, replacement).expect("replace png bytes");

        assert_eq!(
            admission.read(),
            Err("Skin file changed while it was being read. Choose it again.".to_string())
        );
        fs::remove_file(path).expect("cleanup file");
        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[test]
    fn skin_drop_token_is_one_shot_and_forgery_does_not_consume_it() {
        let dir = test_dir("token");
        let path = dir.join("player.png");
        fs::write(&path, PNG_SIGNATURE).expect("write png");
        let coordinator = NativeSkinDropCoordinator::new();
        let generation = coordinator.begin_drop();
        let token = coordinator
            .publish(
                generation,
                NativeSkinFileAdmission::open(path.clone()).expect("admit skin"),
            )
            .expect("publish token");

        assert_eq!(
            coordinator.consume("forged"),
            Err("Dropped skin file token is invalid.".to_string())
        );
        assert_eq!(
            coordinator.consume(&token).expect("consume token").bytes,
            PNG_SIGNATURE
        );
        assert_eq!(
            coordinator.consume(&token),
            Err("Dropped skin file is no longer available.".to_string())
        );
        fs::remove_file(path).expect("cleanup file");
        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[test]
    fn expired_skin_drop_token_is_rejected_and_removed() {
        let dir = test_dir("expired-token");
        let path = dir.join("player.png");
        fs::write(&path, PNG_SIGNATURE).expect("write png");
        let coordinator = NativeSkinDropCoordinator::new();
        let generation = coordinator.begin_drop();
        let token = coordinator
            .publish(
                generation,
                NativeSkinFileAdmission::open(path.clone()).expect("admit skin"),
            )
            .expect("publish token");
        coordinator
            .shared
            .lock()
            .expect(SKIN_DROP_LOCK_INVARIANT)
            .pending
            .as_mut()
            .expect("pending token")
            .expires_at = Instant::now();

        assert_eq!(
            coordinator.consume(&token),
            Err("Dropped skin file expired. Drop it again.".to_string())
        );
        assert_eq!(
            coordinator.consume(&token),
            Err("Dropped skin file is no longer available.".to_string())
        );
        fs::remove_file(path).expect("cleanup file");
        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[test]
    fn native_skin_read_rejects_non_png_content_and_oversized_input() {
        let dir = test_dir("validation");
        let invalid = dir.join("invalid.png");
        fs::write(&invalid, b"not a png").expect("write invalid file");
        assert_eq!(
            NativeSkinFileAdmission::open(invalid.clone()).and_then(NativeSkinFileAdmission::read),
            Err("Choose a PNG skin file.".to_string())
        );

        let oversized = dir.join("oversized.png");
        fs::write(&oversized, vec![0; (SKIN_FILE_MAX_BYTES + 1) as usize])
            .expect("write oversized file");
        assert_eq!(
            NativeSkinFileAdmission::open(oversized.clone())
                .and_then(NativeSkinFileAdmission::read),
            Err("Skin file is too large; choose a PNG under 256 KiB.".to_string())
        );

        fs::remove_file(invalid).expect("cleanup invalid file");
        fs::remove_file(oversized).expect("cleanup oversized file");
        fs::remove_dir(dir).expect("cleanup dir");
    }
}
