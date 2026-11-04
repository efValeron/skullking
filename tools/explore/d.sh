#!/bin/sh
# Send one driver command (UTF-8 safe): sh d.sh '{"op":"texts"}'
printf '%s' "$1" | curl -s localhost:9333 --data-binary @-; echo
