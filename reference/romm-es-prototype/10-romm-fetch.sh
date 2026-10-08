#!/bin/sh
# ES-DE game-start hook: download the game from RomM if it is still a placeholder.
exec /usr/bin/python3 "$HOME/.local/share/romm-es/romm_es.py" fetch "$1" "$2"
