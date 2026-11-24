#!/usr/bin/env bash
# Sign KuroCat for macOS with a stable identity so privacy permissions survive updates.
#
# macOS stores Accessibility / Input Monitoring grants together with the app's designated
# requirement. An ad hoc signature pins that requirement to the binary hash, so every release
# looks like a different app and users have to grant the permissions again. Signing every
# release with the same certificate (a self-signed one is enough) keeps the requirement at
# identifier "com.kurocat.pet" and certificate leaf = H"...", which later releases satisfy.
#
# 'sign' picks the identity in this order:
#   1. MACOS_SIGNING_CERT_P12_BASE64 + MACOS_SIGNING_CERT_PASSWORD (CI secrets), imported into
#      a temporary keychain that is deleted afterwards. Setting only one of them, or a
#      certificate that cannot be imported, is an error.
#   2. MACOS_SIGNING_IDENTITY, a certificate name or SHA-1 already in your keychain.
#   3. Nothing configured: keep an existing valid signature or sign ad hoc, and warn that
#      users have to grant the permissions again after updating. The release still succeeds.
set -euo pipefail

CERT_NAME="${MACOS_SIGNING_CERT_NAME:-KuroCat Code Signing}"
SECRET_HINT="Fix the secrets, or delete both of them to fall back to ad hoc signing."
WORK_DIR=""
TEMP_KEYCHAIN=""
MOUNT_POINT=""

usage() {
  cat <<'EOF'
Usage:
  scripts/macos-codesign.sh create-cert <output-dir>
  scripts/macos-codesign.sh sign <KuroCat.app>
  scripts/macos-codesign.sh sign-local <KuroCat.app>
  scripts/macos-codesign.sh requirement <KuroCat.app>
  scripts/macos-codesign.sh verify <KuroCat.app> [designated-requirement]
  scripts/macos-codesign.sh verify-artifact <file.dmg|file.app.tar.gz> <designated-requirement>
EOF
  exit "${1:-2}"
}

die() {
  echo "error: $*" >&2
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::error::$*"
  fi
  exit 1
}

warn() {
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::warning::$*"
  else
    echo "warning: $*" >&2
  fi
}

step_summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 ||
      hdiutil detach -force "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$TEMP_KEYCHAIN" ]]; then
    security delete-keychain "$TEMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

bundle_id() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist"
}

designated_requirement() {
  codesign -d -r- "$1" 2>&1 | sed -n 's/^#* *designated => //p'
}

print_requirement() {
  local requirement
  requirement="$(designated_requirement "$1")"
  [[ -n "$requirement" ]] || die "$1 has no designated requirement"
  echo "$requirement"
}

verify_app() {
  local app="$1" requirement="${2:-}"
  codesign --verify --strict --all-architectures --verbose=2 \
    -R "=identifier \"$(bundle_id "$app")\"" "$app" || return 1
  if [[ -n "$requirement" ]]; then
    codesign --verify --strict --all-architectures -R "=$requirement" "$app" || return 1
    echo "$app: satisfies the expected designated requirement"
  fi
}

find_app() {
  find "$1" -maxdepth 1 -name '*.app' -type d -print -quit
}

