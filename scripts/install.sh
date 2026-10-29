#!/usr/bin/env bash
# OpenChamber Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/btriapitsyn/openchamber/main/scripts/install.sh | bash

set -euo pipefail

PACKAGE_NAME="@vantran-se/openchamber-web"
LEGACY_PACKAGE_NAME="@openchamber/web"
BIN_NAME="openchamber"
MIN_NODE_MAJOR=24
MIN_NODE_MINOR=14
MIN_NODE_VERSION="$MIN_NODE_MAJOR.$MIN_NODE_MINOR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
  echo -e "${BLUE}info${NC}  $1"
}

success() {
  echo -e "${GREEN}success${NC}  $1"
}

warn() {
  echo -e "${YELLOW}warn${NC}  $1"
}

error() {
  echo -e "${RED}error${NC}  $1"
}

# Check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get Node.js version as "major.minor", or "0.0" when Node.js is missing
get_node_version() {
  if command_exists node; then
    local version
    version=$(node -v 2>/dev/null || true)
    version=${version#v}
    if [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]]; then
      echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    else
      echo "0.0"
    fi
  else
    echo "0.0"
  fi
}

# Whether a "major.minor" version meets the minimum
node_version_supported() {
  local major=${1%%.*}
  local minor=${1#*.}
  [ "$major" -gt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; }
}

# Detect preferred package manager
detect_package_manager() {
  # Check if running inside an npm/pnpm/yarn/bun context
  if [ -n "${npm_config_user_agent:-}" ]; then
    case "$npm_config_user_agent" in
      pnpm*) echo "pnpm"; return ;;
      yarn*) echo "yarn"; return ;;
      bun*) echo "bun"; return ;;
      npm*) echo "npm"; return ;;
    esac
  fi

  # Check for lockfiles in current directory (user preference)
  if [ -f "pnpm-lock.yaml" ]; then
    echo "pnpm"; return
  elif [ -f "yarn.lock" ]; then
    echo "yarn"; return
  elif [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
    echo "bun"; return
  elif [ -f "package-lock.json" ]; then
    echo "npm"; return
  fi

  # Check which package managers are available (prefer pnpm > bun > yarn > npm)
  if command_exists pnpm; then
    echo "pnpm"
  elif command_exists bun; then
    echo "bun"
  elif command_exists yarn; then
    echo "yarn"
  elif command_exists npm; then
    echo "npm"
  else
    echo "none"
  fi
}

# Flags that approve the dependency builds pnpm 10+ blocks; pnpm 11+ stops to
# ask about them in a terminal. `--allow-build` exists since pnpm 10.4.0; older
# versions reject it, and pnpm 9 and older run the builds without approval.
# Keep the list in sync with packages/web/server/lib/package-manager.js.
get_pnpm_allow_build_flags() {
  local version major minor
  version=$(pnpm --version 2>/dev/null || true)
  if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\. ]]; then
    major=${BASH_REMATCH[1]}
    minor=${BASH_REMATCH[2]}
    if [ "$major" -gt 10 ] || { [ "$major" -eq 10 ] && [ "$minor" -ge 4 ]; }; then
      echo " --allow-build=msgpackr-extract --allow-build=node-pty"
    fi
  fi
}

# Get install command for package manager
get_install_command() {
  local pm=$1
  case "$pm" in
    pnpm) echo "pnpm add -g$(get_pnpm_allow_build_flags) $PACKAGE_NAME" ;;
    yarn) echo "yarn global add $PACKAGE_NAME" ;;
    bun) echo "bun add -g $PACKAGE_NAME" ;;
    npm) echo "npm install -g $PACKAGE_NAME" ;;
    *) echo "" ;;
  esac
}

get_global_package_inventory() {
  local pm=$1
  case "$pm" in
    pnpm) pnpm list -g --depth=0 2>/dev/null ;;
    yarn) yarn global list --depth=0 2>/dev/null ;;
    bun) bun pm ls -g 2>/dev/null ;;
    npm) npm list -g --depth=0 2>/dev/null ;;
    *) return 1 ;;
  esac
}

