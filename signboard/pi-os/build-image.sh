#!/usr/bin/env bash
# Builds a flashable SignBoard OS image for Raspberry Pi 4 from the official
# Ubuntu Server 24.04 LTS (arm64, raspi) image.
#
# The image boots, installs the kiosk on first boot via cloud-init (needs internet,
# about 10-15 minutes), reboots, and from then on opens the SignBoard player full screen.
#
# Runs on Linux or WSL without root. Needs: curl xz python3 openssl mtools
#
#   ./build-image.sh --server http://192.168.1.10:3000 --wifi-ssid MyWifi --wifi-pass secret
set -euo pipefail

UBUNTU_VERSION="24.04.5"
SERVER_URL=""
WIFI_SSID=""
WIFI_PASS=""
WIFI_COUNTRY="TH"
HOSTNAME_="signboard"
PASSWORD="signboard"
TIMEZONE="Asia/Bangkok"
ROTATE="normal"
REBOOT_TIME="04:00"
SSH_KEY=""
OUT=""
COMPRESS=1
BOOT_FILES_DIR=""
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/signboard-os}"
HERE="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<EOF
Usage: $0 --server URL [options]

  --server URL         SignBoard server, e.g. http://192.168.1.10:3000   (required)
  --wifi-ssid NAME     Wi-Fi network (omit to use LAN cable only)
  --wifi-pass PASS     Wi-Fi password
  --wifi-country CC    Wi-Fi regulatory country (default: $WIFI_COUNTRY)
  --hostname NAME      Device hostname (default: $HOSTNAME_)
  --password PASS      Password of user "signage" for SSH (default: $PASSWORD)
  --ssh-key FILE       Public key to allow for SSH (e.g. ~/.ssh/id_ed25519.pub)
  --timezone TZ        Default: $TIMEZONE
  --rotate DIR         normal | left | right | inverted (default: $ROTATE)
  --reboot-time HH:MM  Daily reboot time, empty to disable (default: $REBOOT_TIME)
  --ubuntu VERSION     Ubuntu point release (default: $UBUNTU_VERSION)
  --out FILE           Output image (default: signboard-pi4-<date>.img[.xz])
  --no-compress        Leave the output as a raw .img
  --boot-files DIR     Only write user-data, network-config and signboard.conf to DIR
                       (copy them onto a freshly flashed Ubuntu SD card yourself)
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER_URL="$2"; shift 2 ;;
    --wifi-ssid) WIFI_SSID="$2"; shift 2 ;;
    --wifi-pass) WIFI_PASS="$2"; shift 2 ;;
    --wifi-country) WIFI_COUNTRY="$2"; shift 2 ;;
    --hostname) HOSTNAME_="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$(cat "$2")"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --rotate) ROTATE="$2"; shift 2 ;;
    --reboot-time) REBOOT_TIME="$2"; shift 2 ;;
    --ubuntu) UBUNTU_VERSION="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --no-compress) COMPRESS=0; shift ;;
    --boot-files) BOOT_FILES_DIR="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[ -n "$SERVER_URL" ] || usage
