package modloaders

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mateoltd/croopor/internal/minecraft"
)

// installProfileJSON represents the install_profile.json from Forge/NeoForge installers.
type installProfileJSON struct {
	Processors []processor          `json:"processors"`
	Libraries  []minecraft.Library  `json:"libraries"`
	Data       map[string]dataEntry `json:"data"`
}

type processor struct {
	Jar       string   `json:"jar"`
	Classpath []string `json:"classpath"`
	Args      []string `json:"args"`
	Sides     []string `json:"sides,omitempty"`
}

type dataEntry struct {
	Client string `json:"client"`
	Server string `json:"server"`
}

// RunForgeProcessors executes the processors from an install_profile.json.
// RunForgeProcessors executes Forge/NeoForge "processors" from an install_profile.json to patch the client and produce any required artifacts.
// It filters processors to the client side, builds library and data variable lookups (including extracting embedded installer resources when needed), runs each processor sequentially using an appropriate Java runtime, and emits progress updates on the provided channel.
// The function returns an error if the install profile cannot be parsed, a suitable Java runtime cannot be found, processor data variables cannot be built, or if any processor fails.
func RunForgeProcessors(mcDir, mcVersion, versionID string, installProfileData, installerData []byte, progress chan<- Progress) error {
	var profile installProfileJSON
	if err := json.Unmarshal(installProfileData, &profile); err != nil {
		return fmt.Errorf("parsing install profile: %w", err)
	}

	if len(profile.Processors) == 0 {
		return nil // Legacy Forge, no processors needed
	}

	// Find Java runtime
	javaPath, err := findJavaForProcessors(mcDir)
	if err != nil {
		return fmt.Errorf("Java required for Forge processors: %w", err)
	}

	// Build library path lookup: Maven coordinate -> absolute path
	libDir := minecraft.LibrariesDir(mcDir)
	libPaths := map[string]string{}
	for _, lib := range profile.Libraries {
		mavenPath := minecraft.MavenToPath(lib.Name)
		if mavenPath != "" {
			libPaths[lib.Name] = filepath.Join(libDir, mavenPath)
		}
	}

	// Build data variable lookup
	dataVars, tempDir, err := buildDataVars(profile.Data, mcDir, mcVersion, versionID, installerData)
	if err != nil {
		return fmt.Errorf("building processor data vars: %w", err)
	}
	if tempDir != "" {
		defer os.RemoveAll(tempDir)
	}

	// Filter to client-side processors only
	var clientProcessors []processor
	for _, p := range profile.Processors {
		if len(p.Sides) > 0 {
			isClient := false
			for _, s := range p.Sides {
				if s == "client" {
					isClient = true
					break
				}
			}
			if !isClient {
				continue
			}
		}
		clientProcessors = append(clientProcessors, p)
	}

	total := len(clientProcessors)
	for i, proc := range clientProcessors {
		progress <- Progress{
			Phase:   "loader_processors",
			Current: i + 1,
			Total:   total,
			Detail:  fmt.Sprintf("Processor %d/%d", i+1, total),
		}

		if err := runProcessor(javaPath, proc, libPaths, dataVars, libDir); err != nil {
			return fmt.Errorf("processor %d/%d failed: %w", i+1, total, err)
		}
	}

	return nil
}

