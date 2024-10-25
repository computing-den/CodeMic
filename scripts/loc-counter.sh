#!/bin/bash

# run from inside repo's root directory

find ./src | cloc --list-file=- --by-file
