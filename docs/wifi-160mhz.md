# Why there is no 160 MHz on 5 GHz

The MX4300 (and the MX4200 v1/v2, same SoC and layout) runs its two 5 GHz
radios at up to 80 MHz. This firmware does not change that. This page
records what was tried, so nobody has to try it again.

- [The short version](#the-short-version)
- [Three-radio mode: advertised, never used](#three-radio-mode-advertised-never-used)
- [Two-radio mode: the board file switch](#two-radio-mode-the-board-file-switch)
- [Moving the 4x4 chains to PHY0](#moving-the-4x4-chains-to-phy0)
- [Board file notes](#board-file-notes)

## The short version

On the IPQ807x family, 160 MHz exists only in the two-radio layout ("DBS",
Qualcomm's "PPS"), where one 5 GHz radio, always PHY0, owns the 5 GHz
chains: 8x8/80 or 4x4/160 on an IPQ8074A, 4x4/80 or 2x2/160 on an
IPQ8072A/8071A. The three-radio layout ("DBS+SBS") is 80 MHz only on every
model. The IPQ8174 in this router is sold as three-radio only (4x4/80 plus
2x2/80) with no 160 MHz mode, and Linksys wired PHY0 to the 2x2 low band.

| Layout | 5 GHz radios | Result |
|---|---|---|
| Three radios (as shipped) | 2x2 low band, 4x4 high band | 80 MHz; 160 MHz advertised in HE capabilities but never used |
| Two radios, stock chains | 2x2 low band only | 160 MHz at 1 stream: no faster than 80 MHz at 2 streams, and the 4x4 radio is gone |
| Two radios, PHY0 given the 4x4 chains (`f0`) | 4x4, high band | PHY resets several times a second, no beacons |
| Two radios, PHY0 given all six chains (`f3`) | 6 chains | the board hangs when the radio starts on the high band |

## Three-radio mode: advertised, never used

The Wi-Fi firmware (WLAN.HK.2.9.0.1) reports 160 MHz in the HE (Wi-Fi 6)
capabilities of both 5 GHz radios, with half the spatial streams, but not
in the VHT (Wi-Fi 5) capabilities. Linux only allows a 160 MHz channel when
the VHT capabilities do, so 160 MHz channels are refused:

```
$ iw phy phy2 info
	HE160/5GHz
	Supported Channel Width: neither 160 nor 80+80
```

An ath11k change that filled in the missing VHT capability let the 4x4
radio start a 160 MHz network on channels 100-128 (beacons correct,
announced either way: VHT "160 MHz" or extended NSS). But the firmware's
own per-client counters showed every frame, in both directions, at 80 MHz,
with a 160 MHz-capable 2x2 client close to the router and no other access
point on that block:

```
tx_bw =  0:0, 1:0, 2:32007, 3:0      # 20/40/80/160 MHz
rx_bw =  0:1207, 1:305, 2:13470, 3:0
```

The client tried 160 MHz (its driver showed a 160 MHz transmit rate) and
fell back. So the capability is a leftover, and the change was dropped.

## Two-radio mode: the board file switch

The firmware picks its layout from the board file (BDF). Bit 4 (`0x10`) of
byte `0x40` selects the two-radio layout: it is set in the board files of
every two-radio IPQ807x design (Xiaomi AX3600, Redmi AX6, Dynalink WRX36,
Edgecore EAP102 and others) and clear in the tri-band ones (MX4200/MX4300,
Zyxel NBG7815, Netgear RBK850). On the NBG7815 (IPQ8074A, 4x4 on each 5 GHz
PHY) setting it gives one 8-chain 5 GHz radio with working 160 MHz.

On the MX4300 the firmware then offers only that layout, and the 5 GHz
radio is PHY0 with PHY0's chains: the 2x2 low band, channels 36-64, VHT
"160 MHz" natively, and 1 stream at 160 MHz (HE MCS map). That is the same
top rate as 2 streams at 80 MHz, at the cost of the 4x4 radio.

## Moving the 4x4 chains to PHY0

The board file holds per-PHY records `0xa4` bytes apart from `0x400`, with
the 5 GHz TX/RX chain masks as u16 at `+0x24`/`+0x26`:

| Board | PHY0 | PHY1 (2.4 GHz) | PHY2 |
|---|---|---|---|
| NBG7815, RBK850 | `ff` | `0f` | `0f` |
| AX3600 | `0f` | `03` | `0f` |
| MX4200/MX4300 | `03` | `03` | `0f` |

The 4x4 high-band radio uses chains 4-7. In the two-radio layout:

- PHY0 mask `f0`: the firmware reports a 4x4 radio with 2 streams at
  160 MHz, but limits PHY0 to 4910-5330 MHz in its regulatory capabilities
  (PHY2's range is 5490-5920 MHz). With the range overridden in the driver
  the radio comes up on the high band, then the PHY resets about 8 times a
  second, logs thousands of illegal-rate errors and never sends a beacon,
  at 160 MHz and at 80 MHz alike. PHY0 cannot drive PHY2's chains alone.
- PHY0 mask `f3`, the MX4300's version of the NBG7815's `ff`: the firmware
  loads, but the board hangs and the watchdog resets it as soon as the
  radio starts on the high band (with and without NSS Wi-Fi offload).

PHY0 and PHY2 are fixed blocks in the SoC, each tied to its own chains;
the board file can only describe the wiring, not change it.

## Board file notes

For anyone looking at IPQ807x board files:

- The raw BDF is 131072 bytes. The u16 at `0x0a` is a checksum: the
  bitwise NOT of the XOR of every other little-endian u16 in the file. The
  firmware rejects a board file with a wrong checksum.
- `board-2.bin` wraps it in the ath11k container (`QCA-ATH11K-BOARD`, name
  and data TLVs); patching in place needs no repacking.
- Do not test Wi-Fi driver changes by reloading ath11k on an NSS build: an
  unload and reload can hang the board (see `/etc/init.d/nss-wifi`). Swap
  files before the driver loads at boot instead.
