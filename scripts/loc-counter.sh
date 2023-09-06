#!/bin/bash

# run from inside repo's root directory

find ./packages/*/src | cloc --list-file=- --by-file
