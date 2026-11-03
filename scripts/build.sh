#!/bin/bash
# Reproducible build of OpenWrt with PPE + NSS offload for the Linksys MX4300.
#
#   scripts/build.sh [-j N] [--clean] [--profile NAME]... [--overlay DIR]...
#
# Fetches the pinned upstream tree (upstream/openwrt.conf) into $SRC, applies
# patches/*.patch, pins the feeds (upstream/feeds.conf) and the third-party
# sources (upstream/third-party.conf), applies patches/feeds/FEED/*.patch, then
# builds one image per profile (profiles/NAME.packages, default: "default") in
# the same tree, so every profile after the first is an incremental build.
# Each profile gets overlays/common (if present) plus any --overlay
# directories as the image's "files/".
#
# Results: $OUT/<profile>/ (images, manifest, config, sha256sums), validated
# with tools/validate-images.sh.
#
# Every image gets configs/base.packages (the OTA updater from feeds/mx4300)
# before its profile, and keys/release.pub as the key releases are checked with.
#
# Environment: SRC (default build/openwrt), DL_DIR (default build/dl),
# OUT (default out), OTA_REPO (GitHub owner/name the updater installs releases
# from; default: from the "origin" remote), RELEASE_TAG (the release these
# images are published as).
set -euo pipefail

# Parse the whole script before running it, so editing it mid-build is safe.
{

TOP=$(cd "$(dirname "$0")/.." && pwd)
SRC=${SRC:-$TOP/build/openwrt}
EXTRA=$(dirname "$SRC")/extra
DL_DIR=${DL_DIR:-$TOP/build/dl}
OUT=${OUT:-$TOP/out}
JOBS=$(nproc)
CLEAN=
PROFILES=()
OVERLAYS=()

while [ $# -gt 0 ]; do
	case "$1" in
	-j) JOBS=$2; shift ;;
	-j*) JOBS=${1#-j} ;;
	--clean) CLEAN=1 ;;
	--profile) PROFILES+=("$2"); shift ;;
	--overlay) OVERLAYS+=("$(cd "$2" && pwd)"); shift ;;
	*) echo "usage: $0 [-j N] [--clean] [--profile NAME]... [--overlay DIR]..." >&2; exit 2 ;;
	esac
	shift
