.PHONY: test coverage coverage-check lint fmt

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