package_version_from_inventory() {
  local package=$1
  sed -nE "s#.*${package}[@[:space:]]+v?([0-9][[:alnum:].+-]*).*#\\1#p" | head -n 1
}

get_global_package_version() {
  local pm=$1 package=$2 output
  output=$(get_global_package_inventory "$pm") || return 1
  printf '%s\n' "$output" | package_version_from_inventory "$package"
}

get_remove_command() {
  local pm=$1 package=$2
  case "$pm" in
    pnpm) echo "pnpm remove -g $package" ;;
    yarn) echo "yarn global remove $package" ;;
    bun) echo "bun remove -g $package" ;;
    npm) echo "npm uninstall -g $package" ;;
  esac
}

restore_legacy_install() {
  local pm=$1 legacy_version=$2 remove_fork restore_legacy fork_version restored_version
  remove_fork=$(get_remove_command "$pm" "$PACKAGE_NAME")
  case "$pm" in
    pnpm) restore_legacy="pnpm add -g$(get_pnpm_allow_build_flags) $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    yarn) restore_legacy="yarn global add $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    bun) restore_legacy="bun add -g $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    npm) restore_legacy="npm install -g $LEGACY_PACKAGE_NAME@$legacy_version" ;;
  esac
  eval "$remove_fork" >/dev/null 2>&1 || true
  if ! eval "$restore_legacy"; then
    return 1
  fi
  fork_version=$(get_global_package_version "$pm" "$PACKAGE_NAME")
  restored_version=$(get_global_package_version "$pm" "$LEGACY_PACKAGE_NAME")
  [ -z "$fork_version" ] && [ "$restored_version" = "$legacy_version" ]
}

migrate_legacy_install() {
  local pm=$1 legacy_version remove_legacy install_fork fork_version remaining_legacy restore_hint
  legacy_version=$(get_global_package_version "$pm" "$LEGACY_PACKAGE_NAME")
  [ -n "$legacy_version" ] || return 1
  case "$pm" in
    pnpm) restore_hint="pnpm remove -g $PACKAGE_NAME && pnpm add -g$(get_pnpm_allow_build_flags) $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    yarn) restore_hint="yarn global remove $PACKAGE_NAME && yarn global add $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    bun) restore_hint="bun remove -g $PACKAGE_NAME && bun add -g $LEGACY_PACKAGE_NAME@$legacy_version" ;;
    npm) restore_hint="npm uninstall -g $PACKAGE_NAME && npm install -g $LEGACY_PACKAGE_NAME@$legacy_version" ;;
  esac

  remove_legacy=$(get_remove_command "$pm" "$LEGACY_PACKAGE_NAME")
  install_fork=$(get_install_command "$pm")

  info "Migrating $LEGACY_PACKAGE_NAME to $PACKAGE_NAME with $pm..."
  if ! eval "$remove_legacy"; then
    error "Could not remove $LEGACY_PACKAGE_NAME."
    exit 1
  fi
  if ! eval "$install_fork"; then
    if restore_legacy_install "$pm" "$legacy_version"; then
      error "Fork installation failed; restored $LEGACY_PACKAGE_NAME@$legacy_version."
    else
      error "Fork installation failed, and rollback could not restore only $LEGACY_PACKAGE_NAME@$legacy_version."
      echo "  Recover with: $restore_hint"
    fi
    exit 1
  fi

  if ! fork_version=$(get_global_package_version "$pm" "$PACKAGE_NAME") \
    || ! remaining_legacy=$(get_global_package_version "$pm" "$LEGACY_PACKAGE_NAME"); then
    if restore_legacy_install "$pm" "$legacy_version"; then
      error "Could not read the post-install inventory; restored $LEGACY_PACKAGE_NAME@$legacy_version."
    else
      error "Could not read the post-install inventory, and rollback failed."
      echo "  Recover with: $restore_hint"
    fi
    exit 1
  fi
  if [ -z "$fork_version" ] || [ -n "$remaining_legacy" ]; then
    if restore_legacy_install "$pm" "$legacy_version"; then
      error "Could not verify that $PACKAGE_NAME owns the installation; restored $LEGACY_PACKAGE_NAME@$legacy_version."
    else
      error "Could not verify the fork installation, and rollback failed."
      echo "  Recover with: $restore_hint"
    fi
    exit 1
  fi
  success "Migrated OpenChamber to $PACKAGE_NAME@$fork_version."
  exit 0
}