[[ "$SERVER_URL" =~ ^https?:// ]] || { echo "--server must start with http:// or https://"; exit 1; }
[[ "$ROTATE" =~ ^(normal|left|right|inverted)$ ]] || { echo "--rotate must be normal, left, right or inverted"; exit 1; }
[[ -z "$REBOOT_TIME" || "$REBOOT_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "--reboot-time must be HH:MM"; exit 1; }
TOOLS="python3 openssl"
[ -n "$BOOT_FILES_DIR" ] || TOOLS="$TOOLS curl xz mcopy"
for tool in $TOOLS; do
  command -v "$tool" >/dev/null || { echo "Missing '$tool'. On Ubuntu/Debian: sudo apt install curl xz-utils python3 openssl mtools"; exit 1; }
done

IMG_NAME="ubuntu-${UBUNTU_VERSION}-preinstalled-server-arm64+raspi.img"
BASE_URL="https://cdimage.ubuntu.com/releases/24.04/release"
[ -n "$OUT" ] || OUT="signboard-pi4-$(date +%Y%m%d).img"
OUT="${OUT%.xz}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------- 1. download and verify the Ubuntu image ----------
if [ -z "$BOOT_FILES_DIR" ]; then
mkdir -p "$CACHE_DIR"
if [ ! -f "$CACHE_DIR/$IMG_NAME.xz" ]; then
  echo "==> Downloading $IMG_NAME.xz"
  curl -fL --progress-bar -o "$CACHE_DIR/$IMG_NAME.xz.part" "$BASE_URL/$IMG_NAME.xz"
  mv "$CACHE_DIR/$IMG_NAME.xz.part" "$CACHE_DIR/$IMG_NAME.xz"
fi
echo "==> Verifying checksum"
EXPECTED=$(curl -fsSL "$BASE_URL/SHA256SUMS" | awk -v f="*$IMG_NAME.xz" '$2 == f {print $1}')
ACTUAL=$(sha256sum "$CACHE_DIR/$IMG_NAME.xz" | awk '{print $1}')
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Checksum mismatch; delete $CACHE_DIR/$IMG_NAME.xz and retry"; exit 1; }

echo "==> Decompressing to $OUT"
xz -dc "$CACHE_DIR/$IMG_NAME.xz" > "$OUT"

# ---------- 2. locate the FAT boot partition (partition 1) ----------
BOOT_OFFSET=$(python3 - "$OUT" <<'PY'
import struct, sys
with open(sys.argv[1], 'rb') as f:
    mbr = f.read(512)
assert mbr[510:512] == b'\x55\xaa', 'no MBR partition table'
start = struct.unpack('<I', mbr[446 + 8:446 + 12])[0]
print(start * 512)
PY
)
FAT="$OUT@@$BOOT_OFFSET"
mdir -i "$FAT" ::/user-data >/dev/null || { echo "Boot partition not found in image"; exit 1; }
fi

# ---------- 3. generate cloud-init config ----------
PASS_HASH=$(openssl passwd -6 "$PASSWORD")
indent() { sed 's/^/      /' "$1"; }
yaml_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

cat > "$WORK/signboard.conf" <<EOF
# SignBoard player settings. Edit this file on the SD card (boot partition) from any
# computer, then restart the Pi. Changes apply on the next boot.

# Address of the SignBoard server
SERVER_URL=$SERVER_URL

# Screen rotation: normal | left | right | inverted
ROTATE=$ROTATE
EOF

if [ -n "$REBOOT_TIME" ]; then
  REBOOT_CRON="${REBOOT_TIME#*:} ${REBOOT_TIME%:*} * * * root /sbin/shutdown -r now"
else
  REBOOT_CRON="# daily reboot disabled"
fi

cat > "$WORK/user-data" <<EOF
#cloud-config
# SignBoard kiosk: generated by build-image.sh
hostname: $HOSTNAME_
timezone: $TIMEZONE
locale: en_US.UTF-8
keyboard:
  layout: us

users:
  - name: signage
    gecos: SignBoard Player
    groups: [adm, audio, video, input, render, plugdev, sudo]
    shell: /bin/bash
    lock_passwd: false
    passwd: $(yaml_str "$PASS_HASH")
    sudo: "ALL=(ALL) NOPASSWD:ALL"
$( [ -n "$SSH_KEY" ] && printf '    ssh_authorized_keys:\n      - %s\n' "$(yaml_str "$SSH_KEY")" )
ssh_pwauth: true
chpasswd:
  expire: false

package_update: true
package_upgrade: true
packages:
  - xserver-xorg
  - xinit
  - x11-xserver-utils
  - openbox
  - unclutter
  - jq
  - avahi-daemon
  - fonts-noto-core
  - fonts-noto-color-emoji
  - fonts-thai-tlwg

snap:
  commands:
    - snap install chromium

write_files:
  - path: /etc/systemd/system/getty@tty1.service.d/autologin.conf
    content: |
      [Service]
      ExecStart=
      ExecStart=-/sbin/agetty --autologin signage --noclear %I \$TERM
  - path: /usr/local/bin/signboard-kiosk
    permissions: "0755"
    content: |
$(indent "$HERE/files/signboard-kiosk")
  - path: /home/signage/signboard/boot.html
    owner: signage:signage
    defer: true
    content: |
$(indent "$HERE/files/boot.html")
  - path: /home/signage/.xinitrc
    owner: signage:signage
    defer: true
    content: |
      exec /usr/local/bin/signboard-kiosk
  - path: /home/signage/.bash_profile
    owner: signage:signage
    defer: true
    content: |
      # Start the kiosk on the physical console only (not over SSH)
      if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ]; then
        exec startx -- -nocursor >/dev/null 2>&1
      fi
  - path: /etc/cron.d/signboard-reboot
    content: |
      $REBOOT_CRON
  - path: /etc/apt/apt.conf.d/52signboard-no-reboot
    content: |
      Unattended-Upgrade::Automatic-Reboot "false";

runcmd:
  - chown -R signage:signage /home/signage
  # Hide boot text and the blinking cursor on the TV
  - sed -i 's/\$/ quiet loglevel=3 vt.global_cursor_default=0 consoleblank=0/' /boot/firmware/cmdline.txt
  - grep -q '^disable_splash' /boot/firmware/config.txt || echo 'disable_splash=1' >> /boot/firmware/config.txt
  # Don't wait minutes at boot for a network interface that isn't plugged in
  - systemctl mask systemd-networkd-wait-online.service

power_state:
  mode: reboot
  message: SignBoard setup finished, rebooting into the player
  timeout: 30
  condition: true
EOF

# Netplan network config: Ethernet always, Wi-Fi if given
{
  cat <<EOF
version: 2
ethernets:
  eth0:
    dhcp4: true
    optional: true
EOF
  if [ -n "$WIFI_SSID" ]; then
    cat <<EOF
wifis:
  wlan0:
    dhcp4: true
    optional: true
    regulatory-domain: $WIFI_COUNTRY
    access-points:
      $(yaml_str "$WIFI_SSID"):
        password: $(yaml_str "$WIFI_PASS")
EOF
  else
    cat <<'EOF'
# Wi-Fi: remove the "#" in front of the lines below and fill in your network
#wifis:
#  wlan0:
#    dhcp4: true
#    optional: true
#    regulatory-domain: TH
#    access-points:
#      "WIFI-NAME":
#        password: "WIFI-PASSWORD"
EOF
  fi
} > "$WORK/network-config"

# ---------- 4. write config into the boot partition ----------
if [ -n "$BOOT_FILES_DIR" ]; then
  mkdir -p "$BOOT_FILES_DIR"
  cp "$WORK/user-data" "$WORK/network-config" "$WORK/signboard.conf" "$BOOT_FILES_DIR/"
  echo "Wrote user-data, network-config and signboard.conf to $BOOT_FILES_DIR"
  echo "Copy them onto the 'system-boot' drive of a flashed Ubuntu $UBUNTU_VERSION Raspberry Pi image, replacing the existing files."
  exit 0
fi
echo "==> Writing configuration to boot partition"
for f in user-data network-config signboard.conf; do
  mcopy -o -i "$FAT" "$WORK/$f" "::/$f"
done

if [ "$COMPRESS" = 1 ]; then
  echo "==> Compressing (this takes a few minutes)"
  xz -T0 -f "$OUT"
  OUT="$OUT.xz"
fi

cat <<EOF

Done: $OUT

Flash it with Raspberry Pi Imager ("Use custom") or balenaEtcher, then boot the Pi 4
with the screen and network connected. First boot installs the kiosk (10-15 min,
needs internet) and reboots into the player, which shows a pairing code.

SSH: ssh signage@$HOSTNAME_.local   (password: the one you set)
Change the server later: edit signboard.conf on the SD card's boot partition.
EOF