done
[ ${#PROFILES[@]} -gt 0 ] || PROFILES=(default)
for p in "${PROFILES[@]}"; do
	[ -f "$TOP/profiles/$p.packages" ] || { echo "no such profile: profiles/$p.packages" >&2; exit 2; }
done

# OpenWrt's host tools trip over unusual PATH entries (e.g. the Windows
# directories WSL appends, which contain spaces): drop those, keep the rest
# (some distributions keep host tools such as pod2man outside /usr/bin).
PATH=$(echo "$PATH" | tr ':' '\n' | grep -v -e '^/mnt/' -e ' ' | paste -sd: -)
export PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}

. "$TOP/upstream/openwrt.conf"
REPO_COMMIT=$(git -C "$TOP" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
if [ -z "${OTA_REPO+set}" ]; then
	OTA_REPO=$(git -C "$TOP" remote get-url origin 2>/dev/null |
		sed -nE 's#^(https://|git@|ssh://git@)github\.com[:/]([^/]+/[^/]+)$#\2#p' | sed 's/\.git$//')
fi
RELEASE_TAG=${RELEASE_TAG:-}
THIRD_PARTY=$(sed -e 's/#.*//' "$TOP/upstream/third-party.conf" | awk 'NF')

# --- Source tree --------------------------------------------------------------
if [ ! -d "$SRC/.git" ]; then
	mkdir -p "$SRC"
	git -C "$SRC" init -q
	git -C "$SRC" remote add origin "$OPENWRT_URL"
fi

cd "$SRC"
STAMP=$( (echo "$OPENWRT_URL $OPENWRT_COMMIT"; cat "$TOP"/patches/*.patch) | sha256sum | cut -d' ' -f1)
if [ "$(cat .mx4300-nss-stamp 2>/dev/null)" != "$STAMP" ] || [ -n "$CLEAN" ]; then
	echo ">>> Checking out $OPENWRT_COMMIT and applying patches"
	git fetch -q --depth 1 origin "$OPENWRT_COMMIT"
	git checkout -q -f --detach "$OPENWRT_COMMIT"
	git clean -q -fd -- target package
	git -c user.name=mx4300-nss-build -c user.email=mx4300-nss-build@localhost \
		am -q --keep-cr "$TOP"/patches/*.patch
	rm -rf tmp/info
	echo "$STAMP" > .mx4300-nss-stamp
fi

mkdir -p "$DL_DIR"
[ -e dl ] || ln -s "$DL_DIR" dl

# --- Feeds ----------------------------------------------------------------------
# Single-package repositories, checked out into one local feed
rm -rf "$EXTRA.new"
mkdir -p "$EXTRA.new"
echo "$THIRD_PARTY" | while read -r name url branch commit type; do
	[ "$type" = package ] || continue
	if [ ! -d "$EXTRA/$name/.git" ]; then
		git init -q "$EXTRA.new/$name"
		git -C "$EXTRA.new/$name" remote add origin "$url"
	else
		mv "$EXTRA/$name" "$EXTRA.new/$name"
	fi
	git -C "$EXTRA.new/$name" fetch -q --depth 1 origin "$commit"
	git -C "$EXTRA.new/$name" checkout -q -f --detach "$commit"
	git -C "$EXTRA.new/$name" clean -q -fdx
done
rm -rf "$EXTRA"
mv "$EXTRA.new" "$EXTRA"

{
	grep -E '^src-' "$TOP/upstream/feeds.conf"
	echo "$THIRD_PARTY" | awk '$5 == "feed" { print "src-git " $1 " " $2 "^" $4 }'
	echo "src-link extra $EXTRA"
	echo "src-link mx4300 $TOP/feeds/mx4300"
} > feeds.conf

# Undo the feed patches of an earlier run, so the feeds can move
for d in feeds/*/; do
	[ -d "$d.git" ] && git -C "$d" checkout -q -- . 2>/dev/null || true
done
./scripts/feeds update -a

for p in "$TOP"/patches/feeds/*/*.patch; do
	[ -e "$p" ] || continue
	feed=feeds/$(basename "$(dirname "$p")")
	echo ">>> Patching $feed with $(basename "$p")"
	patch -p1 -s -d "$feed" --forward < "$p"
done
rm -rf tmp/info

./scripts/feeds install -a
# Third-party packages win over same-named ones in the OpenWrt feeds
for feed in $(echo "$THIRD_PARTY" | awk '$5 == "feed" { print $1 }') extra; do
	./scripts/feeds install -a -f -p "$feed"
done

# --- One image per profile ------------------------------------------------------
BIN=bin/targets/qualcommax/ipq807x
DEV=linksys_mx4300
for PROFILE in "${PROFILES[@]}"; do
	echo ">>> Profile $PROFILE"

	rm -rf files
	mkdir -p files/etc/mx4300-nss
	[ ! -d "$TOP/overlays/common" ] || cp -a "$TOP/overlays/common/." files/
	for o in "${OVERLAYS[@]}"; do cp -a "$o/." files/; done
	[ ! -s "$TOP/keys/release.pub" ] || cp "$TOP/keys/release.pub" files/etc/mx4300-nss/release.pub
	cp "$TOP/profiles/$PROFILE.packages" files/etc/mx4300-nss/profile.packages
	cat > files/etc/mx4300-nss/build-info <<-EOF
		PROFILE=$PROFILE
		RELEASE_TAG=$RELEASE_TAG
		OTA_REPO=$OTA_REPO
		REPO_COMMIT=$REPO_COMMIT
		UPSTREAM_RELEASE=${OPENWRT_RELEASE:-}
		UPSTREAM_COMMIT=$OPENWRT_COMMIT
		BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	EOF

	cp "$TOP/configs/mx4300-nss.config" .config
	"$TOP/scripts/profile.sh" apply .config "$TOP/configs/base.packages" "$TOP/profiles/$PROFILE.packages"
	make defconfig >/dev/null
	# defconfig drops a symbol it cannot select without a word; here that is an
	# error. Only the requested-on ones: a requested "=n" can come back on as a
	# dependency of something else.
	dropped=$(grep -E '^CONFIG_[A-Za-z0-9_-]+=' "$TOP/configs/mx4300-nss.config" | grep -v '=n$' |
		while read -r l; do grep -qxF "$l" .config || echo "$l"; done)
	[ -z "$dropped" ] || { echo "defconfig dropped from configs/mx4300-nss.config:" >&2; echo "$dropped" >&2; exit 1; }
	# The router's package sources (/etc/apk/repositories.d/distfeeds.list)
	# list a feed when its CONFIG_FEED_ is set. Only the feeds OpenWrt
	# publishes exist on downloads.openwrt.org; the others are built into the
	# image, and an unreachable source makes "apk update" fail.
	for f in $(awk '/^src-/ { print $2 }' feeds.conf); do
		case "$f" in packages|luci|routing|telephony|video) continue ;; esac
		sed -i "s/^CONFIG_FEED_$f=y\$/# CONFIG_FEED_$f is not set/" .config
	done
	"$TOP/scripts/profile.sh" check .config "$TOP/configs/base.packages" "$TOP/profiles/$PROFILE.packages"

	rm -f "$BIN"/*"$DEV"*
	make -j"$JOBS" download
	make -j"$JOBS" || make -j1 V=s

	dest=$OUT/$PROFILE
	rm -rf "$dest"
	mkdir -p "$dest"
	cp "$BIN"/*"$DEV"* "$BIN"/profiles.json "$dest"/
	cp .config "$dest/config.full"
	cp files/etc/mx4300-nss/build-info "$dest/build-info"
	(cd "$dest" && sha256sum -- *"$DEV"* > sha256sums)

	"$TOP/tools/validate-images.sh" "$dest"
	echo ">>> Images in $dest"
done
exit 0
}
