# CPU overclocking

The Linksys MX4300's IPQ8174 is the 1.4 GHz member of Qualcomm's IPQ807x
family, and stock firmware runs it at 1017.6 and 1382.4 MHz. This firmware
can run it at up to **2208 MHz**, the speed of the 2.2 GHz members of the same
family (IPQ8072A/IPQ8074A). It is **off by default**.

- [Turning it on](#turning-it-on)
- [What it gains](#what-it-gains)
- [Risks and safeguards](#risks-and-safeguards)
- [How it works](#how-it-works)
- [Measurements](#measurements)
- [Command line](#command-line)
- [Building without it](#building-without-it)

## Turning it on

In LuCI: **System → CPU Overclock**.

1. Read the warning on the page.
2. Tick *Allow overclocking*, pick the *Highest speed*, and save.
3. Run the *Stability test* at that speed (5 or 15 minutes). If it fails,
   overclocking turns itself off; pick a lower speed.

The CPU still idles at 1017.6 MHz and only speeds up when there is work to
do; the kernel's `schedutil` governor picks the speed from the load, up to
the highest speed you allowed. The CPU voltage is set for every speed by the
SoC's own voltage controller, as for the stock speeds.

To go back to stock, untick *Allow overclocking*. Nothing else changes.

## What it gains

Speeds offered: 1497.6, 1651.2, 1843.2, 1920, 2073.6 and 2208 MHz.

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
  load and checks every result; a failure turns overclocking off.
- **Crash detection.** If the router crashes or hangs while overclocked, the
  next boot sees it in the kernel's crash records (pstore), turns
  overclocking off, and says so on the LuCI page. A power cut leaves no
  record and does not count.
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
- **`cpufreq: let schedutil reach boost frequencies`**: schedutil maps a fully
  busy CPU to a reference frequency that the kernel records once, when the
  cpufreq policy is created. With boost off at that point the reference is
  1382.4 MHz, and switching boost on later made the faster speeds selectable
  by hand but never by schedutil. The patch moves the reference along when
  boost changes.
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

**Soak:** 15 minutes at 2208 MHz with all four cores under the stress test,
Passwall proxy downloads and a UDP flood into the router: no errors in 64 GB
of memory checks and 230,000 checked computations; peak 76 °C.

These numbers are for one chip; yours will differ. That is what the
stability test is for.

## Command line

```
mx4300-cpu-oc status            # settings, speeds, temperature, last test (JSON)
mx4300-cpu-oc apply             # apply /etc/config/mx4300-cpu-oc
mx4300-cpu-oc test 300 2208000  # stability test: 300 s at 2208 MHz
```

Settings (`/etc/config/mx4300-cpu-oc`):

```
config cpu-oc 'main'
	option enabled '1'
	option max_freq '2208000'
```

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
