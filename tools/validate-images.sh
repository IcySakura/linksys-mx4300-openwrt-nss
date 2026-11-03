#!/bin/bash
# Static validation of the MX4300 PPE + NSS build outputs.
#   tools/validate-images.sh BIN_DIR
# Needs: dtc, unsquashfs, strings, python3.
set -uo pipefail

BIN=${1:?usage: $0 BIN_DIR}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail=0
ok()   { echo "  OK   $*"; }
bad()  { echo "  FAIL $*"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

SYSUPG=$(ls "$BIN"/*linksys_mx4300-squashfs-sysupgrade.bin 2>/dev/null | head -1)
FACTORY=$(ls "$BIN"/*linksys_mx4300-squashfs-factory.bin 2>/dev/null | head -1)

echo "== Files"
for f in "$SYSUPG" "$FACTORY"; do
	check "present: $(basename "${f:-missing}")" "[ -s '${f:-/nonexistent}' ]"
done
[ -s "$SYSUPG" ] || exit 1

echo "== sysupgrade.bin"
tar tf "$SYSUPG" > "$WORK/tar.txt" 2>/dev/null
check "tar has sysupgrade-linksys_mx4300/{kernel,root}" "grep -qx 'sysupgrade-linksys_mx4300/kernel' '$WORK/tar.txt' && grep -qx 'sysupgrade-linksys_mx4300/root' '$WORK/tar.txt'"
check "metadata lists linksys,mx4300" "strings '$SYSUPG' | tail -c 2000 | grep -q 'linksys,mx4300'"
tar xf "$SYSUPG" -C "$WORK" 2>/dev/null
KERNEL=$WORK/sysupgrade-linksys_mx4300/kernel
ROOT=$WORK/sysupgrade-linksys_mx4300/root
check "kernel fits KERNEL_SIZE (8 MiB)" "[ \$(stat -c%s '$KERNEL') -le $((8192 * 1024)) ]"
check "root is squashfs" "[ \"\$(head -c4 '$ROOT')\" = 'hsqs' ]"

echo "== FIT (kernel)"
dtc -I dtb -O dts -o "$WORK/fit.dts" "$KERNEL" 2>/dev/null
check "FIT kernel arch arm64" "grep -q 'arch = \"arm64\"' '$WORK/fit.dts'"
python3 -I - "$KERNEL" "$WORK/board.dtb" <<'EOF'
import sys, struct
# Extract the first fdt image's data from the FIT via a minimal FDT walk.
d = open(sys.argv[1], 'rb').read()
magic, totalsize, off_struct, off_strings = struct.unpack_from('>IIII', d, 0)
p, path, strings = off_struct, [], d[off_strings:]
while True:
    tok, = struct.unpack_from('>I', d, p); p += 4
    if tok == 1:
        e = d.index(b'\0', p); path.append(d[p:e].decode()); p = (e + 4) & ~3
    elif tok == 2:
        path.pop()
    elif tok == 3:
        ln, no = struct.unpack_from('>II', d, p); p += 8
        name = strings[no:strings.index(b'\0', no)].decode()
        if name == 'data' and len(path) >= 2 and path[-2] == 'images' and path[-1].startswith('fdt'):
            open(sys.argv[2], 'wb').write(d[p:p+ln]); break
        p = (p + ln + 3) & ~3
    elif tok == 9:
        sys.exit("no fdt image found")
EOF
D=$WORK/board.dts
dtc -I dtb -O dts -o "$D" "$WORK/board.dtb" 2>/dev/null
check "model Linksys MX4300" "grep -q 'model = \"Linksys MX4300\"' '$D'"
# dtc < 1.8 prints string lists as "a\0b" rather than "a", "b"
check "compatible linksys,mx4300" "grep -Eq 'compatible = \"linksys,mx4300(\"|\\\\0)' '$D'"

echo "== rootfs contents"
unsquashfs -q -d "$WORK/rootfs" "$ROOT" >/dev/null 2>&1
R=$WORK/rootfs
for f in usr/sbin/fw_printenv usr/sbin/fw_setenv sbin/mtd etc/mx4300-nss/build-info \
	etc/init.d/bootcount etc/init.d/smp_affinity; do
	check "has /$f" "[ -e '$R/$f' ]"
done
check "NSS firmware" "ls '$R'/lib/firmware/ | grep -qi nss"
check "NSS Wi-Fi offload module" "ls '$R'/lib/modules/*/ | grep -qi 'nss'"
check "flow offload module (nft_flow_offload)" "ls '$R'/lib/modules/*/ | grep -q '^nft_flow_offload.ko'"
check "ath11k for the MX4300 radios" "ls '$R'/lib/modules/*/ | grep -q '^ath11k_ahb.ko'"
check "bootcount and boot counter reset can be held" "grep -q bootcount.hold '$R/etc/init.d/bootcount' && ls '$R'/etc/rc.d/ | grep -q '^S99bootcount$'"
for s in etc/init.d/bootcount lib/upgrade/platform.sh; do
	check "sh -n /$s" "sh -n '$R/$s'"
done

check "default theme switch (uci-defaults/99-default-theme)" "[ -x '$R/etc/uci-defaults/99-default-theme' ]"
# Package sources must all exist on downloads.openwrt.org (apk update fails otherwise)
check "package sources: only feeds OpenWrt publishes" "! grep -E '^https?://' '$R/etc/apk/repositories.d/distfeeds.list' | grep -vqE '/(targets/[^/]+/[^/]+/packages|packages/[^/]+/(base|packages|luci|routing|telephony|video))/packages\\.adb\$'"

if [ -e "$R/usr/sbin/mx4300-ota" ]; then
	check "sh -n /usr/sbin/mx4300-ota" "sh -n '$R/usr/sbin/mx4300-ota'"
	check "mx4300-ota init enabled (S98, before the S99 bootcount reset)" "ls '$R'/etc/rc.d/ | grep -q '^S98mx4300-ota$'"
	check "LuCI view for mx4300-ota" "[ -e '$R/www/luci-static/resources/view/mx4300-ota.js' ]"
	check "release key for mx4300-ota" "[ -s '$R/etc/mx4300-nss/release.pub' ]"
	check "mx4300-ota what's new: details.uc, components.json, history kept" "[ -s '$R/usr/share/mx4300-ota/details.uc' ] && [ -s '$R/etc/mx4300-nss/components.json' ] && grep -q '/etc/mx4300-ota/' '$R/lib/upgrade/keep.d/mx4300-ota'"
	check "TLS for the updater's downloads (libustream)" "ls '$R'/lib/ '$R'/usr/lib/ 2>/dev/null | grep -q '^libustream-'"
	grep -q '^OTA_REPO=.' "$R/etc/mx4300-nss/build-info" ||
		echo "  NOTE no OTA_REPO in build-info: set mx4300-ota.main.repo on the router"
fi

# Every package the profile asks for is installed in the image
if [ -s "$R/etc/mx4300-nss/profile.packages" ] && [ -s "$R/lib/apk/db/installed" ]; then
	missing=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$R/etc/mx4300-nss/profile.packages" |
		grep -v -e '^$' -e '^-' -e '_INCLUDE_' | while read -r p; do
			grep -qx "P:$p" "$R/lib/apk/db/installed" || echo "$p"
		done)
	check "every profile package installed${missing:+ (missing: $(echo $missing))}" "[ -z '$missing' ]"
fi

echo
[ $fail = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $fail