# Install Node.js suggestion
suggest_node_install() {
  echo ""
  error "Node.js $MIN_NODE_VERSION+ is required but not found."
  echo ""
  echo "Install Node.js using one of these methods:"
  echo ""
  
  if [[ "${OSTYPE:-}" == "darwin"* ]]; then
    echo "  Using Homebrew:"
    echo "    brew install node"
    echo ""
  fi
  
  echo "  Using nvm (recommended):"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "    nvm install $MIN_NODE_MAJOR"
  echo ""
  echo "  Using fnm:"
  echo "    curl -fsSL https://fnm.vercel.app/install | bash"
  echo "    fnm install $MIN_NODE_MAJOR"
  echo ""
  echo "  Official installer:"
  echo "    https://nodejs.org/"
  echo ""
  exit 1
}

# Install package manager suggestion
suggest_pm_install() {
  echo ""
  error "No package manager found (npm, pnpm, yarn, or bun)."
  echo ""
  echo "Install a package manager:"
  echo ""
  echo "  npm (comes with Node.js):"
  echo "    Install Node.js from https://nodejs.org/"
  echo ""
  echo "  pnpm (recommended):"
  echo "    curl -fsSL https://get.pnpm.io/install.sh | sh -"
  echo ""
  echo "  bun:"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo ""
  echo "  yarn:"
  echo "    npm install -g yarn"
  echo ""
  exit 1
}

