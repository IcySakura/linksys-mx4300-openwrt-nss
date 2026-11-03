# OpenWrt with PPE + NSS offload for the Linksys MX4300

OpenWrt for the **Linksys MX4300** (IPQ8174) with the SoC's offload engines in
use: routed, NAT, PPPoE and bridged wired traffic is forwarded by the **PPE**
(the packet engine in the switch) through OpenWrt's own flowtable, and the
Wi-Fi data path of all three radios runs on the **NSS** cores. Stock OpenWrt
forwards all of it on the CPU.

This repository does not carry its own OpenWrt tree. It pins
[openwrt-ppe-nss](https://github.com/JuliusBairaktaris/openwrt-ppe-nss) (OpenWrt
main with the offload work, kernel 6.18) at the commits its own
[builder](https://github.com/JuliusBairaktaris/Qualcommax_NSS_Builder) has
published images from, and adds:

- **Your packages, third-party ones included, built into the image** (package
  profiles). An upgrade replaces the whole image, so this is what keeps
  software from feeds outside OpenWrt across upgrades.
- **Signed A/B firmware updates in LuCI** (*System → Firmware Update*), with a
  trial boot and automatic rollback to the previous firmware.
- **Automatic builds**: GitHub Actions rebuilds when upstream publishes a new
  build or a third-party source moves, and publishes it as a testing release.

> [!WARNING]
> Experimental firmware for **the MX4300 only**. It is a snapshot (OpenWrt
> main), not a stable release. The MX4300 is usually the main router of a
> network: plan the first install for a time when you can be at the router,
> and know how to get back ([Recovery](#recovery)).

## Status

| | |
|---|---|
| Boot, settings kept from stock OpenWrt | ⚠️ not tested yet |
| PPE wired offload, NSS Wi-Fi offload | ⚠️ upstream feature; not tested with this build yet |
| Firmware updates with trial boot and rollback | ⚠️ not tested yet |

## What this build adds

- **Upstream tree:** `upstream/openwrt.conf` and `upstream/feeds.conf` pin the
  tree and every feed to the state of one upstream builder release, so a build
  is reproducible and matches images other people run.
- **Build configuration** (`configs/mx4300-nss.config`): the upstream builder's
  offload setup (PPE flowtable offload, `nss-wifi-drv` with NSS firmware 12.5,
  SQM through the PPE shaper with `luci-app-sqm` and `luci-app-qca-ppe-qos`),
  OpenSSL throughout, and the kernel modules most often wanted (USB storage,
  TUN, WireGuard) built in.
- **Third-party software** (`upstream/third-party.conf`): sources outside
  OpenWrt, pinned to a commit like the feeds. The `extended` profile uses
  Passwall and the Aurora LuCI theme from there.
- **Firmware updates** (`feeds/mx4300/`, `patches/0001`): see
  [Firmware updates](#firmware-updates).

## How booting works

The MX4300 has two firmware partitions. U-Boot boots the one named by
`boot_part` in its environment (1 or 2) and counts boots in the `s_env`
partition; after three boots that do not finish (the counter is reset at the
end of every complete boot, by `/etc/init.d/bootcount`) it switches to the
other partition. A sysupgrade always writes the partition that is **not**
running and switches `boot_part` to it, so the previous firmware stays in
place as the fallback.

`patches/0001` lets the boot counter reset be held while
`/var/run/bootcount.hold` exists. The firmware updater holds it during a trial
boot.

## Installing

### From OpenWrt

Any recent OpenWrt on the MX4300 (stock 24.10/25.12 or another build):

1. Take a backup (*System → Backup / Flash Firmware → Generate archive*).
2. Flash `*-<profile>-squashfs-sysupgrade.bin` in *System → Backup / Flash
   Firmware*, keeping settings. Compare the SHA256 LuCI shows with the
   release's `sha256sums`.

The firmware you came from stays in the other partition. Packages you had
installed with `apk add` are not carried over: put them in a profile first
([Packages](#packages)).

After the first boot:

- `irqbalance` should not run: the target pins the Wi-Fi and Ethernet
  interrupts itself (`/etc/init.d/smp_affinity`), and irqbalance undoes that.
- *Network → Firewall → Routing/NAT Offloading*: the target turns on hardware
  flow offloading on first boot if it was never set. Leave it on.
- Check that traffic is offloaded: `ppe-help` prints a diagnostic report.

### From the Linksys firmware

Install stock OpenWrt first, following the
[MX4300 page of the OpenWrt wiki](https://openwrt.org/toh/linksys/mx4300), then
continue as above. The `factory.bin` of the releases is built but not tested.

## Upgrading

Settings are kept. **Packages installed with `apk add` are not**: an upgrade
replaces the whole system image. Put everything you want to keep into a
profile, so the image you upgrade to already contains it. The image records
its build in `/etc/mx4300-nss/build-info`.

- **In LuCI:** *System → Firmware Update* → *Show releases* → *Install*.
- **On the command line:** `mx4300-ota check`, then `mx4300-ota upgrade`.
- **By hand**, e.g. with an image built without the updater: flash the
  `*-<profile>-squashfs-sysupgrade.bin` of the profile you run in LuCI or
  with `sysupgrade`, after checking it:

  ```sh
  usign -V -m sha256sums -p /etc/mx4300-nss/release.pub   # signature of the checksums
  sha256sum -c sha256sums 2>/dev/null | grep sysupgrade    # checksum of the image
  ```

  A manual upgrade is kept as soon as it finishes booting: it only falls back
  by itself if it does not get that far, three times.

## Firmware updates

The images include `mx4300-ota` (command line) and `luci-app-mx4300-ota`
(*System → Firmware Update*). They update the router from the GitHub releases
of the repository that built its image:

1. **Show releases** lists the releases on the router's channel (below),
   newest first, marked newer or older than the installed firmware. Each has
   an image for the profile the router was built with (`PROFILE` in
   `/etc/mx4300-nss/build-info`).
2. **Install** on any of them - the newest, or an older one to go back to -
   downloads it, verifies the release's `sha256sums` against the `usign` key in
   the image (`/etc/mx4300-nss/release.pub`) and the image against
   `sha256sums`, and writes it to the other partition. Unsigned releases are
   refused.
3. The router reboots into the new firmware **on trial**. *System → Firmware
   Update* then offers **Keep this firmware** and **Roll back**. If you choose
   neither within the trial period (10 minutes by default), the firmware is
   kept if the LAN is up and the default gateway (or a host you set) answers;
   otherwise the router switches back to the previous partition and reboots.
   A firmware that hangs or keeps rebooting before that is undone by U-Boot
   after three boots.

Settings (in LuCI, or `/etc/config/mx4300-ota`): release repository, channel,
trial period, what happens when it ends, health-check host, signing key.

**Channels.** Releases are published as GitHub pre-releases, the **testing**
channel. A release that has run well is promoted to **stable** by unmarking
*Set as a pre-release* on its GitHub page. Routers on *stable* (the default)
are offered only promoted releases; routers on *testing* are offered all of
them.

**Going back.** Installing an older release keeps your current settings,
which may contain options the older firmware does not know. That is usually
harmless with these snapshot builds, but not guaranteed.

On the command line: `mx4300-ota list`, `mx4300-ota check`, `mx4300-ota
upgrade [TAG]`, `mx4300-ota confirm`, `mx4300-ota rollback`.

### Using your own fork, or no updater

The updater is not tied to this repository:

- **Your fork's releases:** a fork's GitHub Actions builds point the updater at
  the fork (`OTA_REPO` in `build-info` is set from the repository that ran the
  build) and embed the fork's `keys/release.pub`. Generate your own key pair
  and secret (see [GitHub Actions](#github-actions)); that is all.
- **Another source for a running router:** set the release repository (and,
  if it signs with another key, the key file) in *System → Firmware Update*.
- **No updater at all:** add these lines to your profile and the images are
  built without it (and without the LuCI page):

  ```
  -luci-app-mx4300-ota
  -mx4300-ota
  ```

  To drop it from every profile, delete both lines from
  `configs/base.packages`. The boot counter hold in `patches/0001` does
  nothing without the updater.

## Packages

### What the images contain

Every image is built from three layers:

| Layer | File | Contents |
|---|---|---|
| Base | `configs/mx4300-nss.config` | OpenWrt with LuCI over HTTPS, PPE flow offload, NSS Wi-Fi offload (`kmod-nss-wifi-drv`, NSS firmware 12.5), SQM with the PPE shaper (`sqm-scripts`, `luci-app-sqm`, `luci-app-qca-ppe-qos`), OpenSSL (`apk-openssl`, `wpad-openssl`), `kmod-tun`, `kmod-wireguard`, USB storage, `ppe-help`, crash logs (`kmod-ramoops`) |
| Every profile | `configs/base.packages` | `mx4300-ota`, `luci-app-mx4300-ota` (the [firmware updater](#firmware-updates)) |
| One profile | `profiles/<name>.packages` | what that profile adds or leaves out |

The profiles in this repository:

| Profile | Adds |
|---|---|
| `default` | nothing |
| `extended` | Proxy: `luci-app-passwall` with `xray-core`, V2Ray geodata and `geoview` (its other cores - sing-box, HAProxy, SmartDNS, Shadowsocks, SSR, simple-obfs, v2ray-plugin - left out). Theme: `luci-theme-aurora`. Tunnels and VPN: `luci-app-cloudflared`, `luci-app-ocserv`, `luci-proto-openconnect`, `openconnect`. Dynamic DNS: `luci-app-ddns`, `ddns-scripts-cloudflare`. Client steering between bands and access points: `luci-app-usteer`. Statistics: `luci-app-statistics` with the cpu, interface, iwinfo, load, memory, network and rrdtool plugins. mDNS: `avahi-daemon-service-http`, `dbus-utils`. USB phone tethering: `usbmuxd`, `kmod-usb-net-ipheth`, `kmod-usb-net-rndis`, `kmod-usb-net-cdc-ether`, `kmod-usb-net-cdc-eem`, `kmod-usb-net-cdc-subset`, `kmod-usb3`, `kmod-usb-dwc3-qcom`. TCP BBR: `kmod-tcp-bbr`. Tools: `bind-host`, `curl`, `e2fsprogs`, `htop`, `iperf3`, `jq`, `losetup`, `openssl-util`, `speedtestcpp`, `tcpdump`, `unzip`, `usbutils` |

The complete package list of an image is in its release as
`*-<profile>.manifest`, and on a running router in `apk list --installed`.
The router also keeps the profile it was built from in
`/etc/mx4300-nss/profile.packages`.

### Adding or removing packages

Packages installed on the router with `apk add` last only until the next
upgrade, which replaces the whole system image, and kernel modules cannot be
installed that way at all (the kernel is not an official OpenWrt one). To keep
a package, build it into your images:

1. Fork this repository (or work in your copy).
2. Edit a profile, or copy one to `profiles/<your-name>.packages`. One package
   per line, `#` starts a comment:

   ```
   # add a package
   luci-app-upnp
   # leave out a package the base or another layer includes
   -luci-app-sqm
   ```

   Package names are those of the feeds: search them with `apk search` on a
   router, in [the OpenWrt package table](https://openwrt.org/packages/start),
   or with `make menuconfig` in `build/openwrt` after a local build.
   Dependencies are added automatically. Build options of a package go in the
   same way when its Kconfig names them `PACKAGE_<package>_<option>`, as
   Passwall's are: `luci-app-passwall_INCLUDE_SingBox` builds sing-box in,
   `-luci-app-passwall_INCLUDE_SingBox` leaves it out.
3. Build: push and run *Actions → Build firmware* with your profile in
   **profiles**, or locally `scripts/build.sh --profile <your-name>`.
4. Install the new release on the router (*System → Firmware Update*).

The build **fails** if a listed package does not make it into the image
(unknown name, missing feed, unmet dependency), so an upgrade never drops
software silently.

To turn what a running router has into a profile:

```sh
scripts/router-packages.sh root@<router> > profiles/my-router.packages
```

It starts from the profile the router's image was built from and adds what
was installed (and `-name` for what was removed) since. Review it before
committing - it lists everything you run.

### Software from outside OpenWrt

Third-party sources go in `upstream/third-party.conf`, one per line:

```
# NAME   URL                                     BRANCH  COMMIT     TYPE
myfeed   https://github.com/<owner>/<repo>.git   main    <commit>   feed
mytheme  https://github.com/<owner>/<theme>.git  master  <commit>   package
```

- `feed`: a repository of packages, like an OpenWrt feed.
- `package`: a repository that is a single package (its `Makefile` at the
  top), such as most LuCI themes.

Then list the packages you want in a profile. Packages of these sources win
over same-named ones in the OpenWrt feeds, and the automatic builds move each
source to the newest commit of its branch (`scripts/bump-upstream.sh`). To
drop a source, delete its line and its packages from the profiles. Check a
source's licence before publishing images built with it.

### Your own packages

`feeds/mx4300/` is a feed of this repository's own packages (the firmware
updater). Add a directory there with an OpenWrt package `Makefile` (and its
files) and list the package in a profile; `scripts/build.sh` makes the feed
available to every build.

## Building

### GitHub Actions

*Actions → Build firmware → Run workflow* builds the profiles you name
(default: `default extended`) in one tree, validates them and publishes a
release:

- **upstream:** `pinned` builds `upstream/` as committed; `latest` first moves
  it forward (below).
- **publish:** `testing` (a pre-release), `stable`, or `none` (images only
  as a workflow artifact).

**Automatic builds.** Every day the workflow runs `scripts/bump-upstream.sh`:
it moves the tree to the newest upstream builder release (`ppe-nss-*`, which
names the tree and NSS commits it was built from), each feed to the commit it
was at when that release was built, and each third-party source to the head of
its branch. If anything moved, it builds and validates both profiles,
publishes them on the **testing** channel and commits the new pins. If a build
fails, nothing is published and the failed run notifies you. Nothing is ever
installed automatically: routers only update when you choose a release.
(GitHub pauses scheduled workflows in repositories without activity for 60
days; the commits of the automatic builds count as activity.)

Releases are signed when the repository has the secret `USIGN_SECRET_KEY`
(the content of a `usign` secret key file). If you fork this repository,
generate your own key pair, replace `keys/release.pub` (the images get it as
`/etc/mx4300-nss/release.pub`) and store `release.sec` as the secret - never
commit it:

```sh
usign -G -s release.sec -p release.pub -c "my release key"
```

### Locally

Linux with the [OpenWrt build prerequisites](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem),
`device-tree-compiler` and `squashfs-tools`; ~40 GB of disk.

```sh
scripts/build.sh                                      # profile "default"
scripts/build.sh --profile default --profile extended # several profiles, one tree
scripts/build.sh --clean                              # re-apply the patches from scratch
```

The tree goes to `build/openwrt`, third-party single-package sources to
`build/extra`, downloads to `build/dl`, the images to `out/<profile>/`. The
updater in local images uses the GitHub repository of the `origin` remote
(override with `OTA_REPO=owner/name`, or `OTA_REPO=` for none). Each image is
checked by `tools/validate-images.sh` (sysupgrade layout, device tree,
offload modules and firmware, boot counter hold, updater, profile packages).
Under WSL the script uses a Linux-only `PATH`, since OpenWrt's host tools fail
on the Windows directories WSL adds.

## Recovery

1. **Previous firmware:** during a trial, *Roll back* in *System → Firmware
   Update*. At any other time, from a shell:
   `fw_setenv boot_part <the other partition: 1 or 2>; reboot`
   (`mx4300-ota status` shows the running one as `slot`).
2. **Without a shell:** switch the router off and on three times during boot
   (wait ~10 seconds after each power-on, before the boot completes): U-Boot
   then boots the other partition.
3. **Serial console** (115200 8N1): interrupt U-Boot and TFTP-boot an OpenWrt
   initramfs image, as described on the OpenWrt wiki page for the MX4300.

## Known limitations

- **Snapshot base.** The upstream tree is OpenWrt main, not a stable release,
  and is rebased often. Userspace packages from the official snapshot feeds
  may not match; build what you need into a profile.
- **802.11s mesh** needs NSS firmware 11.4:
  `uci set nss-wifi.general.firmware=11.4; uci commit nss-wifi; reboot`.
- The upstream maintainer tests on a different board (Xiaomi AX3600); the
  MX4300 images are built and used by others, but not tested by them.

## Repository layout

```
upstream/openwrt.conf      pinned upstream tree (URL, commit, upstream builder release)
upstream/feeds.conf        pinned feeds and the branches they follow
upstream/third-party.conf  third-party sources (feeds and single packages)
patches/                   changes to the upstream tree (boot counter hold)
patches/feeds/FEED/        changes to a feed (sqm-scripts with the PPE shaper)
configs/mx4300-nss.config  base build configuration (diffconfig)
configs/base.packages      packages in every profile (the firmware updater)
profiles/                  package profiles (*.packages)
feeds/mx4300/              this repository's packages: mx4300-ota, luci-app-mx4300-ota
scripts/build.sh           reproducible build of one or more profiles
scripts/bump-upstream.sh   move upstream/ forward
scripts/profile.sh         profile -> .config, and the post-defconfig check
scripts/router-packages.sh profile from a running router
tools/validate-images.sh   static checks of the images
keys/release.pub           public key the releases are signed with (also in the images)
.github/workflows/         GitHub Actions build and release
```

## Credits

- **[OpenWrt](https://openwrt.org)** - the operating system, the
  `qualcommax/ipq807x` target, MX4300 support and the build system.
- **[JuliusBairaktaris/openwrt-ppe-nss](https://github.com/JuliusBairaktaris/openwrt-ppe-nss)**
  and **[Qualcommax_NSS_Builder](https://github.com/JuliusBairaktaris/Qualcommax_NSS_Builder)** -
  the PPE and NSS Wi-Fi offload this build is made of, its NSS packages and
  LuCI additions, and the build configuration and `sqm-scripts` patch
  (`patches/feeds/packages/`) taken from the builder.
- **[qosmio/openwrt-ipq](https://github.com/qosmio/openwrt-ipq)** - the NSS
  packaging the above builds on.
- **[Openwrt-Passwall](https://github.com/Openwrt-Passwall)** and
  **[eamonxg/luci-theme-aurora](https://github.com/eamonxg/luci-theme-aurora)** -
  the third-party software of the `extended` profile.
- **Qualcomm** - the NSS and ath11k firmware (fetched by the build), under
  their own licences.

## License

GPL-2.0 (see `LICENSE`), like OpenWrt. The firmware blobs fetched during the
build are proprietary Qualcomm data, not covered by this license.
