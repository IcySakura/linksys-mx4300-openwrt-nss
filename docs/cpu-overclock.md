# CPU overclocking

The Linksys MX4300's IPQ8174 is the 1.4 GHz member of Qualcomm's IPQ807x
family, and stock firmware runs it at 1017.6 and 1382.4 MHz. This firmware
can run it at up to **2208 MHz**, the speed of the 2.2 GHz members of the same
family (IPQ8072A/IPQ8074A), and, as an untested-by-Qualcomm *extreme* option,
up to 2688 MHz with a raised voltage. It is **off by default**.

- [Turning it on](#turning-it-on)
- [What it gains](#what-it-gains)
- [Voltage limit](#voltage-limit)
- [Extreme speeds](#extreme-speeds)
- [Automatic tuning](#automatic-tuning)
- [Risks and safeguards](#risks-and-safeguards)
- [How it works](#how-it-works)
- [Measurements](#measurements)
- [Command line](#command-line)
- [Building without it](#building-without-it)

## Turning it on

In LuCI: **System → CPU Overclock**.

**Simple mode** (the default view):

1. Read the warning on the page.
2. Tick *Allow overclocking* and pick a preset: *Balanced* (up to 1843.2 MHz,
   +33 %) or *Performance* (up to 2208 MHz, +60 %). Voltages are automatic.
3. Run the *Stability test* at that speed (5 or 15 minutes).

**Advanced mode** adds:

- **Any speed** as the maximum, and **extreme speeds** above 2208 MHz behind
  their own switch and warning (see [Extreme speeds](#extreme-speeds)).
- **A voltage offset for each voltage level**, in 8 mV steps (−160 to
  +128 mV; the kernel keeps every level between 592 and 1064 mV), with a live
  table of each level's voltage, floor and ceiling. 0 means automatic, as
  stock.
- **A voltage limit** (see [Voltage limit](#voltage-limit)).
- **Automatic tuning** (see [Automatic tuning](#automatic-tuning)).

Both modes show a **speed and voltage chart**, drawn with the same chart
component as LuCI's Dashboard: the voltage the controller gives each speed
(the speeds allowed now in the first colour, the rest in the second), with
markers where each voltage level (L1–L6) starts. After voltage tuning, a third
line shows the lowest voltage that passed on each level; the gap between the
lines is the safety margin.

The CPU still idles at 1017.6 MHz and only speeds up when there is work to
do; the kernel's `schedutil` governor picks the speed from the load, up to
the highest speed you allowed.

To go back to stock, untick *Allow overclocking*: speeds and voltage offsets
return to stock.

## What it gains

Speeds offered: 1497.6, 1651.2, 1843.2, 1920, 2073.6 and 2208 MHz, plus the
extreme speeds 2304, 2400, 2496, 2592 and 2688 MHz in advanced mode.

The CPU is only busy with work it does itself: Passwall/Xray proxying and its
encryption, Passwall servers, VPNs (WireGuard, OpenConnect), DNS, the web
interface, package installs. That work speeds up in line with the clock:

| CPU speed | vs. stock 1382.4 MHz | AES-128-GCM, one core | ChaCha20-Poly1305, one core |
|---|---|---|---|
| 1017.6 MHz (stock, idle) | −26 % | 457 MB/s | 170 MB/s |
| 1382.4 MHz (stock maximum) | — | 616 MB/s | 230 MB/s |
| 1497.6 MHz | +8 % | 677 MB/s | 246 MB/s |
| 1689.6 MHz | +22 % | 758 MB/s | 283 MB/s |
| 1881.6 MHz | +36 % | 842 MB/s | 312 MB/s |
| 2073.6 MHz | +50 % | 934 MB/s | 342 MB/s |
| 2208 MHz | +60 % | 991 MB/s | 367 MB/s |

(`openssl speed -evp … -bytes 16384`, measured on one MX4300.)

**Not faster:** wired routing (the PPE offloads it) and Wi-Fi (the NSS core
and the Wi-Fi firmware handle it). Overclocking does not change Wi-Fi or
gigabit throughput.

## Voltage limit

What wears a chip out is voltage and heat, not clock speed: at a given
voltage, a speed that is too high makes the CPU miscalculate or crash (the
stability test and tuning catch that), it does not damage it. The voltage
limit keeps every voltage level's CPR ceiling at or below one value, whatever
the offsets or tuning ask for, so speed can be pushed as far as the chip
allows *at a voltage known to be harmless*:

| Limit | Value | Meaning |
|---|---|---|
| **Family normal** (default) | 944 mV | The top CPR voltage of this chip family at its stock 2208 MHz: what the 2.2 GHz IPQ8074A versions of the same silicon run every day. No positive offsets. |
| **This chip's stock** | 776 mV | The highest CPR ceiling stock firmware ever gives this IPQ8174 (at 1382.4 MHz). Levels 3–6 get negative offsets that bring their ceilings down to it. |
| **None** | 1064 mV | Only the kernel's hard limit; needed for most extreme speeds. |

Simple mode always stays within the family normal voltage. *Find my maximum
speed* respects the limit: it never raises a voltage above it, so with the
default it finds the fastest speed this chip runs at the family's normal
voltage. On the router measured below that was 2400 MHz (2496 MHz passed
once and crashed once at the same voltage), against about 1.98 GHz at this
chip's own stock 760–776 mV.

## Extreme speeds

Above 2208 MHz no chip of this family is sold, and the voltage controller has
no calibration data: these speeds use the top voltage level, raised with
offset 6. On the one MX4300 they were tested on (60 s of full load per step):

| Speed | Top-level voltage that passed | Recommended offset 6 |
|---|---|---|
| 2304, 2400, 2496 MHz | 936 mV (no offset) | +32 mV |
| 2592 MHz | 1000 mV (crashed at 936 mV) | +96 mV |
| 2688 MHz | 1032 mV (crashed at 1000 mV) | +128 mV |
| 2784 MHz | none: crashed at 1032 and 1064 mV | – |

A second run, by *Find my maximum speed* on the same router, landed on the
same edge from the other side: 2496 MHz crashed at the normal voltage this
time (+32 mV passed), 2592 MHz needed +64 mV, 2688 MHz crashed at +64 and
+96 mV, and the ten-minute confirmation failed at 2592 MHz and passed at
2496 MHz with +64 mV. A speed that passes one test and crashes the next is
running at its edge: leave a margin.

1064 mV is the highest voltage Qualcomm uses on this chip family and the
firmware's hard limit. Your chip will differ: use *Find my maximum speed*
with *Allow extreme speeds* ticked, or raise offset 6 step by step and run
the stability test after each step.

## Automatic tuning

Both runs measure *this* router's chip with one-minute stress tests per
step, confirm the result with a ten-minute test, and save it (switching to
advanced mode). They expect to crash the router while searching for its
limit: every crash restarts the router (about two minutes without internet
and Wi-Fi), is recorded as a failed step, and the run continues by itself
after the restart.

- **Find my maximum speed** tries each speed from the bottom up and keeps
  the highest that passes. With extreme speeds allowed it continues past
  2208 MHz, raising offset 6 by 32 mV at a time up to the 1064 mV limit.
- **Lower voltages automatically** takes each voltage level in use, lowers
  its offset 16 mV at a time until a test fails, and keeps the lowest passing
  value plus 32 mV (never above where it started). The voltage controller's
  own choice carries a generic margin (about 100 mV on the chip measured
  below); this finds your chip's own curve instead.

A run stops after eight crashes, and *Stop tuning* ends it at any time,
restoring the saved settings.

## Risks and safeguards

**Risks.** Running a chip above its rated speed is outside Qualcomm's
specification, and every chip is different. Above its own limit a CPU can
make silent calculation errors, or crash. Higher speeds use more power and
run warmer (one MX4300 peaked at 76 °C after 15 minutes of full load on all
four cores at 2208 MHz; the CPU throttles itself at 95 °C), which may shorten
the chip's life. There is no warranty.

**Safeguards.**

- **Off by default.** The faster speeds are cpufreq *boost* operating points:
  the kernel does not use them until boost is switched on, so a router that
  never enables overclocking never runs above 1382.4 MHz, not even during
  boot.
- **Stability test.** Holds the CPU at a speed under a full CPU and memory
  load and checks every result. A pass records the settings as *last good*;
  a failure goes back to the last good settings, or turns overclocking off.
- **Crash detection.** If the router crashes or hangs while overclocked, the
  next boot sees it in the kernel's crash records (pstore), goes back to the
  last good settings (or turns overclocking off), and says so on the LuCI
  page. A power cut leaves no record and does not count.
- **Hard limits.** The kernel refuses any voltage outside 592–1064 mV, and a
  test stops as failed above 90 °C (the CPU itself throttles at 95 °C).
- **Voltage from CPR.** The CPU voltage is not a fixed overclocking value: the
  SoC's closed-loop voltage controller (CPR) sets it from on-chip
  measurements, as for the stock speeds. On one MX4300 it chose about 100 mV
  more than the lowest voltage that passed the stress test at every speed
  (see [Measurements](#measurements)).

## How it works

Three findings, all measured on an MX4300:

1. **The CPU's own clock generator stops at 1401.6 MHz.** The CPU cluster's PLL
   (an APSS "Huayra" PLL) accepts multipliers up to 115 (115 × 19.2 MHz =
   2208 MHz) and reports lock, but runs at no more than 73 × 19.2 =
   1401.6 MHz. Its debug status (`TEST_CTL[7:6] = 3` with the debug bit
   `MODE[3]`) reads back the multiplier it really uses: `min(L, 73)`. The
   A53 cycle counter agrees to the cycle. Voltage up to 1064 mV changes
   nothing, and no register in the APCS block or the PLL's own block lifts
   the limit.
2. **The CPU cores themselves are not limited.** The CPU's clock mux (an RCG at
   APCS `0x0b111050`) also accepts GPLL2, a PLL in the SoC's global clock
   controller that otherwise only clocks the SD/eMMC controllers (which the
   MX4300 does not use). Fed from GPLL2, the cores run at exactly the GPLL2
   rate: 1497.6, 1651.2, 1843.2, 1920, 2073.6, 2208 MHz.
3. **GPLL2 changes rate through the alpha PLL update latch**, and does not
   need the apps vote bit to reach the CPU mux.

`patches/0002-…` adds two kernel patches and the device tree changes:

- **`clk: qcom: ipq8074: run the CPU from GPLL2 …`** teaches the APSS clock
  driver (`drivers/clk/qcom/apss-ipq6018.c`) to take rates above 1401.6 MHz
  from GPLL2 when the device tree hands it in, and to park the CPU on GPLL0
  while either PLL changes rate (the mechanism mainline already uses on
  IPQ53xx). GCC latches GPLL2 rate changes.
- **`cpufreq: boost: let schedutil reach boost frequencies, …`**: schedutil
  maps a fully busy CPU to a reference frequency that the kernel records
  once, when the cpufreq policy is created. With boost off at that point the
  reference is 1382.4 MHz, and switching boost on later made the faster
  speeds selectable by hand but never by schedutil. The patch moves the
  reference along when boost changes. Enabling boost also no longer raises
  the speed limit by itself: userspace raises it after setting the voltage,
  so the extreme speeds are never reached at the normal voltage.
- **`regulator: cpr3: runtime voltage offset per corner`** adds a writable
  `offset_volt` next to each CPR level's readouts in debugfs
  (`/sys/kernel/debug/cpr3-regulator/apc/thread0/apc_corner/corner/`). An
  offset moves the level's floor, ceiling, open-loop voltage and target
  quotients together, so closed-loop CPR keeps adapting around the new
  point.
- **The MX4300 device tree** hands GPLL2 to the APCS block and adds the boost
  operating points; each uses the CPR corner calibrated for its own speed or
  a higher one.

Userspace (`mx4300-cpu-oc`) switches boost on and sets the cpufreq limit;
`schedutil` then picks the speed from the load.

## Measurements

**Lowest stable voltage per speed** on one MX4300: 60 s at each voltage with
the CPU clock fed from GPLL2 and a fixed voltage, four threads of checked
computation and a 128 MB memory pattern test; 16 mV steps.

| Speed | Lowest voltage that passed | First failure | CPR's choice for that speed class |
|---|---|---|---|
| 2208 MHz | 824 mV | 808 mV: calculation errors | 920 mV |
| 2073.6 MHz | 776 mV | 760 mV: crash | 920 mV |
| 1977.6 MHz | 760 mV | 744 mV: calculation errors | 920 mV |
| 1881.6 MHz | 728 mV | 712 mV: crash | 864 mV |
| 1785.6 MHz | ≤ 712 mV | not reached | 840 mV |
| 1689.6 MHz | ≤ 712 mV | not reached | 840 mV |
| 1593.6 MHz | ≤ 712 mV | not reached | 816 mV |
| 1497.6 MHz | ≤ 712 mV | not reached | 816 mV |

**Voltage tuning** on the same router (*Lower voltages automatically*, with
the speed limited to 2400 MHz and the family voltage limit): how far below the
voltage controller's own choice each level stayed stable, 60 s per 16 mV step:

| Level | Speed tested | Lowest offset that passed | First failure | Margin left by CPR |
|---|---|---|---|---|
| 1 | 1017.6 MHz | −64 mV | −80 mV: errors | ~64 mV |
| 2 | 1382.4 MHz | −144 mV | −160 mV: errors | ~144 mV |
| 3 | 1651.2 MHz | −144 mV | −160 mV: crash | ~144 mV |
| 4 | 1843.2 MHz | −128 mV | −144 mV: crash | ~128 mV |
| 5 | 1920 MHz | −128 mV | −144 mV: crash | ~128 mV |
| 6 | 2400 MHz | −48 mV | −64 mV: errors | ~48 mV |

That router now runs up to 2400 MHz with each level at its lowest passing
offset plus 64 mV, never above stock (0 / −80 / −80 / −64 / −64 / 0 mV), and
passed a 30-minute stability test that way (peak 71.6 °C). Level 6 has the
least margin: 2400 MHz is close to what this chip does at the family's normal
voltage.

**Soak:** 15 minutes at 2208 MHz with all four cores under the stress test,
Passwall proxy downloads and a UDP flood into the router: no errors in 64 GB
of memory checks and 230,000 checked computations; peak 76 °C.

These numbers are for one chip; yours will differ. That is what the
stability test is for.

## Command line

```
mx4300-cpu-oc status            # settings, speeds, voltages, test, tuning (JSON)
mx4300-cpu-oc apply             # apply /etc/config/mx4300-cpu-oc
mx4300-cpu-oc test 300 2208000  # stability test: 300 s at 2208 MHz
mx4300-cpu-oc tune speed        # find the highest stable speed
mx4300-cpu-oc tune voltage      # lower the voltage levels in use
mx4300-cpu-oc tune stop
```

Settings (`/etc/config/mx4300-cpu-oc`), for example:

```
config cpu-oc 'main'
	option enabled '1'
	option mode 'advanced'
	option max_freq '2400000'
	option extreme '1'
	option volt_cap 'none'
	option offset_6 '32000'
```

Voltage levels: 1 = 1017.6 MHz, 2 = 1382.4 MHz, 3 = 1497.6–1651.2 MHz,
4 = 1843.2 MHz, 5 = 1920 MHz, 6 = 2073.6 MHz and above.

The kernel interface underneath is plain cpufreq:
`/sys/devices/system/cpu/cpufreq/boost` (0 or 1) and
`/sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq`.

## Building without it

Put these lines in your profile (`profiles/NAME.packages`):

```
-luci-app-mx4300-cpu-oc
-mx4300-cpu-oc
```

The kernel and device tree changes stay; without the package nothing switches
boost on, so the CPU keeps its stock speeds.