main() {
  echo ""
  echo "  ╭───────────────────────────────────╮"
  echo "  │                                   │"
  echo "  │   OpenChamber Installer           │"
  echo "  │   Web interface for OpenCode      │"
  echo "  │                                   │"
  echo "  ╰───────────────────────────────────╯"
  echo ""

  # Check Node.js
  info "Checking Node.js..."
  NODE_VERSION=$(get_node_version)

  if ! node_version_supported "$NODE_VERSION"; then
    if [ "$NODE_VERSION" = "0.0" ]; then
      suggest_node_install
    else
      error "Node.js $MIN_NODE_VERSION+ required, found v$NODE_VERSION"
      suggest_node_install
    fi
  fi
  success "Node.js v$NODE_VERSION found"

  # A legacy upstream package exports the same binary as this fork. Inventory
  # package managers even when their global bin is not on PATH, then migrate the
  # one legacy owner. Multiple owners need manual cleanup rather than guessing.
  legacy_pm=""
  fork_pm=""
  for candidate in pnpm yarn bun npm; do
    if ! command_exists "$candidate"; then
      continue
    fi
    if ! inventory=$(get_global_package_inventory "$candidate"); then
      continue
    fi
    legacy_version=$(printf '%s\n' "$inventory" | package_version_from_inventory "$LEGACY_PACKAGE_NAME")
    fork_version=$(printf '%s\n' "$inventory" | package_version_from_inventory "$PACKAGE_NAME")
    if [ -n "$legacy_version" ]; then
      if [ -n "$legacy_pm" ]; then
        error "$LEGACY_PACKAGE_NAME is installed by more than one package manager ($legacy_pm and $candidate)."
        echo "  Remove the duplicate global packages, then rerun this installer."
        exit 1
      fi
      legacy_pm=$candidate
    fi
    if [ -n "$fork_version" ]; then
      if [ -n "$fork_pm" ]; then
        error "$PACKAGE_NAME is installed by more than one package manager ($fork_pm and $candidate)."
        echo "  Remove the duplicate global packages, then rerun this installer."
        exit 1
      fi
      fork_pm=$candidate
    fi
  done
  if [ -n "$legacy_pm" ] && [ -n "$fork_pm" ]; then
    error "Both $LEGACY_PACKAGE_NAME and $PACKAGE_NAME are installed globally."
    echo "  Remove the duplicate package, then rerun this installer."
    exit 1
  fi
  if [ -n "$legacy_pm" ]; then
    migrate_legacy_install "$legacy_pm"
  fi
  if [ -n "$fork_pm" ] && ! command_exists "$BIN_NAME"; then
    INSTALL_CMD=$(get_install_command "$fork_pm")
    info "Repairing the existing $PACKAGE_NAME installation with $fork_pm..."
    eval "$INSTALL_CMD"
    repaired_version=$(get_global_package_version "$fork_pm" "$PACKAGE_NAME")
    if [ -z "$repaired_version" ] || ! command_exists "$BIN_NAME"; then
      error "$PACKAGE_NAME is installed, but this shell still cannot run $BIN_NAME."
      echo "  Check the $fork_pm global bin directory and PATH, then rerun this installer."
      exit 1
    fi
    success "OpenChamber is up to date."
    exit 0
  fi

  if command_exists "$BIN_NAME"; then
    info "OpenChamber is already installed — updating via 'openchamber update'..."
    echo ""
    if openchamber update; then
      echo ""
      success "OpenChamber is up to date!"
      exit 0
    fi
    echo ""
    error "Update failed."
    echo ""
    echo "  Try running it manually:"
    echo "    openchamber update"
    echo ""
    exit 1
  fi

  # Detect package manager
  info "Detecting package manager..."
  PM=$(detect_package_manager)
  
  if [ "$PM" = "none" ]; then
    suggest_pm_install
  fi
  success "Using $PM"

  # Get install command
  INSTALL_CMD=$(get_install_command "$PM")
  
  if [ -z "$INSTALL_CMD" ]; then
    error "Could not determine install command"
    exit 1
  fi

  # Install
  echo ""
  info "Installing OpenChamber..."
  echo "  Running: $INSTALL_CMD"
  echo ""
  
  if eval "$INSTALL_CMD"; then
    echo ""
    # Wordmark (toilet "pagga", "Open"/"Chamber" stacked).
    # Hardcoded so the user needs no extra tools.
    printf '%b' "$BLUE"
    cat <<'EOF'
  ░█▀█░█▀█░█▀▀░█▀█
  ░█░█░█▀▀░█▀▀░█░█
  ░▀▀▀░▀░░░▀▀▀░▀░▀
  ░█▀▀░█░█░█▀█░█▄█░█▀▄░█▀▀░█▀▄
  ░█░░░█▀█░█▀█░█░█░█▀▄░█▀▀░█▀▄
  ░▀▀▀░▀░▀░▀░▀░▀░▀░▀▀░░▀▀▀░▀░▀
EOF
    printf '%b\n' "$NC"
    success "OpenChamber installed successfully!"
    echo ""

    # Verify the binary is actually reachable. Global installs frequently
    # land in a directory that isn't on PATH — surface that instead of
    # letting the user hit a confusing "command not found".
    if command_exists "$BIN_NAME"; then
      echo "  Get started:"
      echo "    openchamber              # Start server on port 3000"
      echo "    openchamber --help       # Show all options"
    else
      warn "'$BIN_NAME' was installed but isn't on your PATH yet."
      echo ""
      bin_dir=""
      case "$PM" in
        npm)  bin_dir=$(npm prefix -g 2>/dev/null)/bin ;;
        pnpm) bin_dir=$(pnpm bin -g 2>/dev/null || true) ;;
        yarn) bin_dir=$(yarn global bin 2>/dev/null || true) ;;
        bun)  bin_dir="${BUN_INSTALL:-$HOME/.bun}/bin" ;;
      esac
      if [ -n "$bin_dir" ]; then
        echo "  Add it to your PATH (then restart your terminal):"
        echo "    export PATH=\"$bin_dir:\$PATH\""
      else
        echo "  Add your package manager's global bin directory to PATH,"
        echo "  then restart your terminal and run: openchamber"
      fi
    fi
    echo ""
    echo "  Prerequisites:"
    echo "    Make sure OpenCode is running: opencode serve"
    echo ""
  else
    echo ""
    error "Installation failed"
    echo ""
    echo "  Try running manually:"
    echo "    $INSTALL_CMD"
    echo ""
    echo "  If you get permission errors, see:"
    echo "    https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
    echo ""
    exit 1
  fi
}

main "$@"
