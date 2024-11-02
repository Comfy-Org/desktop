#!/usr/bin/env bash

for pyexec in "$1/bin/python" "$1/lib/libpython*.dylib"; do
    # the grep captures the last word in the output of the file cmd
    if [ $(file $pyexec | grep -oE '[^ ]+$') = "x86_64" ]; then
        # the leading redirect causes echo to output to stderr
        >&2 echo "ERROR: bundled python executable $pyexec is built for incorrect machine (x86_64)"
        exit 1
    fi
done
