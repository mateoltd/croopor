package modloaders

import "sync"

var (
	mu       sync.RWMutex
	registry = map[LoaderType]Loader{}
)

// Register adds the given Loader to the global registry, storing it under the Loader's type and overwriting any existing loader for that type.
func Register(l Loader) {
	mu.Lock()
	registry[l.Type()] = l
	mu.Unlock()
}

// Get returns the loader registered for the given LoaderType and a boolean
// that is true if a loader for that type exists.
func Get(t LoaderType) (Loader, bool) {
	mu.RLock()
	defer mu.RUnlock()
	l, ok := registry[t]
	return l, ok
}

// All returns every registered loader.
func All() []Loader {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Loader, 0, len(registry))
	for _, l := range registry {
		out = append(out, l)
	}
	return out
}

// AllInfo returns a slice of LoaderInfo containing the display metadata for all loaders
// currently registered in the global registry. The order of elements in the returned slice
// is unspecified.
func AllInfo() []LoaderInfo {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]LoaderInfo, 0, len(registry))
	for _, l := range registry {
		out = append(out, l.Info())
	}
	return out
}
