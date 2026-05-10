use std::sync::OnceLock;
use sysinfo::System;

const DEFAULT_LOW_END_MEMORY_MB: u64 = 4_096;
const DEFAULT_MID_RANGE_MEMORY_MB: u64 = 8_192;
const MAX_NETWORK_CONCURRENCY: usize = 256;
const MAX_DISK_WRITE_CONCURRENCY: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HardwareSnapshot {
    pub logical_cpus: usize,
    pub total_memory_mb: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceMode {
    Saver,
    Balanced,
    Performance,
    Maximum,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadResourcePolicy {
    pub library_network_concurrency: usize,
    pub asset_network_concurrency: usize,
    pub runtime_network_concurrency: usize,
    pub disk_write_concurrency: usize,
}

impl DownloadResourcePolicy {
    pub fn detect() -> Self {
        static POLICY: OnceLock<DownloadResourcePolicy> = OnceLock::new();
        *POLICY.get_or_init(|| {
            let hardware = detect_hardware();
            let mode = resource_mode_from_env().unwrap_or(ResourceMode::Balanced);
            let policy = Self::for_hardware(hardware, mode);
            policy.with_env_overrides()
        })
    }

    fn for_hardware(hardware: HardwareSnapshot, mode: ResourceMode) -> Self {
        let base = match classify_hardware(hardware) {
            HardwareTier::LowEnd => Self {
                library_network_concurrency: 16,
                asset_network_concurrency: 24,
                runtime_network_concurrency: 24,
                disk_write_concurrency: 2,
            },
            HardwareTier::MidRange => Self {
                library_network_concurrency: 32,
                asset_network_concurrency: 64,
                runtime_network_concurrency: 64,
                disk_write_concurrency: 4,
            },
            HardwareTier::HighEnd => Self {
                library_network_concurrency: 64,
                asset_network_concurrency: 128,
                runtime_network_concurrency: 128,
                disk_write_concurrency: 8,
            },
        };

        base.apply_mode(mode, hardware.logical_cpus)
    }

    fn apply_mode(self, mode: ResourceMode, logical_cpus: usize) -> Self {
        let cpus = logical_cpus.max(1);
        let scale = |value: usize, numerator: usize, denominator: usize, cap: usize| {
            value
                .saturating_mul(numerator)
                .div_ceil(denominator)
                .clamp(1, cap)
        };

        match mode {
            ResourceMode::Saver => Self {
                library_network_concurrency: scale(self.library_network_concurrency, 2, 3, 48),
                asset_network_concurrency: scale(self.asset_network_concurrency, 2, 3, 96),
                runtime_network_concurrency: scale(self.runtime_network_concurrency, 2, 3, 96),
                disk_write_concurrency: self.disk_write_concurrency.clamp(1, 3),
            },
            ResourceMode::Balanced => self,
            ResourceMode::Performance => Self {
                library_network_concurrency: scale(
                    self.library_network_concurrency.max(cpus * 12),
                    5,
                    4,
                    128,
                ),
                asset_network_concurrency: scale(
                    self.asset_network_concurrency.max(cpus * 16),
                    5,
                    4,
                    192,
                ),
                runtime_network_concurrency: scale(
                    self.runtime_network_concurrency.max(cpus * 16),
                    5,
                    4,
                    192,
                ),
                disk_write_concurrency: self.disk_write_concurrency.saturating_add(2).min(12),
            },
            ResourceMode::Maximum => Self {
                library_network_concurrency: scale(
                    self.library_network_concurrency.max(cpus * 16),
                    3,
                    2,
                    MAX_NETWORK_CONCURRENCY,
                ),
                asset_network_concurrency: scale(
                    self.asset_network_concurrency.max(cpus * 24),
                    3,
                    2,
                    MAX_NETWORK_CONCURRENCY,
                ),
                runtime_network_concurrency: scale(
                    self.runtime_network_concurrency.max(cpus * 24),
                    3,
                    2,
                    MAX_NETWORK_CONCURRENCY,
                ),
                disk_write_concurrency: self.disk_write_concurrency.saturating_mul(2).min(16),
            },
        }
    }

    fn with_env_overrides(self) -> Self {
        Self {
            library_network_concurrency: env_usize(
                "CROOPOR_DOWNLOAD_LIBRARY_CONCURRENCY",
                self.library_network_concurrency,
                MAX_NETWORK_CONCURRENCY,
            ),
            asset_network_concurrency: env_usize(
                "CROOPOR_DOWNLOAD_ASSET_CONCURRENCY",
                self.asset_network_concurrency,
                MAX_NETWORK_CONCURRENCY,
            ),
            runtime_network_concurrency: env_usize(
                "CROOPOR_DOWNLOAD_RUNTIME_CONCURRENCY",
                self.runtime_network_concurrency,
                MAX_NETWORK_CONCURRENCY,
            ),
            disk_write_concurrency: env_usize(
                "CROOPOR_DOWNLOAD_DISK_CONCURRENCY",
                self.disk_write_concurrency,
                MAX_DISK_WRITE_CONCURRENCY,
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HardwareTier {
    LowEnd,
    MidRange,
    HighEnd,
}

fn detect_hardware() -> HardwareSnapshot {
    let mut system = System::new();
    system.refresh_memory();

    HardwareSnapshot {
        logical_cpus: std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(4),
        total_memory_mb: system.total_memory() / (1024 * 1024),
    }
}

fn classify_hardware(hardware: HardwareSnapshot) -> HardwareTier {
    if hardware.logical_cpus <= 2 || hardware.total_memory_mb <= DEFAULT_LOW_END_MEMORY_MB {
        HardwareTier::LowEnd
    } else if hardware.logical_cpus <= 4 || hardware.total_memory_mb <= DEFAULT_MID_RANGE_MEMORY_MB
    {
        HardwareTier::MidRange
    } else {
        HardwareTier::HighEnd
    }
}

fn resource_mode_from_env() -> Option<ResourceMode> {
    std::env::var("CROOPOR_DOWNLOAD_MODE")
        .ok()
        .and_then(|value| parse_resource_mode(&value))
}

fn parse_resource_mode(value: &str) -> Option<ResourceMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "saver" | "safe" | "low" => Some(ResourceMode::Saver),
        "balanced" | "auto" | "" => Some(ResourceMode::Balanced),
        "performance" | "fast" | "high" => Some(ResourceMode::Performance),
        "maximum" | "max" | "unlimited" => Some(ResourceMode::Maximum),
        _ => None,
    }
}

fn env_usize(name: &str, fallback: usize, max: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .map(|value| value.clamp(1, max))
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn balanced_policy_keeps_low_end_av_friendly_disk_budget() {
        let policy = DownloadResourcePolicy::for_hardware(
            HardwareSnapshot {
                logical_cpus: 2,
                total_memory_mb: 4_096,
            },
            ResourceMode::Balanced,
        );

        assert_eq!(policy.library_network_concurrency, 16);
        assert_eq!(policy.asset_network_concurrency, 24);
        assert_eq!(policy.runtime_network_concurrency, 24);
        assert_eq!(policy.disk_write_concurrency, 2);
    }

    #[test]
    fn balanced_policy_uses_more_low_end_capacity_when_hardware_allows_it() {
        let policy = DownloadResourcePolicy::for_hardware(
            HardwareSnapshot {
                logical_cpus: 4,
                total_memory_mb: 8_192,
            },
            ResourceMode::Balanced,
        );

        assert_eq!(policy.library_network_concurrency, 32);
        assert_eq!(policy.asset_network_concurrency, 64);
        assert_eq!(policy.runtime_network_concurrency, 64);
        assert_eq!(policy.disk_write_concurrency, 4);
    }

    #[test]
    fn maximum_mode_lets_high_end_devices_push_harder_without_unbounded_writes() {
        let policy = DownloadResourcePolicy::for_hardware(
            HardwareSnapshot {
                logical_cpus: 16,
                total_memory_mb: 32_768,
            },
            ResourceMode::Maximum,
        );

        assert_eq!(policy.library_network_concurrency, 256);
        assert_eq!(policy.asset_network_concurrency, 256);
        assert_eq!(policy.runtime_network_concurrency, 256);
        assert_eq!(policy.disk_write_concurrency, 16);
    }

    #[test]
    fn parses_resource_modes() {
        assert_eq!(parse_resource_mode("safe"), Some(ResourceMode::Saver));
        assert_eq!(parse_resource_mode("auto"), Some(ResourceMode::Balanced));
        assert_eq!(
            parse_resource_mode("performance"),
            Some(ResourceMode::Performance)
        );
        assert_eq!(parse_resource_mode("max"), Some(ResourceMode::Maximum));
        assert_eq!(parse_resource_mode("wat"), None);
    }
}
