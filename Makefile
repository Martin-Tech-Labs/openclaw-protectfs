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
# We at least run supervisor-swift tests, and compile fusefs-swift.
swift-test:
	cd fusefs-swift && swift build
	cd supervisor-swift && swift test
