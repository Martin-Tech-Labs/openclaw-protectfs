.PHONY: test coverage coverage-check lint fmt swift-build swift-test

test:
	npm test

coverage:
	npm run coverage

coverage-check:
	npm run coverage:check

lint:
	@echo "(placeholder) add eslint in later tasks"

fmt:
	@echo "(placeholder) add prettier in later tasks"

# Swift builds are macOS-only.
swift-build:
	cd fusefs-swift && swift build
	cd supervisor-swift && swift build

# Note: fusefs-swift currently has no SwiftPM test target.
# We always run supervisor-swift tests.
# fusefs-swift depends on macFUSE headers (fuse/fuse.h), which are typically *not*
# present on GitHub-hosted runners. So we only compile fusefs-swift when explicitly
# enabled *and* headers are available.
swift-test:
	@if [ "${OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT:-0}" = "1" ]; then \
		if [ -f /opt/homebrew/include/fuse/fuse.h ] || [ -f /usr/local/include/fuse/fuse.h ]; then \
			echo "OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1; building fusefs-swift"; \
			(cd fusefs-swift && swift build); \
		else \
			echo "OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1 but fuse headers not found; failing"; \
			exit 1; \
		fi; \
	else \
		echo "Skipping fusefs-swift build (set OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1 to enable)"; \
	fi
	cd supervisor-swift && swift test