sign_with_p12() {
  local app="$1" id="$2" keychain_password identity
  WORK_DIR="$(mktemp -d)"
  TEMP_KEYCHAIN="$WORK_DIR/kurocat-signing.keychain-db"
  keychain_password="$(uuidgen)"

  printf '%s' "$MACOS_SIGNING_CERT_P12_BASE64" | tr -d '[:space:]' |
    base64 --decode > "$WORK_DIR/signing.p12" 2>/dev/null ||
    die "MACOS_SIGNING_CERT_P12_BASE64 is not valid base64. $SECRET_HINT"
  [[ -s "$WORK_DIR/signing.p12" ]] || die "MACOS_SIGNING_CERT_P12_BASE64 is empty. $SECRET_HINT"

  security create-keychain -p "$keychain_password" "$TEMP_KEYCHAIN"
  security set-keychain-settings -lut 3600 "$TEMP_KEYCHAIN"
  security unlock-keychain -p "$keychain_password" "$TEMP_KEYCHAIN"
  security import "$WORK_DIR/signing.p12" -k "$TEMP_KEYCHAIN" \
    -P "$MACOS_SIGNING_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null 2>&1 ||
    die "could not import the certificate. MACOS_SIGNING_CERT_P12_BASE64 must be the base64 of kurocat-signing.p12 and MACOS_SIGNING_CERT_PASSWORD its password. $SECRET_HINT"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
    -k "$keychain_password" "$TEMP_KEYCHAIN" >/dev/null

  # A self-signed certificate is listed as untrusted; codesign still signs with it.
  identity="$(security find-identity -p codesigning "$TEMP_KEYCHAIN" |
    awk '/^[[:space:]]*[0-9]+\)/ { print $2; exit }')"
  [[ -n "$identity" ]] || die "the certificate contains no code signing identity. $SECRET_HINT"

  echo "Signing $app with certificate SHA-1 $identity"
  codesign --force --sign "$identity" --keychain "$TEMP_KEYCHAIN" \
    --identifier "$id" --timestamp=none "$app"
}

sign_app() {
  local app="$1" id requirement
  local p12="${MACOS_SIGNING_CERT_P12_BASE64:-}" password="${MACOS_SIGNING_CERT_PASSWORD:-}"
  [[ -d "$app" ]] || die "app bundle not found: $app"
  id="$(bundle_id "$app")"

  if [[ -n "$p12" || -n "$password" ]]; then
    [[ -n "$p12" && -n "$password" ]] ||
      die "MACOS_SIGNING_CERT_P12_BASE64 and MACOS_SIGNING_CERT_PASSWORD must be set together. $SECRET_HINT"
    sign_with_p12 "$app" "$id"
  elif [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
    echo "Signing $app with $MACOS_SIGNING_IDENTITY"
    codesign --force --sign "$MACOS_SIGNING_IDENTITY" --identifier "$id" --timestamp=none "$app"
  elif verify_app "$app" >/dev/null 2>&1; then
    echo "Keeping the existing valid signature of $app"
  else
    echo "Signing $app ad hoc"
    codesign --force --sign - --identifier "$id" "$app"
  fi

  verify_app "$app" || die "$app failed signature verification after signing"
  requirement="$(print_requirement "$app")"
  echo "Designated requirement: $requirement"
  if [[ "$requirement" == *cdhash* ]]; then
    warn "KuroCat is signed ad hoc, so users have to grant Accessibility and Input Monitoring again after every update. Set MACOS_SIGNING_CERT_P12_BASE64 and MACOS_SIGNING_CERT_PASSWORD to keep the grants."
    step_summary "macOS signing: ad hoc. Users have to grant Accessibility and Input Monitoring again after updating."
  else
    step_summary "macOS signing: $requirement"
  fi
}

sign_local_app() {
  local app="$1"
  local signing_dir="$HOME/Library/Application Support/KuroCat Local Signing"
  if [[ ! -f "$signing_dir/kurocat-signing.p12" ]]; then
    (CERT_NAME="KuroCat Local Code Signing"; create_cert "$signing_dir") >/dev/null
  fi

  # Reuse the same certificate for every local reinstall so macOS recognizes the app.
  if [[ -x "$signing_dir/rcodesign" ]]; then
    "$signing_dir/rcodesign" sign --timestamp-url none \
      --p12-file "$signing_dir/kurocat-signing.p12" \
      --p12-password-file "$signing_dir/kurocat-signing.password" "$app"
    verify_app "$app"
    print_requirement "$app"
    return
  fi

  local MACOS_SIGNING_CERT_P12_BASE64 MACOS_SIGNING_CERT_PASSWORD
  MACOS_SIGNING_CERT_P12_BASE64="$(cat "$signing_dir/kurocat-signing.p12.base64")"
  MACOS_SIGNING_CERT_PASSWORD="$(cat "$signing_dir/kurocat-signing.password")"
  sign_app "$app"
}

verify_artifact() {
  local file="$1" requirement="$2" app="" mounted="" attempt
  [[ -f "$file" ]] || die "release artifact not found: $file"
  [[ -n "$requirement" ]] || die "no designated requirement given for $file"
  WORK_DIR="$(mktemp -d)"

  case "$file" in
    *.dmg)
      MOUNT_POINT="$WORK_DIR/mnt"
      mkdir -p "$MOUNT_POINT"
      for attempt in 1 2 3; do
        if hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$file" >/dev/null; then
          mounted=1
          break
        fi
        sleep $((attempt * 3))
      done
      [[ -n "$mounted" ]] || die "could not mount $file"
      app="$(find_app "$MOUNT_POINT")"
      ;;
    *.tar.gz | *.tgz)
      tar -xzf "$file" -C "$WORK_DIR"
      app="$(find_app "$WORK_DIR")"
      ;;
    *)
      die "unsupported release artifact: $file"
      ;;
  esac

  [[ -n "$app" ]] || die "no .app bundle found in $file"
  verify_app "$app" "$requirement" || die "the app in $file is not signed as expected"
  echo "$file: verified"
}

