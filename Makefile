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

# Note: fusefs-swift's executable target depends on macFUSE headers (fuse/fuse.h)
# and a linkable libfuse, which are typically *not* present on GitHub-hosted runners.
#
# To keep CI coverage for the Swift rewrite (#87), we always compile the
# FUSE-independent core module, and only build the full executable when
# explicitly enabled *and* headers are available.
swift-test:
	@echo "Running fusefs-swift core unit tests (no macFUSE required)"
	# GitHub-hosted macOS runners may set SWIFT_TESTING_ENABLED=0 in the environment,
	# which forces SwiftPM down the XCTest path. Our tests use Swift Testing (@Test),
	# so force-enable it and avoid building the full FUSE daemon target (needs macFUSE headers).
	cd fusefs-swift && SWIFT_TESTING_ENABLED=1 swift test --enable-swift-testing
	@if [ "${OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT:-0}" = "1" ]; then \
		if [ -f /opt/homebrew/include/fuse/fuse.h ] || [ -f /usr/local/include/fuse/fuse.h ]; then \
			echo "OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1; building fusefs-swift executable"; \
			(cd fusefs-swift && swift build); \
		else \
			echo "OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1 but fuse headers not found; failing"; \
			exit 1; \
		fi; \
	else \
		echo "Skipping fusefs-swift executable build (set OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1 to enable)"; \
	fi
	cd supervisor-swift && SWIFT_TESTING_ENABLED=1 swift test
