use serde::Serialize;
use std::fs::{File, Metadata, OpenOptions};
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::dpi::PhysicalPosition;
use tauri::{DragDropEvent, Emitter, WebviewWindow};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
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
    #[cfg(windows)]
    volume_serial_number: Option<u32>,
    #[cfg(windows)]
    file_index: Option<u64>,
    #[cfg(windows)]
    last_write_time: u64,
    #[cfg(windows)]
    file_size: u64,
}

#[derive(Clone)]
pub(crate) struct NativeSkinDropCoordinator {
    shared: Arc<Mutex<NativeSkinDropState>>,
    admission_gate: Arc<Semaphore>,
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
            admission_gate: Arc::new(Semaphore::new(1)),
        }
    }

    fn begin_drag(&self, eligible: bool) {
        let mut state = self.shared.lock().expect(SKIN_DROP_LOCK_INVARIANT);
        advance_generation(&mut state);
        state.drag_eligible = eligible;
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
        state.drag_eligible = false;
    }

    fn try_begin_admission(&self) -> Option<OwnedSemaphorePermit> {
        Arc::clone(&self.admission_gate)
            .try_acquire_owned()
            .ok()
    }

    fn generation_is_current(&self, generation: u64) -> bool {
        self.shared
            .lock()
            .expect(SKIN_DROP_LOCK_INVARIANT)
            .generation
            == generation
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
                    let Some(admission_permit) = coordinator.try_begin_admission() else {
                        emit_drag(
                            window,
                            NativeSkinDragType::Drop,
                            false,
                            None,
                            position,
                            Some("Another skin file is still being checked."),
                        );
                        return;
                    };
                    let window = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let admission = tauri::async_runtime::spawn_blocking(move || {
                            let result = NativeSkinFileAdmission::open(path);
                            drop(admission_permit);
                            result
                        })
                        .await
                        .map_err(|_| "Could not read dropped skin file.".to_string())
                        .and_then(|result| result);
                        if !coordinator.generation_is_current(generation) {
                            return;
                        }
                        let (token, error) = match admission {
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
                            &window,
                            NativeSkinDragType::Drop,
                            token.is_some(),
                            token,
                            position,
                            error.as_deref(),
                        );
                    });
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
        let file = open_native_skin_file(&path)
            .map_err(|_| "Could not read skin file.".to_string())?;
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
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt as _;

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
            #[cfg(windows)]
            volume_serial_number: metadata.volume_serial_number(),
            #[cfg(windows)]
            file_index: metadata.file_index(),
            #[cfg(windows)]
            last_write_time: metadata.last_write_time(),
            #[cfg(windows)]
            file_size: metadata.file_size(),
        }
    }
}

fn open_native_skin_file(path: &Path) -> std::io::Result<File> {
    open_native_skin_file_platform(path)
}

#[cfg(unix)]
fn open_native_skin_file_platform(path: &Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let mut options = OpenOptions::new();
    options.read(true);
    options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    options.open(path)
}

#[cfg(windows)]
fn open_native_skin_file_platform(path: &Path) -> std::io::Result<File> {
    use std::mem::{MaybeUninit, size_of};
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
        FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_SEQUENTIAL_SCAN, FILE_NAME_OPENED,
        FILE_STANDARD_INFO, FILE_TYPE_DISK, FileBasicInfo, FileStandardInfo,
        GetFileInformationByHandleEx, GetFileType, VOLUME_NAME_GUID,
    };

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN);
    let file = options.open(path)?;
    let handle = file.as_raw_handle();

    if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "native skin is not a disk file",
        ));
    }

    let mut basic = MaybeUninit::<FILE_BASIC_INFO>::uninit();
    let basic_ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            basic.as_mut_ptr().cast(),
            size_of::<FILE_BASIC_INFO>() as u32,
        )
    };
    if basic_ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let basic = unsafe { basic.assume_init() };

    let mut standard = MaybeUninit::<FILE_STANDARD_INFO>::uninit();
    let standard_ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileStandardInfo,
            standard.as_mut_ptr().cast(),
            size_of::<FILE_STANDARD_INFO>() as u32,
        )
    };
    if standard_ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let standard = unsafe { standard.assume_init() };

    if basic.FileAttributes
        & (FILE_ATTRIBUTE_REPARSE_POINT
            | FILE_ATTRIBUTE_DIRECTORY
            | FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
        || standard.Directory != 0
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "native skin is not an exact regular file",
        ));
    }

    require_local_volume_path(handle, FILE_NAME_OPENED | VOLUME_NAME_GUID)?;
    Ok(file)
}

#[cfg(windows)]
fn require_local_volume_path(
    handle: std::os::windows::io::RawHandle,
    flags: u32,
) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let required = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, flags) };
    if required == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut path = vec![0_u16; required as usize];
    let written = unsafe {
        GetFinalPathNameByHandleW(handle, path.as_mut_ptr(), path.len() as u32, flags)
    };
    if written == 0 || written as usize >= path.len() {
        return Err(if written == 0 {
            std::io::Error::last_os_error()
        } else {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "native skin volume path changed while queried",
            )
        });
    }
    let path = String::from_utf16(&path[..written as usize]).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "native skin volume path is malformed",
        )
    })?;
    if !path.starts_with(r"\\?\Volume{") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "native skin is not on a local volume",
        ));
    }

    Ok(())
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
    fn enter_and_leave_do_not_cancel_an_issued_skin_drop_token() {
        let dir = test_dir("token-drag-lifecycle");
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

        coordinator.begin_drag(false);
        coordinator.cancel_drag();

        assert_eq!(
            coordinator.consume(&token).expect("consume token").bytes,
            PNG_SIGNATURE
        );
        fs::remove_file(path).expect("cleanup file");
        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[test]
    fn newer_failed_drop_revokes_the_previous_skin_drop_token() {
        let dir = test_dir("token-new-drop");
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

        coordinator.begin_drop();
        assert!(NativeSkinFileAdmission::open(dir.join("missing.png")).is_err());

        assert_eq!(
            coordinator.consume(&token),
            Err("Dropped skin file is no longer available.".to_string())
        );
        fs::remove_file(path).expect("cleanup file");
        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[cfg(windows)]
    #[test]
    fn native_skin_admission_rejects_windows_character_devices() {
        let dir = test_dir("windows-device");

        assert!(NativeSkinFileAdmission::open(dir.join("NUL.png")).is_err());

        fs::remove_dir(dir).expect("cleanup dir");
    }

    #[cfg(unix)]
    #[test]
    fn native_skin_admission_rejects_symlinks_and_fifos() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::symlink;

        let dir = test_dir("special-files");
        let target = dir.join("target.png");
        let symlink_path = dir.join("symlink.png");
        let fifo_path = dir.join("fifo.png");
        fs::write(&target, PNG_SIGNATURE).expect("write target");
        symlink(&target, &symlink_path).expect("create symlink");
        let fifo_native = CString::new(fifo_path.as_os_str().as_bytes()).expect("fifo path");
        let result = unsafe { libc::mkfifo(fifo_native.as_ptr(), 0o600) };
        assert_eq!(result, 0, "create fifo: {}", std::io::Error::last_os_error());

        assert!(NativeSkinFileAdmission::open(symlink_path.clone()).is_err());
        assert!(NativeSkinFileAdmission::open(fifo_path.clone()).is_err());

        fs::remove_file(symlink_path).expect("cleanup symlink");
        fs::remove_file(fifo_path).expect("cleanup fifo");
        fs::remove_file(target).expect("cleanup target");
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