create_cert() {
  local out="$1" fingerprint
  [[ ! -e "$out/kurocat-signing.p12" ]] ||
    die "$out/kurocat-signing.p12 already exists. Keep using it: a new certificate makes users grant the permissions again."
  command -v openssl >/dev/null || die "openssl is required"

  umask 077
  mkdir -p "$out"
  if git -C "$out" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    rmdir "$out" 2>/dev/null || true
    die "$out is inside a git work tree; keep the private key outside the repository"
  fi

  WORK_DIR="$(mktemp -d)"
  cat > "$WORK_DIR/openssl.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = codesign
prompt = no
[ dn ]
CN = $CERT_NAME
[ codesign ]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
  openssl req -new -x509 -newkey rsa:2048 -nodes -days 7300 -sha256 \
    -config "$WORK_DIR/openssl.cnf" \
    -keyout "$WORK_DIR/signing.key" -out "$out/kurocat-signing.crt" >/dev/null 2>&1 ||
    die "openssl could not create the certificate"

  KUROCAT_P12_PASSWORD="$(openssl rand -base64 24)"
  export KUROCAT_P12_PASSWORD
  # 3DES / SHA-1 keeps the PKCS#12 file importable by the macOS security tool.
  openssl pkcs12 -export -name "$CERT_NAME" \
    -inkey "$WORK_DIR/signing.key" -in "$out/kurocat-signing.crt" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
    -passout env:KUROCAT_P12_PASSWORD -out "$out/kurocat-signing.p12"
  base64 -i "$out/kurocat-signing.p12" -o "$out/kurocat-signing.p12.base64"
  printf '%s' "$KUROCAT_P12_PASSWORD" > "$out/kurocat-signing.password"
  fingerprint="$(openssl x509 -in "$out/kurocat-signing.crt" -noout -fingerprint -sha1 |
    cut -d= -f2 | tr -d ':')"

  cat <<EOF
Created a self-signed code signing certificate, valid for 20 years.
  Certificate SHA-1: $fingerprint
  Files: $out/kurocat-signing.p12, kurocat-signing.p12.base64, kurocat-signing.password

Add it to the repository's GitHub Actions secrets:
  gh secret set MACOS_SIGNING_CERT_P12_BASE64 < "$out/kurocat-signing.p12.base64"
  gh secret set MACOS_SIGNING_CERT_PASSWORD < "$out/kurocat-signing.password"

Back up kurocat-signing.p12 and its password, and sign every release with this certificate.
With a different certificate macOS treats KuroCat as a new app, and users have to grant
the permissions again.
EOF
}

case "${1:-}" in
  create-cert) [[ $# -eq 2 ]] || usage; create_cert "$2" ;;
  sign) [[ $# -eq 2 ]] || usage; sign_app "$2" ;;
  sign-local) [[ $# -eq 2 ]] || usage; sign_local_app "$2" ;;
  requirement) [[ $# -eq 2 ]] || usage; print_requirement "$2" ;;
  verify) [[ $# -ge 2 && $# -le 3 ]] || usage; verify_app "$2" "${3:-}" ;;
  verify-artifact) [[ $# -eq 3 ]] || usage; verify_artifact "$2" "$3" ;;
  -h | --help | help) usage 0 ;;
  *) usage ;;
esac
