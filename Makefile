SHELL := /bin/bash

.PHONY: install init test

install:
	npm install

init:
	npm install
	npm run init

test:
	npm install
	npm test
