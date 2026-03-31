package modloaders

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/mateoltd/croopor/internal/minecraft"
)

// DefaultClient is a shared HTTP client for loader metadata and file downloads.
var DefaultClient = &http.Client{Timeout: 5 * time.Minute}

// DownloadLibraries downloads a list of Minecraft-format libraries into the
// shared libraries directory. It skips files that already exist with matching
// DownloadLibraries downloads the Minecraft-format libraries for the given libs into the shared libraries directory for mcDir, skipping files that already match the expected SHA1 and emitting progress updates on the progress channel.
// 
// The function filters the provided libraries using the default environment, resolves each library to a local path and download URL, creates parent directories as needed, and verifies downloaded content against the resolved SHA1. Progress messages are sent with Phase "loader_libraries" and include Current, Total, and Detail (the target file's base name). The first error encountered is returned.
func DownloadLibraries(libs []minecraft.Library, mcDir string, progress chan<- Progress) error {
	env := minecraft.DefaultEnvironment()
	filtered := minecraft.FilterLibraries(libs, env)

	resolvable := make([]minecraft.Library, 0, len(filtered))
	for _, lib := range filtered {
		libPath, libURL, _ := minecraft.ResolveLibDownload(lib, mcDir)
		if libPath == "" || libURL == "" {
			continue
		}
		resolvable = append(resolvable, lib)
	}

	total := len(resolvable)
	for i, lib := range resolvable {
		libPath, libURL, libSHA1 := minecraft.ResolveLibDownload(lib, mcDir)

		progress <- Progress{
			Phase:   "loader_libraries",
			Current: i + 1,
			Total:   total,
			Detail:  filepath.Base(libPath),
		}

		if minecraft.FileExistsWithSHA1(libPath, libSHA1) {
			continue
		}

		if err := os.MkdirAll(filepath.Dir(libPath), 0755); err != nil {
			return err
		}
		if err := minecraft.DownloadFile(DefaultClient, libURL, libPath, libSHA1); err != nil {
			return err
		}
	}
	return nil
}
