# Sourced by the Kinetic Studio terminal before handing control to zsh.
# Wraps `claude` so it always launches with the project's agent skill
# as an appended system prompt.

if [ -n "$KINETIC_PROJECT" ] && [ -f "$KINETIC_PROJECT/.kinetic-studio/skill.md" ]; then
  alias claude='command claude --append-system-prompt "$(cat "$KINETIC_PROJECT/.kinetic-studio/skill.md")"'
fi