// runProcessor resolves a processor's JAR and classpath entries, determines its main class
// from the JAR manifest, substitutes placeholders in the processor arguments, and invokes
// the processor using the specified Java executable with working directory set to libDir.
// It returns an error if the processor JAR cannot be resolved, if the manifest does not
// provide a Main-Class, or if the Java process exits with an error (the returned error
// includes the process's combined output).
func runProcessor(javaPath string, proc processor, libPaths map[string]string, dataVars map[string]string, libDir string) error {
	// Build classpath: processor JAR + its classpath entries
	var cpParts []string

	procJarPath := libPaths[proc.Jar]
	if procJarPath == "" {
		mavenPath := minecraft.MavenToPath(proc.Jar)
		if mavenPath != "" {
			procJarPath = filepath.Join(libDir, mavenPath)
		}
	}
	if procJarPath == "" {
		return fmt.Errorf("cannot resolve processor JAR: %s", proc.Jar)
	}
	cpParts = append(cpParts, procJarPath)

	for _, cp := range proc.Classpath {
		p := libPaths[cp]
		if p == "" {
			mavenPath := minecraft.MavenToPath(cp)
			if mavenPath != "" {
				p = filepath.Join(libDir, mavenPath)
			}
		}
		if p != "" {
			cpParts = append(cpParts, p)
		}
	}

	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}
	classpath := strings.Join(cpParts, sep)

	// Resolve processor main class from its JAR manifest
	mainClass, err := readMainClassFromJar(procJarPath)
	if err != nil {
		return fmt.Errorf("reading main class from %s: %w", proc.Jar, err)
	}

	// Substitute arguments
	args := make([]string, 0, len(proc.Args)+4)
	args = append(args, "-cp", classpath, mainClass)
	for _, arg := range proc.Args {
		args = append(args, substituteArg(arg, libPaths, dataVars, libDir))
	}

	cmd := exec.Command(javaPath, args...)
	cmd.Dir = libDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s\noutput: %s", err, string(output))
	}

	return nil
}

// readMainClassFromJar extracts the `Main-Class` entry from the `META-INF/MANIFEST.MF` of the given JAR file.
// It returns the value of the `Main-Class` header, or an error if the JAR cannot be read or the manifest does not contain a `Main-Class`.
func readMainClassFromJar(jarPath string) (string, error) {
	f, err := os.Open(jarPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return "", err
	}

	zr, err := zip.NewReader(f, stat.Size())
	if err != nil {
		return "", err
	}

	for _, zf := range zr.File {
		if zf.Name == "META-INF/MANIFEST.MF" {
			rc, err := zf.Open()
			if err != nil {
				return "", err
			}
			data, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return "", err
			}
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "Main-Class:") {
					return strings.TrimSpace(strings.TrimPrefix(line, "Main-Class:")), nil
				}
			}
		}
	}

	return "", fmt.Errorf("no Main-Class in manifest")
}

// substituteArg resolves processor argument placeholders.
// It accepts three placeholder forms and returns the resolved value or the original arg when unresolved.
//
// - If arg is in the form [group:artifact:version] it is treated as a Maven coordinate:
//   it returns libPaths[coordinate] if present, otherwise returns filepath.Join(libDir, minecraft.MavenToPath(coordinate))
//   when MavenToPath yields a non-empty path.
// - If arg is in the form {KEY} it returns dataVars[KEY] when present.
// - For any other form or when lookups fail, it returns arg unchanged.
func substituteArg(arg string, libPaths, dataVars map[string]string, libDir string) string {
	// [artifact:coordinate] -> library path
	if strings.HasPrefix(arg, "[") && strings.HasSuffix(arg, "]") {
		coord := arg[1 : len(arg)-1]
		if p, ok := libPaths[coord]; ok {
			return p
		}
		mavenPath := minecraft.MavenToPath(coord)
		if mavenPath != "" {
			return filepath.Join(libDir, mavenPath)
		}
		return arg
	}

	// {DATA_KEY} -> data variable value
	if strings.HasPrefix(arg, "{") && strings.HasSuffix(arg, "}") {
		key := arg[1 : len(arg)-1]
		if v, ok := dataVars[key]; ok {
			return v
		}
		return arg
	}

	return arg
}

// buildDataVars builds the processor data variable map used by Forge processors.
// It converts `data` entries' Client values into concrete filesystem paths or literal strings,
// extracting files from the installer JAR when values are installer-relative paths.
//
// For each entry:
// - If the Client value is of the form `[group:artifact:version:classifier?]`, it is converted
//   to a library path under the instance's library directory.
// - If the Client value begins with `/`, the referenced entry is extracted from `installerData`
//   into a temporary directory (created once) and the extracted file path is used.
// - Otherwise the Client value is used verbatim.
//
// The function also injects standard variables:
// `MINECRAFT_JAR`, `SIDE` (set to "client"), `MINECRAFT_VERSION`, `ROOT`, and `LIBRARY_DIR`.
//
// It returns the populated variable map, the temporary directory path if one was created
// (empty string otherwise), and a non-nil error if temp directory creation or file extraction fails.
func buildDataVars(data map[string]dataEntry, mcDir, mcVersion, versionID string, installerData []byte) (map[string]string, string, error) {
	vars := map[string]string{}
	tempDir := ""

	for key, entry := range data {
		val := entry.Client
		if val == "" {
			continue
		}

		// If value is [coordinate], resolve to library path
		if strings.HasPrefix(val, "[") && strings.HasSuffix(val, "]") {
			coord := val[1 : len(val)-1]
			mavenPath := minecraft.MavenToPath(coord)
			if mavenPath != "" {
				vars[key] = filepath.Join(minecraft.LibrariesDir(mcDir), mavenPath)
			}
			continue
		}

		// If value starts with /, it's a path inside the installer JAR — extract to temp
		if strings.HasPrefix(val, "/") {
			if tempDir == "" {
				var err error
				tempDir, err = os.MkdirTemp("", "forge-processors-")
				if err != nil {
					return nil, tempDir, fmt.Errorf("creating temp dir for processor data: %w", err)
				}
			}
			extracted := extractFromInstallerJar(installerData, val[1:], tempDir)
			if extracted == "" {
				return nil, tempDir, fmt.Errorf("extracting %s from installer", val)
			}
			vars[key] = extracted
			continue
		}

		vars[key] = val
	}

	// Standard variables
	vars["MINECRAFT_JAR"] = filepath.Join(minecraft.VersionsDir(mcDir), mcVersion, mcVersion+".jar")
	vars["SIDE"] = "client"
	vars["MINECRAFT_VERSION"] = mcVersion
	vars["ROOT"] = mcDir
	vars["LIBRARY_DIR"] = minecraft.LibrariesDir(mcDir)

	return vars, tempDir, nil
}

// extractFromInstallerJar extracts the zip entry named entryPath from jarData into tempDir and returns the written file's absolute path.
// If the entry is not found or any error occurs while reading or writing, it returns an empty string.
// entryPath is the path inside the ZIP (use forward slashes); parent directories under tempDir are created as needed.
func extractFromInstallerJar(jarData []byte, entryPath, tempDir string) string {
	r, err := zip.NewReader(bytes.NewReader(jarData), int64(len(jarData)))
	if err != nil {
		return ""
	}

	for _, f := range r.File {
		if f.Name != entryPath {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return ""
		}

		destPath := filepath.Join(tempDir, filepath.FromSlash(entryPath))
		os.MkdirAll(filepath.Dir(destPath), 0755)
		if err := os.WriteFile(destPath, data, 0644); err != nil {
			return ""
		}
		return destPath
	}
	return ""
}

// findJavaForProcessors locates a Java runtime suitable for running Forge processors.
// It first attempts known bundled Java components via minecraft.FindJava; if none
// succeed it falls back to searching for a system `java` (or `javaw.exe` on Windows)
// on the PATH. If no runtime can be found, it returns an error recommending the base
// game version be installed so Java can be downloaded.
func findJavaForProcessors(mcDir string) (string, error) {
	// Try common Java version components
	components := []string{"java-runtime-delta", "java-runtime-gamma", "java-runtime-beta", "java-runtime-alpha", "jre-legacy"}
	for _, comp := range components {
		result, err := minecraft.FindJava(mcDir, minecraft.JavaVersion{Component: comp, MajorVersion: 21}, "")
		if err == nil {
			return result.Path, nil
		}
	}

	// Fallback: check if "java" is on PATH
	javaExe := "java"
	if runtime.GOOS == "windows" {
		javaExe = "javaw.exe"
	}
	if path, err := exec.LookPath(javaExe); err == nil {
		return path, nil
	}

	return "", fmt.Errorf("no Java runtime found; install the base game version first to download Java")
}
